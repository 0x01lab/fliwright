import * as vscode from 'vscode';
import type { FormAnalyzeResult, FormFillResult } from '@fliwright/core';
import { getWorkspaceRoot, loadConfig, resolveWorkspacePath } from './config.js';
import { FailureContextStore } from './failure/FailureContextStore.js';
import { formRulesFileName, FormHelperService, formatFormFillDebug } from './form/FormHelperService.js';
import { FormRuleService } from './form/FormRuleService.js';
import { RecorderService } from './recording/RecorderService.js';
import { FliwrightCodeLensProvider } from './runner/FliwrightCodeLensProvider.js';
import { TestDiscoveryService } from './runner/TestDiscoveryService.js';
import { VitestRunner } from './runner/VitestRunner.js';
import { FliwrightSession } from './session/FliwrightSession.js';
import { discoverVmServiceUrl } from './session/VmServiceDiscovery.js';
import { MockConfigService } from './sandbox/MockConfigService.js';
import { formatMockRuleDebug, SandboxService } from './sandbox/SandboxService.js';
import { StateInjectionService } from './state/StateInjectionService.js';
import { StatusBarService } from './status/StatusBarService.js';
import type { FailureTreeEntry, FormAnalyzeFieldEntry, FormRulesEntry, InvalidFileEntry, MockEndpointEntry, MockRuleEntry, RunEntry, StateProviderEntry, TestFileEntry } from './types.js';
import { DevicesTreeProvider } from './views/DevicesTreeProvider.js';
import { FormDataTreeProvider } from './views/FormDataTreeProvider.js';
import { MockApiTreeProvider, mockFileNameFromInput } from './views/MockApiTreeProvider.js';
import { RunsTreeProvider } from './views/RunsTreeProvider.js';
import { StateTreeProvider } from './views/StateTreeProvider.js';
import { TestsTreeProvider } from './views/TestsTreeProvider.js';
import { FailurePanel } from './webview/FailurePanel.js';
import { RecordingPanel } from './webview/RecordingPanel.js';

