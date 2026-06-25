import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { FormAnalyzeResult, FormFillResult } from '@fliwright/core';
import {
  clearWorkspaceVmServiceUrl,
  mockRuleController,
  readWorkspaceConfigSync,
  setConnectorDebugLog,
  writeWorkspaceVmServiceUrl,
} from '@fliwright/core';
import { getWorkspaceRoot, loadConfig, resolveWorkspacePath } from './config.js';
import { FailureContextStore } from './failure/FailureContextStore.js';
import { formRuleSnippetForField, formRulesFileName, FormHelperService, formatFormFillDebug, dataSetLabels } from './form/FormHelperService.js';
import { FormRuleService } from './form/FormRuleService.js';
import { RecorderService } from './recording/RecorderService.js';
import { FliwrightCodeLensProvider } from './runner/FliwrightCodeLensProvider.js';
import { TestDiscoveryService } from './runner/TestDiscoveryService.js';
import { VitestRunner } from './runner/VitestRunner.js';
import { ScriptDiscoveryService } from './scripts/ScriptDiscoveryService.js';
import { ScreenshotPreviewPanel, ScreenshotService } from './screenshot/ScreenshotService.js';
import { FliwrightSession } from './session/FliwrightSession.js';
import { discoverVmServiceCandidates, extractVmServiceUrls } from './session/VmServiceDiscovery.js';
import { MockConfigService } from './sandbox/MockConfigService.js';
import { clearFlutterMockRoutes, formatMockRuleDebug, SandboxService } from './sandbox/SandboxService.js';
import { STATE_PROVIDER_DOCUMENT_SCHEME, StateProviderDocumentProvider } from './state/StateProviderDocumentProvider.js';
import { StateInjectionService } from './state/StateInjectionService.js';
import { StatusBarService } from './status/StatusBarService.js';
import type { FailureTreeEntry, FormAnalyzeFieldEntry, FormRule, FormRulesEntry, InvalidFileEntry, MockEndpointEntry, MockRuleEntry, RunResult, ScriptFileEntry, StateProviderEntry } from './types.js';
import { DevicesTreeProvider } from './views/DevicesTreeProvider.js';
import { FormDataTreeProvider } from './views/FormDataTreeProvider.js';
import { MockApiTreeProvider, mockFileNameFromInput } from './views/MockApiTreeProvider.js';
import { ScriptsTreeProvider } from './views/ScriptsTreeProvider.js';
import { StateTreeProvider } from './views/StateTreeProvider.js';
import { TestsTreeProvider } from './views/TestsTreeProvider.js';
import { TestStatusStore } from './testing/TestStatusStore.js';
import { relPathOf } from './testing/relPath.js';
import { RunArtifactStore } from './testing/RunArtifactStore.js';
import { FailurePanel } from './webview/FailurePanel.js';
import { EditorBridge } from './editor/EditorBridge.js';
import { TestEditorProvider } from './editor/TestEditorProvider.js';
import { setEditorOutput } from './editor/TestEditorPanel.js';
import { RecordingPanel } from './webview/RecordingPanel.js';
import { TraceViewerPanel } from './trace/TraceViewerPanel.js';
import { TraceService } from './trace/TraceService.js';
import { RunViewerPanel } from './runviewer/RunViewerPanel.js';
import { RunViewerService } from './runviewer/RunViewerService.js';
import { FileTddLoopStatusSource, TddLoopController } from './tddloop/index.js';
import { TraceStore } from '@fliwright/core';
import type { TraceMode } from '@fliwright/core';

