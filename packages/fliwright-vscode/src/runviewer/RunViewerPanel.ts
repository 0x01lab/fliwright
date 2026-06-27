// packages/fliwright-vscode/src/runviewer/RunViewerPanel.ts
import * as vscode from 'vscode';
import type { TimelineData, FliwrightLogEvent, TraceData } from '@fliwright/core';
import { RunViewerService } from './RunViewerService.js';
import { getRunViewerHtml } from './getRunViewerHtml.js';

type RunViewerMessage = { type: 'openSource'; file: string; line: number; column?: number };

/**
 * Manages a single, reusable Run Viewer WebviewPanel. Mirrors TraceViewerPanel:
 * openWithPicker() / openLatest() / openForRun(), with lazy panel creation and
 * reveal-on-reopen. Command bodies are NOT wrapped in runCommand because these
 * methods surface their own user-facing warnings.
 */
export class RunViewerPanel {
  private panel: vscode.WebviewPanel | undefined;
  private readonly service = new RunViewerService();

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** Prompt the user to pick a run from the per-project runs root, then open it. */
  async openWithPicker(): Promise<void> {
    const root = this.service.getWorkspaceRoot();
    if (!root) {
      vscode.window.showWarningMessage('No workspace folder open.');
      return;
    }
    const runsDir = await this.service.getRunsDir(root);
    if (!runsDir) {
      vscode.window.showWarningMessage('No run data found under ~/.fliwright/projects for this workspace.');
      return;
    }
    const runs = await this.service.listRuns(runsDir);
    if (runs.length === 0) {
      vscode.window.showWarningMessage('No runs with timeline.json found under ~/.fliwright/projects for this workspace.');
      return;
    }

    const items = runs.map(r => ({
      label: `${statusIcon(r.status)} ${r.testName}`,
      description: `${stampLabel(r.runId)} · ${r.mode}`,
      detail: `${r.status} · ${r.nodeCount} node(s)${r.endedAt ? ' · ' + r.runId : ''}`,
      runDir: r.runDir,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a run to view',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) return;
    await this.openForRun(picked.runDir);
  }

  /** Open the most recent run. */
  async openLatest(): Promise<void> {
    const root = this.service.getWorkspaceRoot();
    if (!root) {
      vscode.window.showWarningMessage('No workspace folder open.');
      return;
    }
    const runsDir = await this.service.getRunsDir(root);
    if (!runsDir) {
      vscode.window.showWarningMessage('No run data found under ~/.fliwright/projects for this workspace.');
      return;
    }
    const runs = await this.service.listRuns(runsDir);
    if (runs.length === 0) {
      vscode.window.showWarningMessage('No runs with timeline.json found under ~/.fliwright/projects for this workspace.');
      return;
    }
    await this.openForRun(runs[0].runDir);
  }

  /** Load and display a specific run directory. */
  async openForRun(runDir: vscode.Uri): Promise<void> {
    const loaded = await this.service.loadRun(runDir);
    if (!loaded) {
      vscode.window.showWarningMessage('Could not read timeline.json for this run.');
      return;
    }
    await this.show(loaded.runDir, loaded.timeline, loaded.logs, loaded.trace);
  }

  /**
   * Open a specific run directory (e.g. one resolved by
   * `RunViewerService.findLatestRunForTest` / `findLatestRunForScript`).
   * Mirrors `openForRun` — kept as a separate, intent-revealing entry point
   * for the `viewTestRun` / `viewScriptRun` command handlers.
   */
  async openRun(runDir: vscode.Uri): Promise<void> {
    await this.openForRun(runDir);
  }

  private async show(
    runDir: vscode.Uri,
    timeline: TimelineData,
    logs: FliwrightLogEvent[],
    trace: TraceData | undefined,
  ): Promise<void> {
    // Create or reveal the panel.
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'fliwright.runViewer',
        `Fliwright Run Viewer: ${timeline.testName}`,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: [runDir, this.extensionUri],
        },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      // Register the message handler once (panel is reused across runs).
      this.panel.webview.onDidReceiveMessage((msg: RunViewerMessage) => {
        void this.handleMessage(msg);
      });
    }

    // Screenshots live under runDir; expose it to the webview as a resource root + base URL.
    const screenshotBaseUrl = this.panel.webview.asWebviewUri(runDir).toString();
    const nonce = getNonce();
    this.panel.title = `Fliwright Run Viewer: ${timeline.testName}`;
    this.panel.webview.html = getRunViewerHtml(timeline, logs, trace, {
      cspSource: this.panel.webview.cspSource,
      nonce,
      screenshotBaseUrl,
    });
  }

  private async handleMessage(msg: RunViewerMessage): Promise<void> {
    if (msg?.type !== 'openSource') return;
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(msg.file));
      const editor = await vscode.window.showTextDocument(doc);
      const line = Math.max((msg.line ?? 1) - 1, 0);
      const col = Math.max((msg.column ?? 1) - 1, 0);
      const position = new vscode.Position(line, col);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));
    } catch {
      vscode.window.showWarningMessage(`Could not open source: ${msg.file}`);
    }
  }
}

function statusIcon(status: string): string {
  if (status === 'passed') return '✓';
  if (status === 'failed') return '✗';
  if (status === 'running') return '◐';
  return '○';
}

/** Turn a runId like "2026-06-21T08-54-47-auto-login-fill" into "2026-06-21 08:54:47". */
function stampLabel(runId: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(runId);
  if (!m) return runId;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