let output: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel('Fliwright');
  context.subscriptions.push(output);

  const mockService = new MockConfigService();
  const formService = new FormRuleService();
  const session = new FliwrightSession();
  const sandboxService = new SandboxService();
  const formHelperService = new FormHelperService();
  const testDiscoveryService = new TestDiscoveryService();
  const runner = new VitestRunner();
  const failureStore = new FailureContextStore();
  const recorderService = new RecorderService();
  const stateService = new StateInjectionService();
  const devicesTree = new DevicesTreeProvider();
  const mockTree = new MockApiTreeProvider(mockService);
  const formTree = new FormDataTreeProvider(formService);
  const testsTree = new TestsTreeProvider(testDiscoveryService);
  const runsTree = new RunsTreeProvider();
  const stateTree = new StateTreeProvider();
  const statusBar = new StatusBarService();
  const failurePanel = new FailurePanel(context.extensionUri);
  const recordingPanel = new RecordingPanel();

  context.subscriptions.push(session);
  context.subscriptions.push(statusBar);
  context.subscriptions.push(session.onDidChangeState((state) => {
    devicesTree.setState(state);
    statusBar.setConnectionState(state);
  }));

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('fliwright.devices', devicesTree),
    vscode.window.registerTreeDataProvider('fliwright.mockApis', mockTree),
    vscode.window.registerTreeDataProvider('fliwright.formData', formTree),
    vscode.window.registerTreeDataProvider('fliwright.tests', testsTree),
    vscode.window.registerTreeDataProvider('fliwright.runs', runsTree),
    vscode.window.registerTreeDataProvider('fliwright.state', stateTree),
    vscode.languages.registerCodeLensProvider(
      [{ language: 'typescript', scheme: 'file' }, { language: 'typescriptreact', scheme: 'file' }],
      new FliwrightCodeLensProvider(),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('fliwright.reloadMocks', async () => {
      await runCommand('Reload Mock Configs', async () => {
        await mockTree.refresh();
      });
    }),
    vscode.commands.registerCommand('fliwright.reloadFormRules', async () => {
      await runCommand('Reload Form Rules', async () => {
        await formTree.refresh();
      });
    }),
    vscode.commands.registerCommand('fliwright.connect', async () => {
      await runCommand('Connect to VM Service', async () => {
        const url = await vscode.window.showInputBox({
          title: 'Connect to VM Service',
          prompt: 'VM Service WebSocket URL. Leave blank to use settings, FLIWRIGHT_VM_URL, or discovery.',
          value: loadConfig().vmServiceUrl ?? '',
          placeHolder: 'ws://127.0.0.1:8181/ws',
        });
        if (url === undefined) return;
        const state = await session.connect(url);
        if (state.status === 'connected') {
          await configureMocksAfterConnect();
          vscode.window.showInformationMessage(`Connected to ${state.url}`);
        } else if (state.status === 'error') {
          throw new Error(state.message);
        }
      });
    }),
    vscode.commands.registerCommand('fliwright.disconnect', async () => {
      await runCommand('Disconnect VM Service', async () => {
        await session.disconnect();
        vscode.window.showInformationMessage('Disconnected from VM Service');
      });
    }),
    vscode.commands.registerCommand('fliwright.discoverVmService', async () => {
      await runCommand('Discover VM Service', async () => {
        const url = await discoverVmServiceUrl();
        if (!url) {
          vscode.window.showWarningMessage('No local Flutter VM Service found.');
          return;
        }
        const selection = await vscode.window.showInformationMessage(`Found ${url}`, 'Connect');
        if (selection === 'Connect') {
          const state = await session.connect(url);
          if (state.status === 'error') throw new Error(state.message);
          if (state.status === 'connected') await configureMocksAfterConnect();
        }
      });
    }),
    vscode.commands.registerCommand('fliwright.configureMcp', async () => {
      await runCommand('Configure MCP', async () => {
        const document = await vscode.workspace.openTextDocument({
          language: 'markdown',
          content: mcpInstructions(),
        });
        await vscode.window.showTextDocument(document);
      });
    }),
    vscode.commands.registerCommand('fliwright.createMockConfig', async () => {
      await runCommand('Create Mock Config', async () => {
        const root = requireWorkspaceRoot();
        const input = await vscode.window.showInputBox({
          title: 'Create Mock Config',
          prompt: 'File name under .fliwright/mocks/api',
          value: 'example-api.json',
        });
        if (input === undefined) return;
        const uri = await mockService.createTemplate(root, mockFileNameFromInput(input));
        await vscode.window.showTextDocument(uri);
        await mockTree.refresh();
      });
    }),
    vscode.commands.registerCommand('fliwright.createFormRules', async () => {
      await runCommand('Create Form Rules', async () => {
        const root = requireWorkspaceRoot();
        const input = await vscode.window.showInputBox({
          title: 'Create Form Rules',
          prompt: 'File name under .fliwright/forms',
          value: 'form-rules.json',
        });
        if (input === undefined) return;
        const uri = await formService.createTemplate(root, input);
        await vscode.window.showTextDocument(uri);
        await formTree.refresh();
      });
    }),
    vscode.commands.registerCommand('fliwright.openMockConfig', async (node?: MockEndpointEntry | MockRuleEntry | InvalidFileEntry) => {
      await openUriFromNode(node);
    }),
    vscode.commands.registerCommand('fliwright.openFormRules', async (node?: FormRulesEntry | InvalidFileEntry) => {
      await openUriFromNode(node);
    }),
    vscode.commands.registerCommand('fliwright.copyMockEndpoint', async (node?: MockEndpointEntry) => {
      if (!node || node.kind !== 'endpoint') return;
      await vscode.env.clipboard.writeText(node.endpointFile.endpoint);
      vscode.window.showInformationMessage(`Copied ${node.endpointFile.endpoint}`);
    }),
    vscode.commands.registerCommand('fliwright.copyMockRuleJson', async (node?: MockRuleEntry) => {
      if (!node || node.kind !== 'rule') return;
      await vscode.env.clipboard.writeText(JSON.stringify(node.rule, null, 2));
      vscode.window.showInformationMessage(`Copied rule ${node.rule.name}`);
    }),
    vscode.commands.registerCommand('fliwright.applyMockRule', async (node?: MockRuleEntry) => {
      await runCommand('Apply Mock Rule', async () => {
        if (!node || node.kind !== 'rule') throw new Error('Select a mock rule to apply.');
        output.appendLine(`Applying mock ${formatMockRuleDebug(node)}`);
        const applied = await sandboxService.applyRule(session.connectedDriver, node);
        mockTree.setAppliedRules(sandboxService.getAppliedRules());
        output.appendLine(`Applied mock ${applied.method} ${applied.endpoint} -> ${applied.ruleName}`);
        await appendMockControllerDebug();
        vscode.window.showInformationMessage(`Applied ${applied.method} ${applied.endpoint} -> ${applied.ruleName}`);
      });
    }),
    vscode.commands.registerCommand('fliwright.stopMockRule', async (node?: MockRuleEntry) => {
      await runCommand('Stop Mock Rule', async () => {
        if (!node || node.kind !== 'rule') throw new Error('Select an active mock rule to stop.');
        const stopped = await sandboxService.stopRule(session.connectedDriver, node);
        mockTree.setAppliedRules(sandboxService.getAppliedRules());
        if (!stopped) {
          output.appendLine(`Skipped stopping inactive mock ${formatMockRuleDebug(node)}`);
          vscode.window.showWarningMessage(`Mock rule is not active: ${node.method} ${node.endpoint} -> ${node.rule.name}`);
          return;
        }
        output.appendLine(`Stopped mock ${node.method} ${node.endpoint} -> ${node.rule.name}`);
        await appendMockControllerDebug();
        vscode.window.showInformationMessage(`Stopped ${node.method} ${node.endpoint} -> ${node.rule.name}`);
      });
    }),
    vscode.commands.registerCommand('fliwright.applyDefaultMocks', async () => {
      await runCommand('Apply Default Mocks', async () => {
        if (!mockTree.currentResult) await mockTree.refresh();
        const discovery = mockTree.currentResult;
        if (!discovery) throw new Error('Open a workspace to use Fliwright.');
        for (const endpoint of discovery.endpoints) {
          const rule = endpoint.defaultRule
            ? endpoint.endpointFile.rules.find((candidate) => candidate.name === endpoint.defaultRule) ?? endpoint.endpointFile.rules[0]
            : endpoint.endpointFile.rules[0];
          if (rule) {
            output.appendLine(`Applying default mock ${formatMockRuleDebug({
              kind: 'rule',
              uri: endpoint.uri,
              endpoint: endpoint.endpointFile.endpoint,
              method: endpoint.endpointFile.method,
              rule,
              isDefault: true,
            })}`);
          }
        }
        const result = await sandboxService.applyDefaultMocks(session.connectedDriver, discovery);
        mockTree.setAppliedRules(sandboxService.getAppliedRules());
        output.appendLine(`Applied ${result.applied.length} default mock route(s), skipped ${result.skipped}.`);
        await appendMockControllerDebug();
        vscode.window.showInformationMessage(`Applied ${result.applied.length} default mock route(s).`);
      });
    }),
    vscode.commands.registerCommand('fliwright.stopSandbox', async () => {
      await runCommand('Stop All Mock Routes', async () => {
        const count = await sandboxService.clear(session.connectedDriver);
        mockTree.setAppliedRules([]);
        output.appendLine(`Stopped all mock routes (${count} tracked route(s)).`);
        vscode.window.showInformationMessage('Stopped all mock routes.');
      });
    }),
    vscode.commands.registerCommand('fliwright.analyzeForm', async (node?: FormRulesEntry) => {
      await runCommand('Analyze Current Form', async () => {
        const root = requireWorkspaceRoot();
        const result = await withWindowProgress('Fliwright: analyzing current form fields...', () => (
          formHelperService.analyze(session.connectedDriver, root, formRulesNode(node))
        ));
        formTree.setLastSummary(formHelperService.getLastSummary());
        formTree.setLastAnalyze(formHelperService.getLastAnalyze());
        await showFormPreview(formHelperService, result, 'Analyze Current Form');
        output.appendLine(`Analyzed ${result.fields.length} form field(s) with ${formRulesFileName(formRulesNode(node))}.`);
        vscode.window.showInformationMessage(`Analyzed ${result.fields.length} form field(s).`);
      });
    }),
    vscode.commands.registerCommand('fliwright.insertFormFieldSelector', async (node?: FormAnalyzeFieldEntry) => {
      await runCommand('Insert Form Field Selector', async () => {
        if (!node || node.kind !== 'formAnalyzeField') throw new Error('Select a form field from Last Analyze.');
        await insertFormFieldRuleAtCursor(node);
      });
    }),
    vscode.commands.registerCommand('fliwright.fillForm', async () => {
      await fillFormWithRules(undefined);
    }),
    vscode.commands.registerCommand('fliwright.fillFormWithRules', async (node?: FormRulesEntry) => {
      await fillFormWithRules(formRulesNode(node));
    }),
    vscode.commands.registerCommand('fliwright.runCurrentTest', async (node?: TestFileEntry) => {
      await runTests(node);
    }),
    vscode.commands.registerCommand('fliwright.runWorkspaceTests', async () => {
      await runTests(undefined, true);
    }),
    vscode.commands.registerCommand('fliwright.openFailure', async (node?: FailureTreeEntry) => {
      if (!node || node.kind !== 'failure') {
        const failure = runsTree.failuresList[0];
        if (failure) failurePanel.open(failure);
        return;
      }
      failurePanel.open(node.failure);
    }),
    vscode.commands.registerCommand('fliwright.startRecording', async () => {
      await runCommand('Start Recording', async () => {
        session.setRecording();
        const recording = await recorderService.start(session.connectedDriver);
        statusBar.setRecording(recording);
        recordingPanel.open(recording);
        vscode.window.showInformationMessage('Fliwright recording started.');
      });
    }),
    vscode.commands.registerCommand('fliwright.stopRecording', async () => {
      await runCommand('Stop Recording', async () => {
        const recording = await recorderService.stop(session.connectedDriver, vscode.window.activeTextEditor?.document.uri);
        statusBar.setRecording(recording);
        recordingPanel.open(recording);
        session.setConnectedIdle();
        output.appendLine(`Recorded ${recording.operationCount} operation(s).`);
        vscode.window.showInformationMessage(`Recorded ${recording.operationCount} operation(s).`, 'Insert Test').then((selection) => {
          if (selection === 'Insert Test') void vscode.commands.executeCommand('fliwright.insertRecordedTest');
        });
      });
    }),
    vscode.commands.registerCommand('fliwright.insertRecordedTest', async () => {
      await runCommand('Insert Recorded Test', async () => {
        const uri = await recorderService.insertGeneratedCode(requireWorkspaceRoot());
        vscode.window.showInformationMessage(`Inserted recorded test into ${uri.fsPath}`);
      });
    }),
    vscode.commands.registerCommand('fliwright.refreshStateProviders', async () => {
      await runCommand('Refresh State Providers', async () => {
        const providers = await stateService.listProviders(session.connectedDriver);
        stateTree.setProviders(providers);
        vscode.window.showInformationMessage(`Loaded ${providers.length} provider(s).`);
      });
    }),
    vscode.commands.registerCommand('fliwright.readStateProvider', async (node?: StateProviderEntry) => {
      await runCommand('Read State Provider', async () => {
        if (!node || node.kind !== 'stateProvider') throw new Error('Select a state provider to read.');
        const value = await stateService.read(session.connectedDriver, node.key);
        stateTree.setProviders([{ ...node, value }]);
        output.appendLine(`${node.key}: ${JSON.stringify(value)}`);
        vscode.window.showInformationMessage(`${node.key}: ${JSON.stringify(value)}`);
      });
    }),
    vscode.commands.registerCommand('fliwright.overrideStateProvider', async (node?: StateProviderEntry) => {
      await runCommand('Override State Provider', async () => {
        if (!node || node.kind !== 'stateProvider') throw new Error('Select a state provider to override.');
        const raw = await vscode.window.showInputBox({
          title: 'Override State Provider',
          prompt: `JSON value for ${node.key}`,
          value: JSON.stringify(node.value ?? null),
        });
        if (raw === undefined) return;
        await stateService.override(session.connectedDriver, node.key, JSON.parse(raw));
        const providers = await stateService.listProviders(session.connectedDriver).catch(() => [{ ...node, value: JSON.parse(raw) }]);
        stateTree.setProviders(providers);
        vscode.window.showInformationMessage(`Overrode ${node.key}.`);
      });
    }),
  );

  await Promise.all([mockTree.refresh(), formTree.refresh()]);
  output.appendLine('Fliwright extension activated.');

  async function fillFormWithRules(node?: FormRulesEntry): Promise<void> {
    await runCommand('Fill Current Form', async () => {
      const root = requireWorkspaceRoot();
      if (loadConfig().formPreviewBeforeFill) {
        const analysis = await withWindowProgress('Fliwright: analyzing current form fields...', () => (
          formHelperService.analyze(session.connectedDriver, root, node)
        ));
        formTree.setLastSummary(formHelperService.getLastSummary());
        formTree.setLastAnalyze(formHelperService.getLastAnalyze());
        const selectedHints = await showFormPreview(formHelperService, analysis, 'Fill Current Form', true);
        if (!selectedHints) return;
        const result = await withWindowProgress('Fliwright: filling selected form fields...', () => (
          formHelperService.fillSelected(session.connectedDriver, root, selectedHints, node)
        ));
        formTree.setLastSummary(formHelperService.getLastSummary());
        formTree.setLastAnalyze(formHelperService.getLastAnalyze());
        output.appendLine(`Filled selected form fields with ${formRulesFileName(node)}: ${result.filled} filled, ${result.skipped} skipped, ${result.errors.length} errors.`);
        appendFormFillDebug(result);
        vscode.window.showInformationMessage(`Filled ${result.filled} field(s), skipped ${result.skipped}, errors ${result.errors.length}.`);
        return;
      }
      const result = await withWindowProgress('Fliwright: filling current form...', () => (
        formHelperService.fill(session.connectedDriver, root, node)
      ));
      formTree.setLastSummary(formHelperService.getLastSummary());
      formTree.setLastAnalyze(formHelperService.getLastAnalyze());
      output.appendLine(`Filled form with ${formRulesFileName(node)}: ${result.filled} filled, ${result.skipped} skipped, ${result.errors.length} errors.`);
      appendFormFillDebug(result);
      vscode.window.showInformationMessage(`Filled ${result.filled} field(s), skipped ${result.skipped}, errors ${result.errors.length}.`);
    });
  }

  async function configureMocksAfterConnect(): Promise<void> {
    const config = loadConfig();
    if (!config.autoStartMockController && !config.autoApplyDefaultMocksOnConnect) return;

    if (config.autoStartMockController) {
      const url = await sandboxService.ensureController(session.connectedDriver);
      output.appendLine(`Mock controller ready: ${url}`);
    }

    if (config.autoApplyDefaultMocksOnConnect) {
      if (!mockTree.currentResult) await mockTree.refresh();
      const discovery = mockTree.currentResult;
      if (!discovery) return;
      const result = await sandboxService.applyDefaultMocks(session.connectedDriver, discovery);
      mockTree.setAppliedRules(sandboxService.getAppliedRules());
      output.appendLine(`Auto-applied ${result.applied.length} default mock route(s), skipped ${result.skipped}.`);
      await appendMockControllerDebug();
    }
  }

  async function appendMockControllerDebug(): Promise<void> {
    const controllerUrl = sandboxService.getControllerUrl();
    output.appendLine(`Mock controller: ${controllerUrl ?? '(not configured)'}`);
    const routes = await session.connectedDriver.mock.listRoutes();
    if (routes.length === 0) {
      output.appendLine('Mock controller routes: (none)');
      return;
    }
    output.appendLine(`Mock controller routes (${routes.length}):`);
    for (const route of routes) {
      output.appendLine(`  ${(route.method ?? '*').toUpperCase()} ${route.path}`);
    }
  }

  async function runTests(node?: TestFileEntry, workspace = false): Promise<void> {
    await runCommand(workspace ? 'Run Workspace Tests' : 'Run Current Test', async () => {
      const root = requireWorkspaceRoot();
      const file = workspace ? undefined : node?.uri ?? vscode.window.activeTextEditor?.document.uri;
      const failureContextDir = resolveWorkspacePath(root, loadConfig().failureContextDir);
      session.setRunning(workspace ? 'workspace tests' : file?.fsPath ?? 'current test');
      const result = await runner.run({
        workspaceRoot: root,
        testFile: file,
        vmServiceUrl: session.currentUrl,
        failureContextDir,
      });
      const failures = await failureStore.loadLatest(failureContextDir, result);
      const run: RunEntry = {
        kind: 'run',
        id: `${Date.now()}`,
        label: workspace ? 'Workspace tests' : file?.fsPath.split(/[\\/]/).pop() ?? 'Current test',
        filePath: file?.fsPath,
        result,
        ranAt: Date.now(),
      };
      runsTree.prependRun(run, failures);
      statusBar.setRunResult(result);
      session.setConnectedIdle();
      output.appendLine(`Run complete: ${result.passedTests}/${result.totalTests} passed, ${result.failedTests} failed.`);
      if (result.failedTests > 0) {
        vscode.window.showErrorMessage(`Fliwright tests failed: ${result.failedTests}`, 'Open Failure').then((selection) => {
          if (selection === 'Open Failure' && failures[0]) failurePanel.open(failures[0]);
        });
      } else {
        vscode.window.showInformationMessage(`Fliwright tests passed: ${result.passedTests}/${result.totalTests}`);
      }
    });
  }
}