let output: vscode.OutputChannel;
const LAST_VM_SERVICE_URL_KEY = 'fliwright.vmServiceUrl.lastSuccess';
const DEBUG_LOG_BUFFER_LIMIT = 20000;
const CONNECTION_HEALTH_CHECK_INTERVAL_MS = 5000;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel('Fliwright');
  context.subscriptions.push(output);
  setEditorOutput(output);

  // Route VM Service debug logs to the output channel
  setConnectorDebugLog((message) => output.appendLine(message));

  const mockService = new MockConfigService();
  const formService = new FormRuleService();
  const session = new FliwrightSession();
  const sandboxService = new SandboxService();
  const formHelperService = new FormHelperService();
  formHelperService.setDebugLogger((message) => output.appendLine(message));
  const testDiscoveryService = new TestDiscoveryService();
  const scriptDiscoveryService = new ScriptDiscoveryService();
  const runner = new VitestRunner();
  const screenshotService = new ScreenshotService();
  const screenshotPreviewPanel = new ScreenshotPreviewPanel();
  const failureStore = new FailureContextStore();
  const recorderService = new RecorderService();
  const stateService = new StateInjectionService();
  const stateProviderDocuments = new StateProviderDocumentProvider();
  const devicesTree = new DevicesTreeProvider();
  const mockTree = new MockApiTreeProvider(mockService);
  const formTree = new FormDataTreeProvider(formService);
  const runArtifactStore = new RunArtifactStore();
  // Resolve the migrated per-project runs root (~/​.fliwright/​projects/​<hash>/​runs).
  // Best-effort: if the workspace root is unavailable or mkdir fails, fall back to
  // undefined so run recording is skipped (the tests tree still works against an
  // empty in-memory store). The store is always constructed so TestsTreeProvider
  // gets its second arg (loadIndex tolerates a missing index.json).
  let runsRoot: string | undefined;
  let traceRoot: string | undefined;
  const wsRootForRuns = getWorkspaceRoot();
  if (wsRootForRuns) {
    try {
      runsRoot = await runArtifactStore.ensureRunsDir(wsRootForRuns);
      traceRoot = runArtifactStore.traceDir(wsRootForRuns);
    } catch (err) {
      output.appendLine(`[Fliwright] Failed to ensure runs root: ${err instanceof Error ? err.message : String(err)}`);
      runsRoot = undefined;
      traceRoot = undefined;
    }
  }
  const statusStore = new TestStatusStore(runsRoot ?? '');
  const testsTree = new TestsTreeProvider(testDiscoveryService, statusStore);
  const scriptsTree = new ScriptsTreeProvider(scriptDiscoveryService);
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
  const runViewerPanel = new RunViewerPanel(context.extensionUri);
  const runViewerService = new RunViewerService();
  void updateRecordingContext(recorderService.getSession());

  context.subscriptions.push(session);
  context.subscriptions.push(screenshotPreviewPanel);
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

    void persistWorkspaceVmServiceUrl(latestUrl, 'Flutter debug output');
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
        mockTree.setAppliedRules([]);
        await session.markConnectionLost(message);
        scheduleAutoConnect('VM Service connection lost', 100, { forceReconnect: true });
      }).finally(() => {
        healthCheckInFlight = false;
      });
    }, CONNECTION_HEALTH_CHECK_INTERVAL_MS);
  };

  const requestMockStateSync = async (reason: string): Promise<void> => {
    if (mockSyncInFlight) {
      mockSyncQueued = true;
      output.appendLine(`Mock state refresh queued (${reason}); another refresh is running.`);
      await mockSyncInFlight;
      return;
    }

    mockSyncInFlight = (async () => {
      do {
        mockSyncQueued = false;
        if (!isActiveSessionState(session.state.status)) {
          output.appendLine(
            `Mock state refresh skipped (${reason}): VM Service is not connected `
            + `(status=${session.state.status}).`,
          );
          mockTree.setAppliedRules([]);
          return;
        }

        if (!mockTree.currentResult) {
          output.appendLine(`Mock state refresh (${reason}): loading workspace mock configs.`);
          await mockTree.refresh();
        }
        const discovery = mockTree.currentResult;
        if (!discovery) {
          output.appendLine(`Mock state refresh skipped (${reason}): no workspace mock discovery result.`);
          return;
        }

        try {
          await waitForFlutterMockExtension(session.connectedDriver, reason);
        } catch (error) {
          output.appendLine(
            `Mock state refresh skipped (${reason}): `
            + `${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }

        // Purely reactive: read the unified store and reflect it. Never apply,
        // prune, or clear on connect — the store owns the truth.
        const activeRules = await sandboxService.getActiveRules(session.connectedDriver);
        output.appendLine(
          `[MockStateSync] reactive read (${reason}): ${activeRules.length} active route(s) in store.`,
        );
        mockTree.setAppliedRules(activeRules);
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
        void clearPersistedWorkspaceVmServiceUrl('Flutter debug session started');
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
    vscode.window.registerTreeDataProvider('fliwright.state', stateTree),
    vscode.languages.registerCodeLensProvider(
      [{ language: 'typescript', scheme: 'file' }, { language: 'typescriptreact', scheme: 'file' }],
      new FliwrightCodeLensProvider(),
    ),
  );

  // ── Lazy-parse cache invalidation on save ───────────
  // Debounce (300ms) per-file: drop ONE file's parse cache so an edited .test.ts
  // is re-parsed on next expand while every other file stays cached. timers run
  // on the extension host.
  const saveDebounce = new Map<string, ReturnType<typeof setTimeout>>();
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!doc.fileName.endsWith('.test.ts')) return;
      const key = doc.uri.toString();
      const existing = saveDebounce.get(key);
      if (existing) clearTimeout(existing);
      saveDebounce.set(
        key,
        setTimeout(() => {
          saveDebounce.delete(key);
          testsTree.invalidateFile(doc.uri);
        }, 300),
      );
    }),
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

  // ── TDD Loop monitor (additive, read-only; design spec §4.3 / §5.4 / §10 P1) ──────────────
  // The monitor is invisible until the user opens it. It reads a snapshot an external party (the
  // MCP-owned TddRuntime) writes to `<workspaceRoot>/.fliwright/tdd-status.json`; it NEVER creates
  // a driver, connects to a VM service, or spawns a daemon — so it cannot fight the MCP-driven loop
  // (design principle 4, single-driver by convention). See src/tddloop/TddLoopStatusSource.ts.
  const tddLoopSource = new FileTddLoopStatusSource(getWorkspaceRoot()?.fsPath);
  const tddLoopController = new TddLoopController(tddLoopSource, context.extensionUri);
  context.subscriptions.push(tddLoopController);
  for (const disposable of tddLoopController.registerCommands()) {
    context.subscriptions.push(disposable);
  }
  // Auto-refresh is cheap (a file read) and keeps the panel live once opened.
  tddLoopController.startAutoRefresh();
  context.subscriptions.push(
    vscode.commands.registerCommand('fliwright.reloadMocks', async () => {
      await runCommand('Reload Mock Configs', async () => {
        await mockTree.refresh();
        await requestMockStateSync('mock configs reloaded');
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
        mockTree.setAppliedRules([]);
        await session.disconnect();
        await clearPersistedWorkspaceVmServiceUrl('VS Code disconnected');
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
    vscode.commands.registerCommand('fliwright.takeScreenshot', async () => {
      await runCommand('Take App Screenshot', async () => {
        const preview = await screenshotService.capture(session.connectedDriver);
        screenshotPreviewPanel.show(preview);
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
        output.appendLine(`Applying mock ${formatMockRuleDebug(node)}`);
        const applied = await sandboxService.applyRule(session.connectedDriver, node);
        mockTree.setAppliedRules(await sandboxService.getActiveRules(session.connectedDriver));
        output.appendLine(`Applied mock ${applied.method} ${applied.endpoint} -> ${applied.ruleName}`);
        await appendMockControllerDebug('Flutter mock routes after apply:');
        vscode.window.showInformationMessage(`Applied ${applied.method} ${applied.endpoint} -> ${applied.ruleName}`);
      });
    }),
    vscode.commands.registerCommand('fliwright.stopMockRule', async (node?: MockRuleEntry) => {
      await runCommand('Stop Mock Rule', async () => {
        if (!node || node.kind !== 'rule') throw new Error('Select an active mock rule to stop.');
        const stopped = await sandboxService.stopRule(session.connectedDriver, node);
        mockTree.setAppliedRules(await sandboxService.getActiveRules(session.connectedDriver));
        if (!stopped) {
          output.appendLine(`Skipped stopping inactive mock ${formatMockRuleDebug(node)}`);
          await appendMockControllerDebug('Flutter mock routes remain:');
          vscode.window.showWarningMessage(`Mock rule is not active: ${node.method} ${node.endpoint} -> ${node.rule.name}`);
          return;
        }
        output.appendLine(`Stopped mock ${node.method} ${node.endpoint} -> ${node.rule.name}`);
        await appendMockControllerDebug('Flutter mock routes after stop:');
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
        mockTree.setAppliedRules(await sandboxService.getActiveRules(session.connectedDriver));
        output.appendLine(`Applied ${result.applied.length} default mock route(s), skipped ${result.skipped}.`);
        await appendMockControllerDebug('Flutter mock routes after apply-default:');
        vscode.window.showInformationMessage(`Applied ${result.applied.length} default mock route(s).`);
      });
    }),
    vscode.commands.registerCommand('fliwright.stopSandbox', async () => {
      await runCommand('Stop All Mock Routes', async () => {
        const driver = session.connectedDriver;
        const count = await sandboxService.clear(driver);
        mockTree.setAppliedRules(await sandboxService.getActiveRules(driver));

        // Hard-clear fallback: verify the Flutter store is actually empty —
        // including the Dio interceptor's store (covers store-identity split) —
        // retry once if not, and never report success silently. This is the
        // user-facing guarantee that "Stop All" leaves nothing mocking even if
        // auto-clear/reconcile has a hole.
        const remainingRoutes = (state?: FlutterMockDebugState) =>
          (state?.routes?.length ?? 0) + (state?.interceptorState?.routes?.length ?? 0);

        let state = await readFlutterMockDebugState(driver);
        if (remainingRoutes(state) > 0) {
          output.appendLine(
            `[MockStateSync] Flutter store still had ${remainingRoutes(state)} route(s) after clear; retrying clearRoutes().`,
          );
          try {
            await clearFlutterMockRoutes(driver);
          } catch (error) {
            output.appendLine(
              `[MockStateSync] Retry clearRoutes() failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          state = await readFlutterMockDebugState(driver);
        }
        const remaining = remainingRoutes(state);
        output.appendLine(
          `[MockStateSync] stop-all result: tracked=${count} remaining=${remaining} `
          + `storeId=#${state?.storeId ?? 'unknown'} sharedStore=${state?.interceptorState?.sharedStore === true}`,
        );
        await appendMockControllerDebug('Flutter mock routes after clear:');
        if (remaining > 0) {
          output.appendLine(
            `[MockStateSync] WARNING: Flutter 端仍有 ${remaining} 条路由未清除。${formatFlutterMockDebugState(state).join(' | ')}`,
          );
          vscode.window.showWarningMessage(
            `Flutter 端仍有 ${remaining} 条 mock 路由未清除（store=#${state?.storeId ?? 'unknown'}）。请检查 Dio 拦截器与扩展是否共享同一 store。`,
          );
          return;
        }
        output.appendLine(`Stopped all mock routes (${count} tracked route(s)); Flutter store cleared.`);
        vscode.window.showInformationMessage('已清空 Flutter 端全部 mock 配置（store routes=0）。');
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
    vscode.commands.registerCommand('fliwright.addAnalyzedFieldToFormRules', async (node?: FormAnalyzeFieldEntry) => {
      await runCommand('Add Analyzed Field to Form Rules', async () => {
        if (!node || node.kind !== 'formAnalyzeField') throw new Error('Select a form field from Last Analyze.');
        const uri = await pickOrCreateFormRulesFile(formService, [node.field]);
        if (!uri) return;
        const added = await formService.appendAnalyzeFields(uri, [node.field]);
        await formTree.refresh();
        await vscode.window.showTextDocument(uri, { preview: false });
        vscode.window.showInformationMessage(added > 0 ? `Added 1 form rule to ${path.basename(uri.fsPath)}.` : 'That field already has a matching rule.');
      });
    }),
    vscode.commands.registerCommand('fliwright.createFormRulesFromLastAnalyze', async () => {
      await runCommand('Create Form Rules From Last Analyze', async () => {
        const root = requireWorkspaceRoot();
        const result = formHelperService.getLastAnalyze();
        if (!result || result.fields.length === 0) throw new Error('Run Analyze Current Form before creating rules.');
        const picked = await pickAnalyzeFields(formHelperService, result, 'Create Form Rules From Last Analyze');
        if (!picked) return;
        const input = await vscode.window.showInputBox({
          title: 'Create Form Rules From Last Analyze',
          prompt: 'File name under .fliwright/forms',
          value: 'form-analyzed-rules.json',
        });
        if (input === undefined) return;
        const uri = await formService.createFromAnalyzeFields(root, input, picked);
        await formTree.refresh();
        await vscode.window.showTextDocument(uri, { preview: false });
        vscode.window.showInformationMessage(`Created ${path.basename(uri.fsPath)} with ${picked.length} form rule(s).`);
      });
    }),
    vscode.commands.registerCommand('fliwright.appendLastAnalyzeToFormRules', async (node?: FormRulesEntry) => {
      await runCommand('Append Last Analyze to Form Rules', async () => {
        const result = formHelperService.getLastAnalyze();
        if (!result || result.fields.length === 0) throw new Error('Run Analyze Current Form before appending rules.');
        const picked = await pickAnalyzeFields(formHelperService, result, 'Append Last Analyze to Form Rules');
        if (!picked) return;
        const uri = formRulesNode(node)?.uri ?? await pickFormRulesFileUri(formService);
        if (!uri) return;
        const added = await formService.appendAnalyzeFields(uri, picked);
        await formTree.refresh();
        await vscode.window.showTextDocument(uri, { preview: false });
        vscode.window.showInformationMessage(`Added ${added} form rule(s) to ${path.basename(uri.fsPath)}.`);
      });
    }),
    vscode.commands.registerCommand('fliwright.fillForm', async () => {
      await fillFormWithRules(undefined);
    }),
    vscode.commands.registerCommand('fliwright.fillFormWithRules', async (node?: FormRulesEntry) => {
      await fillFormWithRules(formRulesNode(node));
    }),
    vscode.commands.registerCommand('fliwright.runCurrentTest', async (node?: unknown) => {
      // Accept the new Tests panel nodes (TestFileNode / TestCaseNode, typed as
      // `unknown` because the legacy tree entries still feed this command).
      // For a testCase, derive a vitest -t pattern from the node id's ancestor
      // chain (`<relPath>::<anc1>/<anc2>/.../<title>`) so only that case runs.
      const n = node as { kind?: string; id?: string; uri?: vscode.Uri; fileUri?: vscode.Uri } | undefined;
      if (n?.kind === 'testCase' && n.id) {
        const pattern = n.id.split('::')[1]?.split('/').join(' > ');
        await runTests(n, { testNamePattern: pattern });
      } else {
        await runTests(n, {});
      }
    }),
    vscode.commands.registerCommand('fliwright.runWorkspaceTests', async () => {
      await runTests(undefined, { workspace: true });
    }),
    vscode.commands.registerCommand('fliwright.runScript', async (node?: ScriptFileEntry) => {
      await runScript(node);
    }),
    vscode.commands.registerCommand('fliwright.openFailure', async (node?: FailureTreeEntry) => {
      // Failure surfacing now resolves from the latest run via the failure
      // store on disk (the in-memory runsTree.failuresList is gone). Without a
      // tree node, surface the latest failure context file directly.
      let failure = node?.kind === 'failure' ? node.failure : undefined;
      if (!failure) {
        const root = getWorkspaceRoot();
        if (root) {
          try {
            const dir = resolveWorkspacePath(root, loadConfig().failureContextDir);
            const latest = await failureStore.loadLatest(dir);
            failure = latest[0];
          } catch { /* ignore — nothing to surface */ }
        }
      }
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
    vscode.commands.registerCommand('fliwright.openRunViewer', async () => {
      await runViewerPanel.openWithPicker();
    }),
    vscode.commands.registerCommand('fliwright.showLastRun', async () => {
      await runViewerPanel.openLatest();
    }),
    vscode.commands.registerCommand('fliwright.viewTestRun', async (node?: any) => {
      const root = requireWorkspaceRoot();
      const runsDir = await runViewerService.getRunsDir(root);
      if (!runsDir || !node?.id) { vscode.window.showInformationMessage('No run recorded for this test yet.'); return; }
      // Index-first: index.json (maintained by TestStatusStore.recordRun) knows
      // the exact latest runId for each node id; the scan is only a fallback
      // when the indexed run dir has been pruned (or there's no index entry).
      const index = await statusStore.loadIndex();
      const loaded = await runViewerService.findLatestRunForTestIndexed(runsDir, node.id, index);
      if (!loaded) { vscode.window.showInformationMessage('No run recorded for this test yet.'); return; }
      await runViewerPanel.openRun(loaded.runDir);
    }),
    vscode.commands.registerCommand('fliwright.viewScriptRun', async (node?: any) => {
      const root = requireWorkspaceRoot();
      const runsDir = await runViewerService.getRunsDir(root);
      if (!runsDir || !node?.uri) { vscode.window.showInformationMessage('No run recorded for this script yet.'); return; }
      const loaded = await runViewerService.findLatestRunForScript(runsDir, relPathOf(root, node.uri));
      if (!loaded) { vscode.window.showInformationMessage('No run recorded for this script yet.'); return; }
      await runViewerPanel.openRun(loaded.runDir);
    }),
    vscode.commands.registerCommand('fliwright.refreshTests', () => {
      // Drop roots, the status map, and ALL per-file parse caches, then re-fire
      // the tree. The next getChildren() re-discovers test files and re-reads
      // index.json for statuses; source parsing stays lazy (on expand).
      testsTree.refresh();
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
      mockTree.setAppliedRules([]);
      await session.disconnect(false);
    }

    session.setScanning(options.reason, options.forceReconnect);
    const workspaceRoot = getWorkspaceRoot();
    const candidates = await discoverVmServiceCandidates({
      cachedUrl: context.workspaceState.get<string>(LAST_VM_SERVICE_URL_KEY),
      workspaceConfigUrl: workspaceRoot ? readWorkspaceConfigSync(workspaceRoot.fsPath).vmServiceUrl : undefined,
      logText: debugLogBuffer,
    });

    if (candidates.length === 0) {
      await session.disconnect();
      mockTree.setAppliedRules([]);
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
        mockTree.setAppliedRules([]);
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
    mockTree.setAppliedRules([]);
    return false;
  }

  async function onConnected(url: string, notify: boolean): Promise<void> {
    await context.workspaceState.update(LAST_VM_SERVICE_URL_KEY, url);
    await persistWorkspaceVmServiceUrl(url, 'VS Code connected');
    startHealthCheck();
    await appendMockStartupDebug();
    await configureMocksAfterConnect();
    output.appendLine(`Connected to VM Service: ${url}`);
    if (notify) {
      vscode.window.showInformationMessage(`Connected to ${url}`);
    }
  }

  async function persistWorkspaceVmServiceUrl(url: string, source: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) return;
    try {
      await writeWorkspaceVmServiceUrl(url, { cwd: root.fsPath, source });
      output.appendLine(`Wrote VM Service URL to .fliwright/config.json (${source}): ${url}`);
    } catch (error) {
      output.appendLine(`Failed to write .fliwright/config.json: ${messageOf(error)}`);
    }
  }

  async function clearPersistedWorkspaceVmServiceUrl(source: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) return;
    try {
      await clearWorkspaceVmServiceUrl({ cwd: root.fsPath, source });
      output.appendLine(`Cleared VM Service URL in .fliwright/config.json (${source}).`);
    } catch (error) {
      output.appendLine(`Failed to clear .fliwright/config.json VM Service URL: ${messageOf(error)}`);
    }
  }

  async function configureMocksAfterConnect(): Promise<void> {
    if (!mockTree.currentResult) await mockTree.refresh();
    await requestMockStateSync('VM Service connected');
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

  // Single concurrent run guard. Held for the lifetime of one runTests call
  // (success or failure) so a second invocation is rejected up-front instead of
  // racing the runner. Lives in activate() scope: shared across all runTests
  // invocations during the extension's activation lifetime.
  let runningPromise: Promise<void> | undefined;

  /**
   * Run tests for a node (file/case), the active editor, or the whole workspace.
   *
   * `opts.workspace` runs the whole workspace; `opts.testNamePattern` is a vitest
   * `-t` pattern (used when a single testCase node is invoked). On completion the
   * result is recorded via `TestStatusStore.recordRun` (so the Tests panel picks
   * up statuses) and the tests tree is refreshed.
   */
  async function runTests(
    node: { uri?: vscode.Uri; fileUri?: vscode.Uri } | undefined,
    opts: { workspace?: boolean; testNamePattern?: string } = {},
  ): Promise<void> {
    if (runningPromise) {
      void vscode.window.showWarningMessage('A Fliwright run is already in progress.');
      return;
    }
    runningPromise = (async () => {
      await runCommand(opts.workspace ? 'Run Workspace Tests' : 'Run Test', async () => {
        const root = requireWorkspaceRoot();
        const file = opts.workspace
          ? undefined
          : node?.uri ?? node?.fileUri ?? vscode.window.activeTextEditor?.document.uri;
        const failureContextDir = resolveWorkspacePath(root, loadConfig().failureContextDir);

        // Trace configuration. Prefer the per-project runs root when available
        // (migrated layout) so artifacts land alongside the run result.json.
        const traceMode = getTraceMode();
        const traceDir = traceRoot ? vscode.Uri.file(traceRoot) : vscode.Uri.joinPath(root, '.fliwright', 'traces');
        const runId = runArtifactStore.generateBaseRunId();

        session.setRunning(opts.workspace ? 'workspace tests' : file?.fsPath ?? 'tests');
        const result = await runner.run({
          workspaceRoot: root,
          testFile: file,
          testNamePattern: opts.testNamePattern,
          runsRoot,
          runId,
          vmServiceUrl: session.currentUrl,
          failureContextDir,
          traceMode,
          traceDir: traceMode !== 'off' ? traceDir : undefined,
        });
        const failures = await failureStore.loadLatest(failureContextDir, result);

        // Record the run into the per-project status store so the Tests panel
        // can join statuses onto tree nodes by id. Only when we have a store
        // with a real runsDir AND a target file (relPath is undefined for
        // workspace runs — recordRun keys by node id which needs relPath).
        if (runsRoot && file) {
          try {
            await runArtifactStore.recordTestRun(root, result, relPathOf(root, file), {
              baseRunId: runId,
              ranAt: Date.now(),
            });
          } catch (err) {
            output.appendLine(`[Fliwright] Failed to record run status: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        statusBar.setRunResult(result);
        session.setConnectedIdle();
        testsTree.refresh();
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
    })().finally(() => {
      runningPromise = undefined;
    });
    await runningPromise;
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

      const command = await terminalScriptCommand(root, script);
      const runId = runArtifactStore.generateBaseRunId();
      const traceMode = getTraceMode();
      const scriptTraceDir = traceRoot ? traceRoot : vscode.Uri.joinPath(root, '.fliwright', 'traces').fsPath;
      const terminal = vscode.window.createTerminal({
        name: `Fliwright: ${script.label}`,
        cwd: root.fsPath,
        env: {
          ...(session.currentUrl ? {
            FLIWRIGHT_VM_SERVICE_URL: session.currentUrl,
            FLIWRIGHT_VM_URL: session.currentUrl,
          } : {}),
          ...(runsRoot ? {
            FLIWRIGHT_RUNS_ROOT: runsRoot,
            FLIWRIGHT_RUN_ID: runId,
          } : {}),
          ...(traceMode !== 'off' ? {
            FLIWRIGHT_TRACE: traceMode,
            FLIWRIGHT_TRACE_DIR: scriptTraceDir,
          } : {}),
        },
      });
      context.subscriptions.push(terminal);
      terminal.show(true);
      terminal.sendText(command, true);

      output.appendLine(`Started script in terminal: ${script.uri.fsPath}`);
      output.appendLine(`VM Service: ${session.currentUrl ?? '(none)'}`);
      scriptsTree.refresh();
      vscode.window.showInformationMessage(`Fliwright script started in terminal: ${script.label}`);
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

async function pickOrCreateFormRulesFile(
  service: FormRuleService,
  fields: FormAnalyzeResult['fields'],
): Promise<vscode.Uri | undefined> {
  const root = requireWorkspaceRoot();
  const discovery = await service.discover(root);
  const createItem = {
    label: 'Create new rules file',
    description: '.fliwright/forms/*.json',
    action: 'create' as const,
  };
  const picked = await vscode.window.showQuickPick([
    ...discovery.files.map((entry) => ({
      label: path.basename(entry.uri.fsPath),
      description: `${entry.rulesFile.rules.length} rules`,
      action: 'append' as const,
      uri: entry.uri,
    })),
    createItem,
  ], {
    title: 'Add Analyzed Field to Form Rules',
    placeHolder: 'Choose a rules file or create a new one',
  });
  if (!picked) return undefined;
  if (picked.action === 'append') return picked.uri;

  const input = await vscode.window.showInputBox({
    title: 'Create Form Rules',
    prompt: 'File name under .fliwright/forms',
    value: fields.length === 1 ? `${safeFormRuleFileName(fields[0])}.json` : 'form-analyzed-rules.json',
  });
  if (input === undefined) return undefined;
  return service.createFromAnalyzeFields(root, input, []);
}

async function pickFormRulesFileUri(service: FormRuleService): Promise<vscode.Uri | undefined> {
  const root = requireWorkspaceRoot();
  const discovery = await service.discover(root);
  if (discovery.files.length === 0) return undefined;
  if (discovery.files.length === 1) return discovery.files[0]!.uri;

  const picked = await vscode.window.showQuickPick(
    discovery.files.map((entry) => ({
      label: path.basename(entry.uri.fsPath),
      description: `${entry.rulesFile.rules.length} rules`,
      uri: entry.uri,
    })),
    {
      title: 'Select Form Rules File',
      placeHolder: 'Choose a .fliwright/forms/*.json file to append rules',
    },
  );
  return picked?.uri;
}

async function pickAnalyzeFields(
  service: FormHelperService,
  result: FormAnalyzeResult,
  title: string,
): Promise<FormAnalyzeResult['fields'] | undefined> {
  const preview = service.previewFields(result);
  const items = preview.map((field, index) => ({
    label: field.label,
    description: field.semanticType,
    detail: field.generatedValue,
    index,
    picked: true,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: 'Select analyzed fields to write as rules',
    canPickMany: true,
  });
  if (!picked) return undefined;
  if (picked.length === 0) return undefined;
  return picked.map((item) => result.fields[item.index]!).filter(Boolean);
}

function safeFormRuleFileName(field: FormAnalyzeResult['fields'][number]): string {
  const label = field.name ?? field.semanticsId ?? field.key ?? field.label ?? field.hintText ?? 'form-field';
  return `form-${label.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'field'}-rules`;
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  // The bridge re-registers the mock VM-service extensions asynchronously
  // during (hot-)restart. A single probe races that re-registration and, on
  // failure, aborts the whole reconcile — leaving Hive-resurrected routes
  // active while VSCode shows no applied rules. Poll until the extension
  // responds (or the deadline elapses) before proceeding.
  const maxAttempts = 25; // ~5s at 200ms intervals
  const intervalMs = 200;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await driver.sendRequest('ext.fliwright.mock.debugState', {});
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Flutter mock extension is not ready for mock sync after ~5s (${reason}): ${message}`);
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
  return mockRuleController.parseRouteId(id);
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

async function terminalScriptCommand(root: vscode.Uri, script: ScriptFileEntry): Promise<string> {
  const relativeScript = path.relative(root.fsPath, script.uri.fsPath);
  const source = await fs.promises.readFile(script.uri.fsPath, 'utf8');
  if (usesFliwrightVitest(source)) {
    return [
      'pnpm',
      'exec',
      'vitest',
      'run',
      shellQuote(relativeScript),
      '--pool',
      'forks',
      '--poolOptions.forks.singleFork',
      '--no-fileParallelism',
    ].join(' ');
  }
  return ['node', shellQuote(relativeScript)].join(' ');
}

function usesFliwrightVitest(source: string): boolean {
  return /from\s+['"]@fliwright\/vitest['"]/.test(source) ||
    /import\s*\(\s*['"]@fliwright\/vitest['"]\s*\)/.test(source);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
