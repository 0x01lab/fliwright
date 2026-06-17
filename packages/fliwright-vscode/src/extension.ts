import * as fs from 'node:fs';
import * as vscode from 'vscode';
import type { FormAnalyzeResult, FormFillResult } from '@fliwright/core';
import { setConnectorDebugLog } from '@fliwright/core';
import { getWorkspaceRoot, loadConfig, resolveWorkspacePath } from './config.js';
import { FailureContextStore } from './failure/FailureContextStore.js';
import { formRuleSnippetForField, formRulesFileName, FormHelperService, formatFormFillDebug, dataSetLabels } from './form/FormHelperService.js';
import { FormRuleService } from './form/FormRuleService.js';
import { RecorderService } from './recording/RecorderService.js';
import { FliwrightCodeLensProvider } from './runner/FliwrightCodeLensProvider.js';
import { TestDiscoveryService } from './runner/TestDiscoveryService.js';
import { VitestRunner } from './runner/VitestRunner.js';
import { ScriptDiscoveryService } from './scripts/ScriptDiscoveryService.js';
import { ScriptRunner } from './scripts/ScriptRunner.js';
import { FliwrightSession } from './session/FliwrightSession.js';
import { discoverVmServiceCandidates, extractVmServiceUrls } from './session/VmServiceDiscovery.js';
import { MockConfigService } from './sandbox/MockConfigService.js';
import { MockRuleSelectionStore } from './sandbox/MockRuleSelectionStore.js';
import { formatMockRuleDebug, SandboxService } from './sandbox/SandboxService.js';
import { STATE_PROVIDER_DOCUMENT_SCHEME, StateProviderDocumentProvider } from './state/StateProviderDocumentProvider.js';
import { StateInjectionService } from './state/StateInjectionService.js';
import { StatusBarService } from './status/StatusBarService.js';
import type { FailureTreeEntry, FormAnalyzeFieldEntry, FormRule, FormRulesEntry, InvalidFileEntry, MockDiscoveryResult, MockEndpointEntry, MockRuleEntry, RunEntry, RunResult, ScriptFileEntry, StateProviderEntry, TestFileEntry } from './types.js';
import { DevicesTreeProvider } from './views/DevicesTreeProvider.js';
import { FormDataTreeProvider } from './views/FormDataTreeProvider.js';
import { MockApiTreeProvider, mockFileNameFromInput } from './views/MockApiTreeProvider.js';
import { RunsTreeProvider } from './views/RunsTreeProvider.js';
import { ScriptsTreeProvider } from './views/ScriptsTreeProvider.js';
import { StateTreeProvider } from './views/StateTreeProvider.js';
import { TestsTreeProvider } from './views/TestsTreeProvider.js';
import { FailurePanel } from './webview/FailurePanel.js';
import { EditorBridge } from './editor/EditorBridge.js';
import { TestEditorProvider } from './editor/TestEditorProvider.js';
import { setEditorOutput } from './editor/TestEditorPanel.js';
import { RecordingPanel } from './webview/RecordingPanel.js';
import { TraceViewerPanel } from './trace/TraceViewerPanel.js';
import { TraceService } from './trace/TraceService.js';
import { TraceStore } from '@fliwright/core';
import type { TraceMode } from '@fliwright/core';