function mcpInstructions(): string {
  return `# Fliwright MCP Setup

Add the Fliwright MCP server to your AI coding tool configuration:

\`\`\`json
{
  "mcpServers": {
    "fliwright": {
      "command": "pnpm",
      "args": ["--filter", "@fliwright/mcp", "start"]
    }
  }
}
\`\`\`

Available tools:

- \`fliwright_run\`: run a Fliwright test file.
- \`fliwright_get_failure\`: inspect structured failure context.
- \`fliwright_generate_test\`: generate tests from Flutter source.
- \`fliwright_record\`: record interactions and generate test code.
- \`fliwright_mock_list\`: list loaded mock endpoints and active rules.
- \`fliwright_mock_switch\`: switch an endpoint's active mock rule.

Use \`FLIWRIGHT_VM_URL\` or the VS Code connection command to point Fliwright at a running Flutter VM Service.
`;
}

export function deactivate(): void {
  output?.dispose();
}

async function openUriFromNode(node?: { uri?: vscode.Uri }): Promise<void> {
  if (!node?.uri) return;
  await vscode.window.showTextDocument(node.uri);
}

function formRulesNode(node?: FormRulesEntry): FormRulesEntry | undefined {
  return node?.kind === 'formRulesFile' ? node : undefined;
}

async function insertFormFieldRuleAtCursor(node: FormAnalyzeFieldEntry): Promise<void> {
  const active = vscode.window.activeTextEditor;
  if (!active) throw new Error('Open a form rules JSON file and place the cursor where the selector should be inserted.');

  const snippet = JSON.stringify(formRuleSnippet(node.field), null, 2);
  const selection = active.selection;
  await active.edit((builder) => {
    builder.insert(selection.active, snippet);
  });
  vscode.window.showInformationMessage(`Inserted selector ${node.field.selector}`);
}

