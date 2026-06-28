// packages/fliwright-vscode/src/viewer/ViewerPanel.ts
import * as vscode from 'vscode';
import { RunViewerService, type LoadedRun } from '../runviewer/RunViewerService.js';
import type { SerializableRun, ViewerInbound, ViewerOutbound } from '../webview/viewer/types.js';

/** Maximum log events posted to the webview in one shot (keeps postMessage snappy). */
const LOG_CAP = 2000;

/**
 * Single, reusable viewer WebviewPanel that unifies the old inline-HTML Trace
 * Viewer and Run Viewer. Backed by {@link RunViewerService} (timeline + logs +
 * trace) and rendered by the bundled React app at `dist/webview/viewerApp.js`.
 *
 * Mirrors the recording-canvas host pattern (nonce CSP, `ready` handshake,
 * postMessage protocol) and the Run Viewer's data-loading entry points
 * (`openWithPicker`/`openLatest`/`openForRun`/`openRun`).
 */
export class ViewerPanel {
  private panel: vscode.WebviewPanel | undefined;
  /** The run directory the current panel's localResourceRoots were scoped to. */
  private runDir: vscode.Uri | undefined;
  private lastRun: SerializableRun | undefined;
  private readonly service: RunViewerService;

  constructor(
    private readonly extensionUri: vscode.Uri,
    service?: RunViewerService,
  ) {
    this.service = service ?? new RunViewerService();
  }

  /** Prompt the user to pick a run (newest-first), then open it. */
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
    await this.show(loaded);
  }

  /** Alias of {@link openForRun}; intent-revealing entry for view-button handlers. */
  async openRun(runDir: vscode.Uri): Promise<void> {
    await this.openForRun(runDir);
  }

  private async show(loaded: LoadedRun): Promise<void> {
    // Screenshots live under runDir; the bundle lives under extensionUri. Both
    // must be in localResourceRoots. If a panel already exists but was scoped to
    // a different run dir, recreate it so the new run's images are reachable.
    if (this.panel && this.runDir && this.runDir.toString() !== loaded.runDir.toString()) {
      this.panel.dispose();
      this.panel = undefined;
      this.runDir = undefined;
    }

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'fliwright.traceViewer',
        `Fliwright Trace Viewer: ${loaded.timeline.testName}`,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: [loaded.runDir, this.extensionUri],
        },
      );
      this.runDir = loaded.runDir;
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.runDir = undefined;
      });
      // Register the message handler once (panel is reused for the same run dir).
      this.panel.webview.onDidReceiveMessage((msg: ViewerOutbound) => {
        void this.handleMessage(msg);
      });
      this.panel.webview.html = this.renderHtml(this.panel.webview);
    }

    this.panel.title = `Fliwright Trace Viewer: ${loaded.timeline.testName}`;
    this.lastRun = this.toSerializableRun(loaded, this.panel.webview);
    this.postRun();
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  private postRun(): void {
    if (!this.panel || !this.lastRun) return;
    const message: ViewerInbound = { type: 'run', run: this.lastRun };
    void this.panel.webview.postMessage?.(message);
  }

  private async handleMessage(msg: ViewerOutbound): Promise<void> {
    if (msg.type === 'ready') {
      this.postRun();
      return;
    }
    if (msg.type === 'copy') {
      try {
        await vscode.env.clipboard.writeText(msg.text);
      } catch {
        /* clipboard may be unavailable in some hosts */
      }
      return;
    }
    if (msg.type === 'openSource') {
      await this.openSource(msg.file, msg.line, msg.column);
      return;
    }
    if (msg.type === 'requestSnapshot') {
      await this.handleRequestSnapshot(msg.path);
    }
  }

  /** Read a snapshot artifact (relative to the run dir) and post its parsed JSON back. */
  private async handleRequestSnapshot(path: string): Promise<void> {
    if (!this.panel || !this.runDir) return;
    let data: unknown = null;
    try {
      const uri = vscode.Uri.joinPath(this.runDir, path);
      const buf = await vscode.workspace.fs.readFile(uri);
      data = JSON.parse(Buffer.from(buf).toString('utf8'));
    } catch {
      data = null;
    }
    void this.panel.webview.postMessage({ type: 'snapshot', path, data });
  }

  private async openSource(file: string, line?: number, column?: number): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      const editor = await vscode.window.showTextDocument(doc);
      const posLine = Math.max((line ?? 1) - 1, 0);
      const posCol = Math.max((column ?? 1) - 1, 0);
      const position = new vscode.Position(posLine, posCol);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));
    } catch {
      vscode.window.showWarningMessage(`Could not open source: ${file}`);
    }
  }

  private toSerializableRun(loaded: LoadedRun, webview: vscode.Webview): SerializableRun {
    const total = loaded.logs.length;
    const logs = total > LOG_CAP ? loaded.logs.slice(total - LOG_CAP) : loaded.logs;
    const run: SerializableRun = {
      timeline: loaded.timeline,
      logs,
      runId: loaded.timeline.runId,
      screenshotBaseUrl: webview.asWebviewUri(loaded.runDir).toString(),
      traceBaseUrl: webview.asWebviewUri(vscode.Uri.joinPath(loaded.runDir, 'trace')).toString(),
    };
    if (loaded.trace) run.trace = loaded.trace;
    if (total > LOG_CAP) {
      run.logsTruncated = true;
      run.logsTotal = total;
    }
    return run;
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = resourceUri(webview, this.extensionUri, 'dist/webview/viewerApp.js');
    const styleUri = resourceUri(webview, this.extensionUri, 'dist/webview/viewerApp.css');
    const cspSource = webview.cspSource ?? 'vscode-resource:';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link nonce="${nonce}" rel="stylesheet" href="${styleUri}">
  <title>Fliwright Trace Viewer</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function resourceUri(webview: vscode.Webview, extensionUri: vscode.Uri, relativePath: string): string {
  if (typeof webview.asWebviewUri !== 'function') return relativePath;
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...relativePath.split('/'))).toString();
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