let output: vscode.OutputChannel;
const LAST_VM_SERVICE_URL_KEY = 'fliwright.vmServiceUrl.lastSuccess';
const MOCK_AUTO_DEFAULTS_SUPPRESSED_KEY = 'fliwright.mock.autoDefaultsSuppressed.v1';
const MOCK_SUPPRESSED_ENDPOINTS_KEY = 'fliwright.mock.suppressedEndpoints.v1';
const DEBUG_LOG_BUFFER_LIMIT = 20000;
const CONNECTION_HEALTH_CHECK_INTERVAL_MS = 5000;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel('Fliwright');
  context.subscriptions.push(output);
  setEditorOutput(output);

  // Route VM Service debug logs to the output channel
  setConnectorDebugLog((message) => output.appendLine(message));

  const mockService = new MockConfigService();
  const mockSelectionStore = new MockRuleSelectionStore(context.workspaceState);
  const formService = new FormRuleService();
  const session = new FliwrightSession();
  const sandboxService = new SandboxService();
  const formHelperService = new FormHelperService();
  const testDiscoveryService = new TestDiscoveryService();
  const scriptDiscoveryService = new ScriptDiscoveryService();
  const runner = new VitestRunner();
  const scriptRunner = new ScriptRunner();
  const failureStore = new FailureContextStore();
  const recorderService = new RecorderService();
  const stateService = new StateInjectionService();
  const stateProviderDocuments = new StateProviderDocumentProvider();
  const devicesTree = new DevicesTreeProvider();
  const mockTree = new MockApiTreeProvider(mockService);
  const formTree = new FormDataTreeProvider(formService);
  const testsTree = new TestsTreeProvider(testDiscoveryService);
  const scriptsTree = new ScriptsTreeProvider(scriptDiscoveryService);
  const runsTree = new RunsTreeProvider();
  const stateTree = new StateTreeProvider();
  const statusBar = new StatusBarService();
  const failurePanel = new FailurePanel(context.extensionUri);
  const recordingPanel = new RecordingPanel(context.extensionUri, {
    onSetFrameIncluded: async (frameId, included) => {
      try {
        const recording = await recorderService.setFrameIncluded(session.connectedDriver, frameId, included, getWorkspaceRoot());
        updateRecordingViews(recording);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`Failed to update recorded frame: ${message}`);
        vscode.window.showWarningMessage(message);
      }
    },
  });
  const traceService = new TraceService();
  const traceViewerPanel = new TraceViewerPanel(context.extensionUri);
  void updateRecordingContext(recorderService.getSession());

  context.subscriptions.push(session);
  context.subscriptions.push(statusBar);
  context.subscriptions.push(
    stateProviderDocuments,
    vscode.workspace.registerTextDocumentContentProvider(STATE_PROVIDER_DOCUMENT_SCHEME, stateProviderDocuments),
  );
  context.subscriptions.push(session.onDidChangeState((state) => {
    devicesTree.setState(state);
    statusBar.setConnectionState(state);
  }));

  let debugLogBuffer = '';
  let autoConnectTimer: ReturnType<typeof setTimeout> | undefined;
  let healthCheckTimer: ReturnType<typeof setInterval> | undefined;
  let healthCheckInFlight = false;
  let mockSyncInFlight: Promise<void> | undefined;
  let mockSyncQueued = false;
  const stateProviderWatches = new Map<string, () => void>();

  const rememberDebugOutput = (text: string) => {
    debugLogBuffer = `${debugLogBuffer}${text}`.slice(-DEBUG_LOG_BUFFER_LIMIT);
    const urls = extractVmServiceUrls(debugLogBuffer);
    const latestUrl = urls.at(-1);
    if (!latestUrl) return;

    scheduleAutoConnect('Flutter debug output', 100, {
      forceReconnect: Boolean(session.currentUrl && session.currentUrl !== latestUrl),
    });
  };

  const scheduleAutoConnect = (reason: string, delayMs = 0, options: { forceReconnect?: boolean } = {}) => {
    if (!loadConfig().autoDiscoverVmService) return;
    if (autoConnectTimer) clearTimeout(autoConnectTimer);
    autoConnectTimer = setTimeout(() => {
      autoConnectTimer = undefined;
      void discoverAndConnect({ reason, interactive: false, forceReconnect: options.forceReconnect });
    }, delayMs);
  };

  const stopHealthCheck = () => {
    if (!healthCheckTimer) return;
    clearInterval(healthCheckTimer);
    healthCheckTimer = undefined;
  };

  const startHealthCheck = () => {
    stopHealthCheck();
    healthCheckTimer = setInterval(() => {
      if (healthCheckInFlight) return;
      if (!isActiveSessionState(session.state.status)) {
        stopHealthCheck();
        return;
      }

      healthCheckInFlight = true;
      void session.verifyConnection().then(async (healthy) => {
        if (healthy) return;
        const staleUrl = session.currentUrl;
        const message = 'VM Service connection lost. Searching for a new Flutter VM Service...';
        output.appendLine(`${message}${staleUrl ? ` (${staleUrl})` : ''}`);
        clearStateProviderWatches();
        sandboxService.resetController();
        await session.markConnectionLost(message);
        scheduleAutoConnect('VM Service connection lost', 100, { forceReconnect: true });
      }).finally(() => {
        healthCheckInFlight = false;
      });
    }, CONNECTION_HEALTH_CHECK_INTERVAL_MS);
  };

  const requestMockStateSync = async (
    reason: string,
    options: { restoreSelections?: boolean; applyDefaultRules?: boolean } = {},
  ): Promise<void> => {
    if (mockSyncInFlight) {
      mockSyncQueued = true;
      output.appendLine(`Mock state sync queued (${reason}); another sync is running.`);
      await mockSyncInFlight;
      return;
    }

    mockSyncInFlight = (async () => {
      do {
        mockSyncQueued = false;
        if (!isActiveSessionState(session.state.status)) {
          output.appendLine(
            `Mock state sync skipped (${reason}): VM Service is not connected `
            + `(status=${session.state.status}). Clearing local mock active markers.`,
          );
          sandboxService.resetController();
          mockTree.setAppliedRules([]);
          return;
        }

        if (!mockTree.currentResult) {
          output.appendLine(`Mock state sync (${reason}): loading workspace mock configs.`);
          await mockTree.refresh();
        }
        const discovery = mockTree.currentResult;
        if (!discovery) {
          output.appendLine(`Mock state sync skipped (${reason}): no workspace mock discovery result.`);
          return;
        }

        await waitForFlutterMockExtension(session.connectedDriver, reason);
        output.appendLine(
          `Mock state sync started (${reason}): `
          + `${discovery.endpoints.length} endpoint file(s), ${discovery.invalid.length} invalid file(s).`,
        );
        output.appendLine(
          `[MockStateSync] request reason=${reason} `
          + `restoreSelections=${options.restoreSelections === true} `
          + `applyDefaultRules=${options.applyDefaultRules === true}`,
        );
        await synchronizeMockStateAfterConnect(discovery, options);
      } while (mockSyncQueued);
    })().finally(() => {
      mockSyncInFlight = undefined;
    });

    await mockSyncInFlight;
  };

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterTrackerFactory('*', {
      createDebugAdapterTracker(debugSession) {
        const sessionIdentity = `${debugSession.type} ${debugSession.name}`;
        const isFlutterOrDart = /flutter|dart/i.test(sessionIdentity);
        return {
          onDidSendMessage(message: unknown) {
            if (!isFlutterOrDart || typeof message !== 'object' || message === null) return;
            const event = message as { type?: string; event?: string; body?: { output?: unknown } };
            if (event.type !== 'event' || event.event !== 'output' || typeof event.body?.output !== 'string') return;
            rememberDebugOutput(event.body.output);
          },
        };
      },
    }),
    vscode.debug.onDidStartDebugSession((debugSession) => {
      if (/flutter|dart/i.test(`${debugSession.type} ${debugSession.name}`)) {
        scheduleAutoConnect('Flutter debug session', 500);
      }
    }),
    {
      dispose() {
        if (autoConnectTimer) clearTimeout(autoConnectTimer);
        stopHealthCheck();
        clearStateProviderWatches();
      },
    },
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('fliwright.devices', devicesTree),
    vscode.window.registerTreeDataProvider('fliwright.mockApis', mockTree),
    vscode.window.registerTreeDataProvider('fliwright.formData', formTree),
    vscode.window.registerTreeDataProvider('fliwright.scripts', scriptsTree),
    vscode.window.registerTreeDataProvider('fliwright.tests', testsTree),
    vscode.window.registerTreeDataProvider('fliwright.runs', runsTree),
    vscode.window.registerTreeDataProvider('fliwright.state', stateTree),
    vscode.languages.registerCodeLensProvider(
      [{ language: 'typescript', scheme: 'file' }, { language: 'typescriptreact', scheme: 'file' }],
      new FliwrightCodeLensProvider(),
    ),
  );

  // ── Visual Test Editor ──────────────────────────────
  const editorProvider = new TestEditorProvider(context.extensionUri);
  const editorBridge = new EditorBridge();

  output.appendLine('[FliwrightEditor] Registering custom editor provider...');

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'fliwright.testEditor',
      editorProvider,
      { supportsMultipleEditorsPerDocument: false },
    ),
  );

  output.appendLine('[FliwrightEditor] Custom editor provider registered.');

  context.subscriptions.push(
    vscode.commands.registerCommand('fliwright.openVisualEditor', async (uri?: vscode.Uri) => {
      output.appendLine('[FliwrightEditor] openVisualEditor command called, uri: ' + (uri?.fsPath ?? 'none'));
      if (!uri) {
        const active = vscode.window.activeTextEditor;
        output.appendLine('[FliwrightEditor] activeTextEditor: ' + (active ? active.document.uri.fsPath : 'none'));
        if (active) {
          uri = active.document.uri;
        }
      }
      if (!uri) {
        // Fallback: pick from visible editors
        const visible = vscode.window.visibleTextEditors;
        output.appendLine('[FliwrightEditor] visible editors: ' + visible.map(e => e.document.uri.fsPath).join(', '));
        const testEditor = visible.find(e => e.document.uri.fsPath.endsWith('.test.ts') || e.document.uri.fsPath.endsWith('.spec.ts'));
        if (testEditor) {
          uri = testEditor.document.uri;
        }
      }
      if (!uri) {
        // Last fallback: file picker
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { 'Test Files': ['ts'] },
          title: 'Select a test file to open in Visual Editor',
        });
        if (picked && picked.length > 0) {
          uri = picked[0];
        }
      }
      if (uri) {
        output.appendLine('[FliwrightEditor] Opening: ' + uri.fsPath);
        await vscode.commands.executeCommand('vscode.openWith', uri, 'fliwright.testEditor');
      } else {
        output.appendLine('[FliwrightEditor] No URI found, aborting.');
      }
    }),
  );

  scheduleAutoConnect('Extension activation', 500);

  context.subscriptions.push(
    vscode.commands.registerCommand('fliwright.reloadMocks', async () => {
      await runCommand('Reload Mock Configs', async () => {
        await mockTree.refresh();
        await requestMockStateSync('mock configs reloaded', {
          restoreSelections: false,
          applyDefaultRules: false,
        });
      });
    }),
    vscode.commands.registerCommand('fliwright.reloadFormRules', async () => {
      await runCommand('Reload Form Rules', async () => {
        await formTree.refresh();
      });
    }),
    vscode.commands.registerCommand('fliwright.reloadScripts', async () => {
      await runCommand('Reload Scripts', async () => {
        scriptsTree.refresh();
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
          await onConnected(state.url, true);
        } else if (state.status === 'error') {
          throw new Error(state.message);
        }
      });
    }),
    vscode.commands.registerCommand('fliwright.disconnect', async () => {
      await runCommand('Disconnect VM Service', async () => {
        stopHealthCheck();
        clearStateProviderWatches();
        sandboxService.resetController();
        await session.disconnect();
        vscode.window.showInformationMessage('Disconnected from VM Service');
      });
    }),
    vscode.commands.registerCommand('fliwright.discoverVmService', async () => {
      await runCommand('Discover VM Service', async () => {
        const connected = await discoverAndConnect({ reason: 'Manual scan', interactive: true, forceReconnect: true });
        if (!connected) {
          vscode.window.showWarningMessage('No local Flutter VM Service found.');
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
    vscode.commands.registerCommand('fliwright.openScript', async (node?: ScriptFileEntry) => {
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
        await setMockAutoDefaultsSuppressed(false);
        await unsuppressMockEndpoint(node);
        output.appendLine(`Applying mock ${formatMockRuleDebug(node)}`);
        const applied = await sandboxService.applyRule(session.connectedDriver, node);
        await mockSelectionStore.saveAppliedRule(applied);
        mockTree.setAppliedRules(sandboxService.getAppliedRules());
        output.appendLine(`Applied mock ${applied.method} ${applied.endpoint} -> ${applied.ruleName}`);
        await appendMockControllerDebug('Flutter mock routes after apply:');
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
          await appendMockControllerDebug('Flutter mock routes remain:');
          vscode.window.showWarningMessage(`Mock rule is not active: ${node.method} ${node.endpoint} -> ${node.rule.name}`);
          return;
        }
        await suppressMockEndpoint(node);
        await mockSelectionStore.removeRule(node);
        output.appendLine(`Stopped mock ${node.method} ${node.endpoint} -> ${node.rule.name}`);
        await appendMockControllerDebug('Flutter mock routes after stop:');
        vscode.window.showInformationMessage(`Stopped ${node.method} ${node.endpoint} -> ${node.rule.name}`);
      });
    }),
    vscode.commands.registerCommand('fliwright.applyDefaultMocks', async () => {
      await runCommand('Apply Default Mocks', async () => {
        await setMockAutoDefaultsSuppressed(false);
        await clearSuppressedMockEndpoints();
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
        await mockSelectionStore.clear();
        mockTree.setAppliedRules(sandboxService.getAppliedRules());
        output.appendLine(`Applied ${result.applied.length} default mock route(s), skipped ${result.skipped}.`);
        await appendMockControllerDebug('Flutter mock routes after apply-default:');
        vscode.window.showInformationMessage(`Applied ${result.applied.length} default mock route(s).`);
      });
    }),
    vscode.commands.registerCommand('fliwright.stopSandbox', async () => {
      await runCommand('Stop All Mock Routes', async () => {
        const count = await sandboxService.clear(session.connectedDriver);
        await setMockAutoDefaultsSuppressed(true);
        await clearSuppressedMockEndpoints();
        await mockSelectionStore.clear();
        mockTree.setAppliedRules([]);
        output.appendLine(`Stopped all mock routes (${count} tracked route(s)).`);
        await appendMockControllerDebug('Flutter mock routes after clear:');
        vscode.window.showInformationMessage('Stopped all mock routes.');
      });
    }),
    vscode.commands.registerCommand('fliwright.analyzeForm', async (node?: FormRulesEntry) => {
      await runCommand('Analyze Current Form', async () => {
        const root = requireWorkspaceRoot();
        const resolvedNode = formRulesNode(node);
        const dataIndex = await pickDataIndex(resolvedNode);
        const result = await withWindowProgress('Fliwright: analyzing current form fields...', () => (
          formHelperService.analyze(session.connectedDriver, root, resolvedNode, dataIndex)
        ));
        formTree.setLastSummary(formHelperService.getLastSummary());
        formTree.setLastAnalyze(formHelperService.getLastAnalyze());
        await showFormPreview(formHelperService, result, 'Analyze Current Form');
        output.appendLine(`Analyzed ${result.fields.length} form field(s) with ${formRulesFileName(resolvedNode)}${dataIndexLabel(dataIndex)}.`);
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
    vscode.commands.registerCommand('fliwright.runScript', async (node?: ScriptFileEntry) => {
      await runScript(node);
    }),
    vscode.commands.registerCommand('fliwright.openFailure', async (node?: FailureTreeEntry) => {
      const failure = node?.kind === 'failure' ? node.failure : runsTree.failuresList[0];
      if (!failure) return;

      // Open visual editor if source file is available, otherwise fall back to FailurePanel
      if (failure.source?.file) {
        const uri = vscode.Uri.file(failure.source.file);
        await vscode.commands.executeCommand('vscode.openWith', uri, 'fliwright.testEditor');
      } else {
        failurePanel.open(failure);
      }
    }),
    vscode.commands.registerCommand('fliwright.openTraceViewer', async () => {
      await traceViewerPanel.openWithPicker();
    }),
    vscode.commands.registerCommand('fliwright.showLastTrace', async () => {
      await traceViewerPanel.openLatest();
    }),
    vscode.commands.registerCommand('fliwright.startRecording', async () => {
      await runCommand('Start Recording', async () => {
        const testName = await vscode.window.showInputBox({
          title: 'Start Fliwright Recording',
          prompt: 'Generated test name',
          value: 'recorded test',
        });
        if (testName === undefined) return;

        try {
          session.setRecording();
          const pendingRecording = {
            status: 'recording' as const,
            startedAt: Date.now(),
            rawEventCount: 0,
            operationCount: 0,
            frames: [],
            testName: testName.trim() || 'recorded test',
          };
          updateRecordingViews(pendingRecording);
          recordingPanel.open(pendingRecording);
          output.appendLine(`[debug] session state: ${session.state.status}`);
          output.appendLine(`[debug] calling recorderService.start()...`);
          const recording = await recorderService.start(session.connectedDriver, {
            testName: testName.trim() || 'recorded test',
            onDidChange: updateRecordingViews,
          });
          output.appendLine(`[debug] start returned: status=${recording.status} rawEvents=${recording.rawEventCount} operations=${recording.operationCount}`);
          updateRecordingViews(recording);
          recordingPanel.open(recording);
          vscode.window.showInformationMessage('Fliwright recording started.');
        } catch (error) {
          output.appendLine(`[debug] start FAILED: ${error instanceof Error ? error.message : String(error)}`);
          session.setConnectedIdle();
          updateRecordingViews(recorderService.reset());
          throw error;
        }
      });
    }),
    vscode.commands.registerCommand('fliwright.stopRecording', async () => {
      await runCommand('Stop Recording', async () => {
        try {
          output.appendLine(`[debug] calling recorderService.stop()...`);
          const recording = await recorderService.stop(session.connectedDriver, vscode.window.activeTextEditor?.document.uri, {}, getWorkspaceRoot());
          output.appendLine(`[debug] stop returned: status=${recording.status} rawEvents=${recording.rawEventCount} operations=${recording.operationCount}`);
          updateRecordingViews(recording);
          // Open visual editor if target file is available, otherwise fall back to RecordingPanel
          if (recording.targetFile) {
            const uri = vscode.Uri.file(recording.targetFile);
            await vscode.commands.executeCommand('vscode.openWith', uri, 'fliwright.testEditor');
          } else {
            recordingPanel.open(recording);
          }
          session.setConnectedIdle();
          output.appendLine(`Recorded ${recording.operationCount} operation(s).`);
          vscode.window.showInformationMessage(`Recorded ${recording.operationCount} operation(s).`, 'Insert Test').then((selection) => {
            if (selection === 'Insert Test') void vscode.commands.executeCommand('fliwright.insertRecordedTest');
          });
        } catch (error) {
          output.appendLine(`[debug] stop FAILED: ${error instanceof Error ? error.message : String(error)}`);
          session.setConnectedIdle();
          updateRecordingViews(recorderService.reset());
          throw error;
        }
      });
    }),
    vscode.commands.registerCommand('fliwright.insertRecordedTest', async () => {
      await runCommand('Insert Recorded Test', async () => {
        const root = requireWorkspaceRoot();
        const target = await vscode.window.showQuickPick([
          { label: 'Save as New Test File', action: 'save' as const },
          { label: 'Insert at Active Editor Cursor', action: 'insert' as const },
        ], {
          title: 'Insert Recorded Test',
          placeHolder: 'Choose where to put the generated test',
        });
        if (!target) return;

        if (target.action === 'insert') {
          const uri = await recorderService.insertGeneratedCode();
          updateRecordingViews(recorderService.getSession());
          vscode.window.showInformationMessage(`Inserted recorded test into ${uri.fsPath}`);
          return;
        }

        const defaultUri = resolveWorkspacePath(root, `tests/recorded-${Date.now()}.test.ts`);
        const uri = await vscode.window.showSaveDialog({
          title: 'Save Recorded Test',
          defaultUri,
          filters: { 'TypeScript Test': ['ts'] },
        });
        if (!uri) return;

        const saved = await recorderService.saveGeneratedCode(root, uri);
        updateRecordingViews(recorderService.getSession());
        vscode.window.showInformationMessage(`Saved recorded test to ${saved.fsPath}`);
      });
    }),
    vscode.commands.registerCommand('fliwright.openRecording', async () => {
      await runCommand('Open Saved Recording', async () => {
        const root = requireWorkspaceRoot();
        const recordings = await recorderService.listPersistedRecordings(root);
        if (recordings.length === 0) {
          vscode.window.showInformationMessage('No saved Fliwright recordings found.');
          return;
        }
        const selected = await vscode.window.showQuickPick(recordings.map((recording) => ({
          label: recording.label,
          description: recording.description,
          detail: recording.recordingDir.fsPath,
          recording,
        })), {
          title: 'Open Saved Fliwright Recording',
          placeHolder: 'Choose a persisted recording session',
        });
        if (!selected) return;

        const loaded = await recorderService.loadPersistedRecording(selected.recording.recordingDir);
        updateRecordingViews(loaded);
        recordingPanel.open(loaded);
      });
    }),
    vscode.commands.registerCommand('fliwright.refreshStateProviders', async () => {
      await runCommand('Refresh State Providers', async () => {
        const providers = await stateService.listProviders(session.connectedDriver);
        if (providers.length === 0) {
          const status = await stateService.status(session.connectedDriver).catch(() => undefined);
          const message = stateProvidersEmptyMessage(status);
          stateTree.setMessage(message);
          output.appendLine(`State providers empty: ${message}`);
          if (status) output.appendLine(`Riverpod status: ${JSON.stringify(status)}`);
          vscode.window.showInformationMessage(`Loaded 0 provider(s): ${message}`);
          return;
        } else {
          stateTree.setProviders(markActiveWatches(providers));
        }
        vscode.window.showInformationMessage(`Loaded ${providers.length} provider(s).`);
      });
    }),
    vscode.commands.registerCommand('fliwright.readStateProvider', async (node?: StateProviderEntry) => {
      await runCommand('Read State Provider', async () => {
        if (!node || node.kind !== 'stateProvider') throw new Error('Select a state provider to read.');
        const value = await stateService.read(session.connectedDriver, node.key);
        const provider = { ...node, value, watching: stateProviderWatches.has(node.key) };
        stateTree.updateProvider(provider);
        output.appendLine(`${node.key}: ${JSON.stringify(value)}`);
        await openStateProviderDocument(stateProviderDocuments, provider, value);
        vscode.window.showInformationMessage(`Opened ${node.key} value.`);
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
        const parsed = JSON.parse(raw);
        const overrideResult = await stateService.override(session.connectedDriver, node.key, parsed);
        const providers = await stateService.listProviders(session.connectedDriver).catch(() => [{ ...node, value: parsed }]);
        stateTree.setProviders(markActiveWatches(providers));
        if (!overrideResult.overridden) {
          vscode.window.showWarningMessage(overrideResult.message ?? `Provider is not registered as overridable: ${node.key}`);
          return;
        }
        vscode.window.showInformationMessage(`Overrode ${node.key}.`);
      });
    }),
    vscode.commands.registerCommand('fliwright.watchStateProvider', async (node?: StateProviderEntry) => {
      await runCommand('Watch State Provider', async () => {
        if (!node || node.kind !== 'stateProvider') throw new Error('Select a state provider to watch.');
        if (stateProviderWatches.has(node.key)) {
          vscode.window.showInformationMessage(`Already watching ${node.key}.`);
          return;
        }
        const unsubscribe = await stateService.watch(session.connectedDriver, node.key, (oldValue, newValue) => {
          output.appendLine(`${node.key}: ${JSON.stringify(oldValue)} -> ${JSON.stringify(newValue)}`);
          const provider = {
            ...node,
            value: newValue,
            watching: true,
          };
          stateTree.updateProvider(provider);
          void openStateProviderDocument(stateProviderDocuments, provider, newValue, { preserveFocus: true });
        });
        stateProviderWatches.set(node.key, unsubscribe);
        stateTree.updateProvider({ ...node, watching: true });
        vscode.window.showInformationMessage(`Watching ${node.key}.`);
      });
    }),
    vscode.commands.registerCommand('fliwright.unwatchStateProvider', async (node?: StateProviderEntry) => {
      await runCommand('Unwatch State Provider', async () => {
        if (!node || node.kind !== 'stateProvider') throw new Error('Select a state provider to unwatch.');
        const unsubscribe = stateProviderWatches.get(node.key);
        if (!unsubscribe) {
          vscode.window.showInformationMessage(`Not watching ${node.key}.`);
          return;
        }
        unsubscribe();
        stateProviderWatches.delete(node.key);
        stateTree.updateProvider({ ...node, watching: false });
        vscode.window.showInformationMessage(`Stopped watching ${node.key}.`);
      });
    }),
    vscode.commands.registerCommand('fliwright.copyStateProviderValue', async (node?: StateProviderEntry) => {
      await runCommand('Copy State Provider Value', async () => {
        if (!node || node.kind !== 'stateProvider') throw new Error('Select a state provider to copy.');
        const value = node.value === undefined
          ? await stateService.read(session.connectedDriver, node.key)
          : node.value;
        await vscode.env.clipboard.writeText(formatStateValue(value));
        stateTree.updateProvider({ ...node, value, watching: stateProviderWatches.has(node.key) });
        vscode.window.showInformationMessage(`Copied ${node.key}.`);
      });
    }),
    vscode.commands.registerCommand('fliwright.openRiverpodSetupHelp', async () => {
      await runCommand('Open Riverpod Setup Help', async () => {
        const document = await vscode.workspace.openTextDocument({
          language: 'markdown',
          content: riverpodSetupInstructions(),
        });
        await vscode.window.showTextDocument(document);
      });
    }),
  );

  await Promise.all([mockTree.refresh(), formTree.refresh(), Promise.resolve(scriptsTree.refresh())]);
  output.appendLine('Fliwright extension activated.');

  async function fillFormWithRules(node?: FormRulesEntry): Promise<void> {
    await runCommand('Fill Current Form', async () => {
      const root = requireWorkspaceRoot();
      const dataIndex = await pickDataIndex(node);
      if (loadConfig().formPreviewBeforeFill) {
        const analysis = await withWindowProgress('Fliwright: analyzing current form fields...', () => (
          formHelperService.analyze(session.connectedDriver, root, node, dataIndex)
        ));
        formTree.setLastSummary(formHelperService.getLastSummary());
        formTree.setLastAnalyze(formHelperService.getLastAnalyze());
        const selectedHints = await showFormPreview(formHelperService, analysis, 'Fill Current Form', true);
        if (!selectedHints) return;
        const result = await withWindowProgress('Fliwright: filling selected form fields...', () => (
          formHelperService.fillSelected(session.connectedDriver, root, selectedHints, node, dataIndex)
        ));
        formTree.setLastSummary(formHelperService.getLastSummary());
        formTree.setLastAnalyze(formHelperService.getLastAnalyze());
        output.appendLine(`Filled selected form fields with ${formRulesFileName(node)}${dataIndexLabel(dataIndex)}: ${result.filled} filled, ${result.skipped} skipped, ${result.errors.length} errors.`);
        appendFormFillDebug(result);
        vscode.window.showInformationMessage(`Filled ${result.filled} field(s), skipped ${result.skipped}, errors ${result.errors.length}.`);
        return;
      }
      const result = await withWindowProgress('Fliwright: filling current form...', () => (
        formHelperService.fill(session.connectedDriver, root, node, dataIndex)
      ));
      formTree.setLastSummary(formHelperService.getLastSummary());
      formTree.setLastAnalyze(formHelperService.getLastAnalyze());
      output.appendLine(`Filled form with ${formRulesFileName(node)}${dataIndexLabel(dataIndex)}: ${result.filled} filled, ${result.skipped} skipped, ${result.errors.length} errors.`);
      appendFormFillDebug(result);
      vscode.window.showInformationMessage(`Filled ${result.filled} field(s), skipped ${result.skipped}, errors ${result.errors.length}.`);
    });
  }

  async function pickDataIndex(node?: FormRulesEntry): Promise<number | undefined> {
    const rules = resolveRules(node);
    if (!rules) return undefined;
    const sets = dataSetLabels(rules);
    if (sets.length <= 1) return undefined;
    const picked = await vscode.window.showQuickPick(
      sets.map(s => ({ label: s.label, description: s.description, index: s.index })),
      { placeHolder: 'Select a data set for form filling' },
    );
    output.appendLine(`[debug] pickDataIndex: selected index=${picked?.index}, total sets=${sets.length}`);
    return picked?.index;
  }

  function resolveRules(node?: FormRulesEntry): FormRule[] | undefined {
    if (node?.rulesFile.rules) return node.rulesFile.rules;
    const config = loadConfig();
    const root = getWorkspaceRoot();
    if (config.formRulesFile && root) {
      const filePath = resolveWorkspacePath(root, config.formRulesFile).fsPath;
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (data.rules) return data.rules;
      } catch { /* ignore */ }
    }
    return undefined;
  }

  function dataIndexLabel(dataIndex?: number): string {
    return dataIndex !== undefined ? ` [data set ${dataIndex + 1}]` : '';
  }

  function updateRecordingViews(recording: ReturnType<RecorderService['getSession']>): void {
    statusBar.setRecording(recording);
    recordingPanel.update(recording);
    void updateRecordingContext(recording);

    // When recording completes, open visual editor instead of RecordingPanel
    if (recording.status === 'preview' && recording.targetFile) {
      const uri = vscode.Uri.file(recording.targetFile);
      void vscode.commands.executeCommand('vscode.openWith', uri, 'fliwright.testEditor');
    }
  }

  async function updateRecordingContext(recording: ReturnType<RecorderService['getSession']>): Promise<void> {
    await Promise.all([
      vscode.commands.executeCommand('setContext', 'fliwright.recording.isRecording', recording.status === 'recording'),
      vscode.commands.executeCommand('setContext', 'fliwright.recording.hasPreview', recording.status === 'preview' && Boolean(recording.generatedCode)),
    ]);
  }

  async function discoverAndConnect(options: { reason: string; interactive: boolean; forceReconnect?: boolean }): Promise<boolean> {
    if (isActiveSessionState(session.state.status) && !options.forceReconnect) {
      return true;
    }

    if (options.forceReconnect) {
      stopHealthCheck();
      clearStateProviderWatches();
      sandboxService.resetController();
      await session.disconnect(false);
    }

    session.setScanning(options.reason, options.forceReconnect);
    const candidates = await discoverVmServiceCandidates({
      cachedUrl: context.workspaceState.get<string>(LAST_VM_SERVICE_URL_KEY),
      logText: debugLogBuffer,
    });

    if (candidates.length === 0) {
      await session.disconnect();
      sandboxService.resetController();
      output.appendLine(`VM Service discovery found no candidates (${options.reason}).`);
      return false;
    }

    let orderedCandidates = candidates;
    if (options.interactive && candidates.length > 1) {
      const items = candidates.map((candidate) => ({
        label: candidate.url,
        description: candidate.label,
        detail: `Source: ${candidate.source}, confidence: ${candidate.confidence}`,
        candidate,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        title: 'Select Flutter VM Service',
        placeHolder: 'Choose a VM Service URL to connect',
      });
      if (!picked) {
        await session.disconnect();
        sandboxService.resetController();
        return false;
      }
      orderedCandidates = [picked.candidate];
    }

    let lastError: string | undefined;
    for (const candidate of orderedCandidates) {
      output.appendLine(`Trying VM Service candidate from ${candidate.source}: ${candidate.url}`);
      const state = await session.connect(candidate.url);
      if (state.status === 'connected') {
        await onConnected(state.url, options.interactive);
        return true;
      }
      if (state.status === 'error') {
        lastError = state.message;
        output.appendLine(`VM Service candidate failed: ${candidate.url} (${state.message})`);
      }
    }

    if (options.interactive && lastError) {
      throw new Error(lastError);
    }
    await session.disconnect();
    sandboxService.resetController();
    return false;
  }

  async function onConnected(url: string, notify: boolean): Promise<void> {
    await context.workspaceState.update(LAST_VM_SERVICE_URL_KEY, url);
    startHealthCheck();
    await appendMockStartupDebug();
    await configureMocksAfterConnect();
    output.appendLine(`Connected to VM Service: ${url}`);
    if (notify) {
      vscode.window.showInformationMessage(`Connected to ${url}`);
    }
  }

  async function configureMocksAfterConnect(): Promise<void> {
    const config = loadConfig();

    if (config.autoStartMockController) {
      await sandboxService.ensureController(session.connectedDriver);
      output.appendLine('Mock rule store ready.');
    }

    if (!mockTree.currentResult) await mockTree.refresh();
    await requestMockStateSync('VM Service connected');
  }

  async function synchronizeMockStateAfterConnect(
    discovery: MockDiscoveryResult,
    options: { restoreSelections?: boolean; applyDefaultRules?: boolean } = {},
  ): Promise<void> {
    const shouldRestoreSelections = options.restoreSelections === true;
    const shouldApplyDefaultRules = options.applyDefaultRules === true;
    const selectedEntries = shouldRestoreSelections
      ? mockSelectionStore.resolveSelections(discovery)
        .filter((resolved) => resolved.entry)
        .map((resolved) => resolved.entry!)
      : [];
    const autoDefaultsSuppressed = isMockAutoDefaultsSuppressed();
    output.appendLine(
      `[MockStateSync] plan restoreSelections=${shouldRestoreSelections} `
      + `selectedEntries=${selectedEntries.length} `
      + `applyDefaultRules=${shouldApplyDefaultRules} `
      + `autoDefaultsSuppressed=${autoDefaultsSuppressed}`,
    );
    if (autoDefaultsSuppressed && shouldApplyDefaultRules) {
      output.appendLine(
        'Auto-apply default mocks is suppressed because all mock routes were stopped manually.',
      );
    }
    const suppressedEndpoints = suppressedMockEndpointsForDiscovery(discovery, autoDefaultsSuppressed);
    if (suppressedEndpoints.length > 0) {
      output.appendLine(
        `Mock state sync will keep ${suppressedEndpoints.length} stopped endpoint(s) inactive.`,
      );
    }
    output.appendLine(
      `[MockStateSync] suppressedEndpoints=${suppressedEndpoints.length}`,
    );
    const sync = await sandboxService.reconcileFromFlutter(session.connectedDriver, discovery, {
      selectedEntries,
      suppressedEndpoints,
      applyDefaultRules: shouldApplyDefaultRules && !autoDefaultsSuppressed,
      onStaleRoutes: async (stale) => {
        const rebuildsRoutes = selectedEntries.length > 0 || (shouldApplyDefaultRules && !autoDefaultsSuppressed);
        output.appendLine(
          `Flutter mock cache is out of sync with workspace mocks: `
          + `${stale.unmatched.length} stale route(s), ${stale.applied.length} reusable route(s). `
          + (rebuildsRoutes ? 'Rebuilding Flutter mock routes.' : 'Clearing stale Flutter mock routes.'),
        );
        await appendMockControllerDebug('Flutter stale mock routes before rebuild:');
      },
    });
    output.appendLine(
      `[MockStateSync] flutterRoutes=${sync.routes.length} `
      + `matched=${sync.applied.length} unmatched=${sync.unmatched.length} `
      + `rebuilt=${sync.rebuilt} reconciled=${sync.reconciled.length} skipped=${sync.skipped}`,
    );
    logMockRouteSample('flutter.matched', sync.applied);
    logFlutterRouteSample('flutter.unmatched', sync.unmatched);
    logMockRouteSample('workspace.reconciled', sync.reconciled);

    if (sync.applied.length > 0) {
      for (const applied of sync.applied) {
        await mockSelectionStore.saveAppliedRule(applied);
      }
      output.appendLine(
        `Synced ${sync.applied.length} mock route(s) from Flutter, `
        + `left ${sync.unmatched.length} unmatched Flutter route(s).`,
      );
    } else if (sync.routes.length === 0 && sync.reconciled.length === 0) {
      output.appendLine('No Flutter mock routes were cached at startup.');
    }

    if (sync.reconciled.length > 0) {
      for (const applied of sync.reconciled) {
        await mockSelectionStore.saveAppliedRule(applied);
      }
      output.appendLine(
        `Reconciled ${sync.reconciled.length} missing mock route(s) from workspace config, `
        + `skipped ${sync.skipped}.`,
      );
    }

    const appliedRules = sandboxService.getAppliedRules();
    output.appendLine(`[MockStateSync] treeAppliedRules=${appliedRules.length}`);
    logMockRouteSample('tree.applied', appliedRules);
    mockTree.setAppliedRules(appliedRules);
    await appendMockControllerDebug(
      sync.rebuilt ? 'Flutter mock routes after rebuild:' : 'Flutter mock routes after sync:',
    );
  }

  async function appendMockStartupDebug(): Promise<void> {
    try {
      await appendMockControllerDebug('Flutter cached mock routes on startup:');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`Flutter cached mock routes on startup: unavailable (${message})`);
    }
  }

  async function appendMockControllerDebug(title = 'Flutter mock routes:'): Promise<void> {
    const [routes, state] = await Promise.all([
      session.connectedDriver.mock.listFlutterRoutes(),
      readFlutterMockDebugState(session.connectedDriver),
    ]);
    if (routes.length === 0) {
      output.appendLine(`${title} (none)`);
    } else {
      output.appendLine(`${title} (${routes.length}):`);
      for (const route of routes) {
        output.appendLine(`  ${formatFlutterMockRoute(route)}`);
      }
    }
    for (const line of formatFlutterMockDebugState(state)) {
      output.appendLine(`  ${line}`);
    }
  }

  async function runTests(node?: TestFileEntry, workspace = false): Promise<void> {
    await runCommand(workspace ? 'Run Workspace Tests' : 'Run Current Test', async () => {
      const root = requireWorkspaceRoot();
      const file = workspace ? undefined : node?.uri ?? vscode.window.activeTextEditor?.document.uri;
      const failureContextDir = resolveWorkspacePath(root, loadConfig().failureContextDir);

      // Trace configuration
      const traceMode = getTraceMode();
      const traceDir = vscode.Uri.joinPath(root, '.fliwright', 'traces');

      session.setRunning(workspace ? 'workspace tests' : file?.fsPath ?? 'current test');
      const result = await runner.run({
        workspaceRoot: root,
        testFile: file,
        vmServiceUrl: session.currentUrl,
        failureContextDir,
        traceMode,
        traceDir: traceMode !== 'off' ? traceDir : undefined,
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

      // Cleanup old trace runs (keep last 10)
      if (traceMode !== 'off') {
        try {
          const deleted = await traceService.cleanupOldRuns(traceDir);
          if (deleted > 0) output.appendLine(`Cleaned up ${deleted} old trace run(s).`);
        } catch { /* non-critical */ }
      }

      if (result.failedTests > 0) {
        const actions = traceMode !== 'off' ? ['View Trace', 'Open Failure'] : ['Open Failure'];
        vscode.window.showErrorMessage(`Fliwright tests failed: ${result.failedTests}`, ...actions).then(async (selection) => {
          if (selection === 'View Trace') {
            await traceViewerPanel.openLatest();
          } else if (selection === 'Open Failure' && failures[0]) {
            const failure = failures[0];
            if (failure.source?.file) {
              const uri = vscode.Uri.file(failure.source.file);
              await vscode.commands.executeCommand('vscode.openWith', uri, 'fliwright.testEditor');
            } else {
              failurePanel.open(failure);
            }
          }
        });
      } else {
        const actions = traceMode !== 'off' ? ['View Trace'] : [];
        vscode.window.showInformationMessage(`Fliwright tests passed: ${result.passedTests}/${result.totalTests}`, ...actions).then(async (selection) => {
          if (selection === 'View Trace') {
            await traceViewerPanel.openLatest();
          }
        });
      }
    });
  }

  async function runScript(node?: ScriptFileEntry): Promise<void> {
    await runCommand('Run Script', async () => {
      const root = requireWorkspaceRoot();
      const script = node ?? await pickScript(root);
      if (!script) return;

      if (!isActiveSessionState(session.state.status)) {
        const connected = await discoverAndConnect({ reason: 'Run script', interactive: true });
        if (!connected) {
          throw new Error('Connect to a Flutter VM Service before running a script.');
        }
      }

      output.show(true);
      output.appendLine(`Running script: ${script.uri.fsPath}`);
      output.appendLine(`VM Service: ${session.currentUrl ?? '(none)'}`);

      session.setRunning(`script ${script.label}`);
      let result: RunResult;
      try {
        result = await scriptRunner.run({
          workspaceRoot: root,
          script,
          vmServiceUrl: session.currentUrl,
          onOutput: appendScriptOutput,
        });
      } finally {
        session.setConnectedIdle();
      }

      const run: RunEntry = {
        kind: 'run',
        id: `${Date.now()}`,
        label: `Script: ${script.label}`,
        filePath: script.uri.fsPath,
        result,
        ranAt: Date.now(),
      };
      runsTree.prependRun(run);
      statusBar.setRunResult(result);
      scriptsTree.refresh();

      output.appendLine(`Script complete: ${result.passed ? 'passed' : 'failed'} (${result.duration}ms).`);
      if (result.passed) {
        vscode.window.showInformationMessage(`Fliwright script passed: ${script.label}`);
      } else {
        vscode.window.showErrorMessage(`Fliwright script failed: ${script.label}`, 'Open Output').then((selection) => {
          if (selection === 'Open Output') output.show();
        });
      }
    });
  }

  async function pickScript(root: vscode.Uri): Promise<ScriptFileEntry | undefined> {
    const scripts = await scriptDiscoveryService.discover(root);
    if (scripts.length === 0) {
      vscode.window.showInformationMessage('No Fliwright scripts found under .fliwright/scripts.');
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(scripts.map((script) => ({
      label: script.label,
      description: script.description,
      detail: script.uri.fsPath,
      script,
    })), {
      title: 'Run Fliwright Script',
      placeHolder: 'Select a script from .fliwright/scripts',
    });
    return picked?.script;
  }

  function appendScriptOutput(text: string, stream: 'stdout' | 'stderr'): void {
    for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
      if (line.length === 0) continue;
      output.appendLine(`[script ${stream}] ${line}`);
    }
  }

  function getTraceMode(): TraceMode {
    const config = vscode.workspace.getConfiguration('fliwright');
    const value = config.get<string>('traceMode', 'on-failure');
    if (value === 'full' || value === 'off') return value;
    return 'on-failure';
  }

  function markActiveWatches(providers: StateProviderEntry[]): StateProviderEntry[] {
    return providers.map((provider) => ({
      ...provider,
      watching: provider.watching || stateProviderWatches.has(provider.key),
    }));
  }

  function clearStateProviderWatches(): void {
    if (stateProviderWatches.size === 0) return;
    for (const unsubscribe of stateProviderWatches.values()) {
      try {
        unsubscribe();
      } catch (error) {
        output.appendLine(`Failed to unwatch state provider: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    stateProviderWatches.clear();
    stateTree.setProviders(stateTree.getProviders().map((provider) => ({
      ...provider,
      watching: false,
    })));
  }

  function isMockAutoDefaultsSuppressed(): boolean {
    return context.workspaceState.get<boolean>(MOCK_AUTO_DEFAULTS_SUPPRESSED_KEY, false);
  }

  async function setMockAutoDefaultsSuppressed(suppressed: boolean): Promise<void> {
    await context.workspaceState.update(
      MOCK_AUTO_DEFAULTS_SUPPRESSED_KEY,
      suppressed ? true : undefined,
    );
  }

  function getSuppressedMockEndpoints(): Array<{ endpoint: string; method: string; updatedAt: number }> {
    const value = context.workspaceState.get<unknown>(MOCK_SUPPRESSED_ENDPOINTS_KEY);
    if (!value || typeof value !== 'object') return [];
    const candidate = value as { version?: unknown; endpoints?: unknown };
    if (candidate.version !== 1 || !Array.isArray(candidate.endpoints)) return [];
    return candidate.endpoints.filter((entry): entry is { endpoint: string; method: string; updatedAt: number } => (
      entry != null &&
      typeof entry === 'object' &&
      typeof (entry as { endpoint?: unknown }).endpoint === 'string' &&
      typeof (entry as { method?: unknown }).method === 'string' &&
      typeof (entry as { updatedAt?: unknown }).updatedAt === 'number'
    )).map((entry) => ({
      endpoint: entry.endpoint,
      method: entry.method.toUpperCase(),
      updatedAt: entry.updatedAt,
    }));
  }

  async function writeSuppressedMockEndpoints(
    endpoints: Array<{ endpoint: string; method: string; updatedAt: number }>,
  ): Promise<void> {
    const byKey = new Map<string, { endpoint: string; method: string; updatedAt: number }>();
    for (const endpoint of endpoints) {
      byKey.set(mockEndpointKey(endpoint.method, endpoint.endpoint), {
        endpoint: endpoint.endpoint,
        method: endpoint.method.toUpperCase(),
        updatedAt: endpoint.updatedAt,
      });
    }
    const normalized = Array.from(byKey.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    await context.workspaceState.update(
      MOCK_SUPPRESSED_ENDPOINTS_KEY,
      normalized.length > 0 ? { version: 1, endpoints: normalized } : undefined,
    );
  }

  async function suppressMockEndpoint(endpoint: { endpoint: string; method: string }): Promise<void> {
    await writeSuppressedMockEndpoints([
      ...getSuppressedMockEndpoints().filter((entry) => (
        mockEndpointKey(entry.method, entry.endpoint) !== mockEndpointKey(endpoint.method, endpoint.endpoint)
      )),
      {
        endpoint: endpoint.endpoint,
        method: endpoint.method,
        updatedAt: Date.now(),
      },
    ]);
  }

  async function unsuppressMockEndpoint(endpoint: { endpoint: string; method: string }): Promise<void> {
    await writeSuppressedMockEndpoints(getSuppressedMockEndpoints().filter((entry) => (
      mockEndpointKey(entry.method, entry.endpoint) !== mockEndpointKey(endpoint.method, endpoint.endpoint)
    )));
  }

  async function clearSuppressedMockEndpoints(): Promise<void> {
    await writeSuppressedMockEndpoints([]);
  }

  function suppressedMockEndpointsForDiscovery(
    discovery: MockDiscoveryResult,
    suppressAll: boolean,
  ): Array<{ endpoint: string; method: string }> {
    if (suppressAll) {
      return discovery.endpoints.map((endpoint) => ({
        endpoint: endpoint.endpointFile.endpoint,
        method: endpoint.endpointFile.method,
      }));
    }
    const discoveredKeys = new Set(
      discovery.endpoints.map((endpoint) => (
        mockEndpointKey(endpoint.endpointFile.method, endpoint.endpointFile.endpoint)
      )),
    );
    return getSuppressedMockEndpoints().filter((entry) => (
      discoveredKeys.has(mockEndpointKey(entry.method, entry.endpoint))
    ));
  }
}

function stateProvidersEmptyMessage(status?: { observerInstalled: boolean; containerReady: boolean; providerCount: number }): string {
  if (!status) return 'No state providers found';
  if (!status.observerInstalled) return 'Riverpod observer is not installed';
  if (status.providerCount === 0) return 'No Riverpod providers observed yet';
  if (!status.containerReady) return 'Riverpod container is not marked ready';
  return 'No state providers found';
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

function riverpodSetupInstructions(): string {
  return `# Fliwright Riverpod Setup

Use the Riverpod observer adapter in your debug or test entrypoint:

\`\`\`dart
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge_riverpod/fliwright_bridge_riverpod.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  FliwrightBridge.init();

  runApp(ProviderScope(
    observers: kDebugMode ? const [FliwrightRiverpodObserver()] : const [],
    child: const MyApp(),
  ));
}
\`\`\`

For writable providers, register an explicit debug write handler:

\`\`\`dart
registerFliwrightWritableProvider(
  'counterProvider',
  (value) {
    final next = value as int;
    ref.read(counterProvider.notifier).state = next;
    return next;
  },
);
\`\`\`

Observer-only providers support list, read, and watch. Override requires a writable provider registration.
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

  const snippet = JSON.stringify(formRuleSnippetForField(node.field), null, 2);
  const selection = active.selection;
  await active.edit((builder) => {
    builder.insert(selection.active, snippet);
  });
  vscode.window.showInformationMessage(`Inserted selector ${node.field.selector}`);
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

function formatStateValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

async function openStateProviderDocument(
  providerDocuments: StateProviderDocumentProvider,
  provider: StateProviderEntry,
  value: unknown,
  options: { preserveFocus?: boolean } = {},
): Promise<void> {
  const uri = providerDocuments.update({
    provider,
    value,
    readAt: new Date().toISOString(),
  });
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: options.preserveFocus ?? false,
    viewColumn: vscode.ViewColumn.Beside,
  });
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

function isActiveSessionState(status: string): boolean {
  return status === 'connected' || status === 'recording' || status === 'running';
}

function mockEndpointKey(method: string, endpoint: string): string {
  return `${method.toUpperCase()} ${endpoint}`;
}

function logMockRouteSample(label: string, routes: Array<{ method: string; endpoint: string; ruleName: string }>): void {
  if (routes.length === 0) {
    output.appendLine(`[MockStateSync] ${label}: (none)`);
    return;
  }
  output.appendLine(
    `[MockStateSync] ${label}: `
    + routes.slice(0, 10).map((route) => `${route.method.toUpperCase()} ${route.endpoint} -> ${route.ruleName}`).join(' | ')
    + (routes.length > 10 ? ` | ... +${routes.length - 10} more` : ''),
  );
}

function logFlutterRouteSample(label: string, routes: Array<{ id?: string; method?: string; path: string }>): void {
  if (routes.length === 0) {
    output.appendLine(`[MockStateSync] ${label}: (none)`);
    return;
  }
  output.appendLine(
    `[MockStateSync] ${label}: `
    + routes.slice(0, 10).map((route) => formatFlutterMockRoute(route)).join(' | ')
    + (routes.length > 10 ? ` | ... +${routes.length - 10} more` : ''),
  );
}

interface FlutterMockDebugState {
  mode?: string;
  serverPort?: number | null;
  interceptorInjected?: boolean;
  interceptors?: number;
  passthrough?: boolean;
  storeId?: number;
  routes?: Array<{ id?: string; method?: string; path?: string; status?: number }>;
  interceptorState?: {
    storeId?: number;
    sharedStore?: boolean;
    passthrough?: boolean;
    routes?: Array<{ id?: string; method?: string; path?: string; status?: number }>;
    calls?: number;
  };
  calls?: number;
}

async function waitForFlutterMockExtension(
  driver: { sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> },
  reason: string,
): Promise<void> {
  try {
    await driver.sendRequest('ext.fliwright.mock.debugState', {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Flutter mock extension is not ready for mock sync (${reason}): ${message}`);
  }
}

async function readFlutterMockDebugState(
  driver: { sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> },
): Promise<FlutterMockDebugState | undefined> {
  try {
    return unwrapExtensionPayload<FlutterMockDebugState>(
      await driver.sendRequest('ext.fliwright.mock.debugState', {}),
    );
  } catch {
    return undefined;
  }
}

function formatFlutterMockDebugState(state: FlutterMockDebugState | undefined): string[] {
  if (!state) return ['debugState: unavailable'];
  const lines = [
    `debugState: mode=${state.mode ?? 'unknown'} store=#${state.storeId ?? 'unknown'} `
    + `routes=${state.routes?.length ?? 0} passthrough=${state.passthrough ?? 'unknown'} calls=${state.calls ?? 0}`,
  ];
  if (state.mode === 'http') {
    lines.push(`http: serverPort=${state.serverPort ?? 'none'}`);
  }
  if (state.mode === 'dio') {
    lines.push(
      `dio: interceptorInjected=${state.interceptorInjected === true} `
      + `interceptors=${state.interceptors ?? (state.interceptorState ? 1 : 0)}`,
    );
    const interceptor = state.interceptorState;
    if (interceptor) {
      lines.push(
        `dio.interceptor: store=#${interceptor.storeId ?? 'unknown'} `
        + `sharedStore=${interceptor.sharedStore === true} routes=${interceptor.routes?.length ?? 0} `
        + `passthrough=${interceptor.passthrough ?? 'unknown'} calls=${interceptor.calls ?? 0}`,
      );
      for (const route of interceptor.routes ?? []) {
        lines.push(`  ${formatFlutterMockRoute(route)}`);
      }
    }
  }
  return lines;
}

function formatFlutterMockRoute(route: { id?: string; method?: string; path?: string }): string {
  const method = (route.method ?? '*').toUpperCase();
  const label = `${method} ${route.path ?? '(unknown)'}`;
  const parsed = parseFlutterMockRouteId(route.id);
  if (parsed) {
    return `${label} -> ${parsed.ruleName} id=${route.id}`;
  }
  return route.id ? `${label} id=${route.id}` : label;
}

function parseFlutterMockRouteId(id: string | undefined): { method: string; endpoint: string; ruleName: string } | undefined {
  if (!id?.startsWith('fliwright-vscode:')) return undefined;
  const parts = id.split(':');
  if (parts.length !== 4) return undefined;
  try {
    return {
      method: decodeURIComponent(parts[1] ?? '').toUpperCase(),
      endpoint: decodeURIComponent(parts[2] ?? ''),
      ruleName: decodeURIComponent(parts[3] ?? ''),
    };
  } catch {
    return undefined;
  }
}

function unwrapExtensionPayload<T>(value: unknown): T {
  if (value && typeof value === 'object' && 'result' in value) {
    const result = (value as { result?: unknown }).result;
    if (typeof result === 'string') {
      try {
        return unwrapExtensionPayload<T>(JSON.parse(result));
      } catch {
        return value as T;
      }
    }
    if (result && typeof result === 'object') {
      return unwrapExtensionPayload<T>(result);
    }
  }
  if (value && typeof value === 'object' && 'response' in value) {
    const response = (value as { response?: unknown }).response;
    if (typeof response === 'string') {
      try {
        return unwrapExtensionPayload<T>(JSON.parse(response));
      } catch {
        return value as T;
      }
    }
    if (response && typeof response === 'object') {
      return response as T;
    }
  }
  return value as T;
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