function formRuleSnippet(field: FormAnalyzeResult['fields'][number]): {
  match: { selector: string };
  type: 'PRESET_SKILL';
  data: string[];
} {
  return {
    match: {
      selector: field.selector,
    },
    type: 'PRESET_SKILL',
    data: field.generatedValue ? [field.generatedValue] : [],
  };
}

async function showFormPreview(
  service: FormHelperService,
  result: FormAnalyzeResult,
  title: string,
  canPickMany = false,
): Promise<string[] | undefined> {
  const preview = service.previewFields(result);
  if (preview.length === 0) {
    vscode.window.showInformationMessage('No fillable form fields found on the current screen.');
    return undefined;
  }

  const items = preview.map((field) => ({
    label: field.label,
    description: field.semanticType,
    detail: field.generatedValue,
    hint: field.label,
    picked: true,
  }));
  const selection = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: canPickMany
      ? 'Select fields to fill. Generated values are shown below each field.'
      : 'Generated values preview. Press Enter to close.',
    canPickMany,
  });
  if (!selection) return undefined;
  return Array.isArray(selection)
    ? selection.map((item) => item.hint)
    : [selection.hint];
}

function requireWorkspaceRoot(): vscode.Uri {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error('Open a workspace to use Fliwright.');
  }
  return root;
}

function appendFormFillDebug(result: FormFillResult): void {
  for (const line of formatFormFillDebug(result)) output.appendLine(line);
}

async function runCommand(label: string, action: () => Promise<void>): Promise<void> {
  try {
    output.appendLine(`[${new Date().toISOString()}] ${label}`);
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(message);
    vscode.window.showErrorMessage(message, 'Open Output').then((selection) => {
      if (selection === 'Open Output') output.show();
    });
  }
}

async function withWindowProgress<T>(title: string, task: () => Promise<T>): Promise<T> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title,
    },
    task,
  );
}
