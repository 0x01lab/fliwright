/**
 * Read-only TDD Loop monitor webview panel (design spec §4.3 / §5.4 / §10 P1).
 *
 * Mirrors the structure of {@link RecordingPanel}: a lazily-created `vscode.WebviewPanel` that is
 * invisible until the user opens it, posts view-model updates via `postMessage`, and renders an
 * inline HTML document. No bundled webview assets are required — the HTML + script are generated
 * inline with a Content-Security-Policy nonce (the script is tiny and only renders posted JSON).
 *
 * READ-ONLY by construction (principle 4): the only inbound messages the panel accepts are
 * `ready` (resend latest snapshot) and `refresh` (ask the host to re-read the source). The panel
 * never drives the app.
 */
import * as vscode from 'vscode';
import type { TddLoopViewModel, TddLoopSnapshot } from './TddLoopViewModel.js';
import { toTddLoopViewModel } from './TddLoopViewModel.js';

/** Inbound messages from the webview to the extension host. */
export type TddLoopPanelInbound =
  | { type: 'ready' }
  | { type: 'refresh' };

/** Outbound message: the latest view model (or `null` when no snapshot exists). */
export interface TddLoopPanelOutbound {
  type: 'snapshot';
  model: TddLoopViewModel | null;
}

export interface TddLoopPanelOptions {
  /** Called when the webview asks for a manual refresh. Defaults to a no-op. */
  onRefresh?: () => unknown | Promise<unknown>;
}

const VIEW_TYPE = 'fliwright.tddLoop';
const VIEW_TITLE = 'Fliwright TDD Loop';

export class TddLoopPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private lastSnapshot: TddLoopSnapshot | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri | undefined,
    private readonly options: TddLoopPanelOptions = {},
  ) {}

  /** Open (or reveal) the panel and render the latest snapshot. */
  open(snapshot?: TddLoopSnapshot): void {
    this.lastSnapshot = snapshot;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        VIEW_TITLE,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          // Only the extension's own root is needed; all assets are inline.
          localResourceRoots: this.extensionUri ? [this.extensionUri] : undefined,
        },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((message: TddLoopPanelInbound) => {
        if (message?.type === 'ready') {
          this.postSnapshot();
        } else if (message?.type === 'refresh') {
          void this.options.onRefresh?.();
        }
      });
      this.panel.webview.html = renderHtml(this.panel.webview);
    }
    this.postSnapshot();
    this.panel.reveal(vscode.ViewColumn.Beside, false);
  }

  /** Update the rendered snapshot without forcing the panel into focus. */
  update(snapshot: TddLoopSnapshot | undefined): void {
    this.lastSnapshot = snapshot;
    this.postSnapshot();
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private postSnapshot(): void {
    if (!this.panel) return;
    const message: TddLoopPanelOutbound = {
      type: 'snapshot',
      model: toTddLoopViewModel(this.lastSnapshot),
    };
    void this.panel.webview.postMessage(message);
  }
}

/** Render the inline HTML document. Exported for tests. */
export function renderHtml(webview: vscode.Webview): string {
  const nonce = getNonce();
  const cspSource = webview.cspSource ?? 'vscode-resource:';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${VIEW_TITLE}</title>
  <style>
    body { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground, #333); margin: 16px; }
    h1 { font-size: 1.1rem; margin: 0 0 12px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-weight: 600; font-size: 0.8rem; }
    .badge-red { background: var(--vscode-statusBarItem-errorBackground, #5a1d1d); color: var(--vscode-statusBarItem-errorForeground, #ffdada); }
    .badge-green { background: var(--vscode-testing-runAction, #1e4d2b); color: #d7fde0; }
    .badge-idle { background: var(--vscode-badge-background, #444); color: var(--vscode-badge-foreground, #ddd); }
    .row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--vscode-editorWidget-border, #eee); }
    .row:last-child { border-bottom: none; }
    .label { color: var(--vscode-descriptionForeground, #888); }
    .value { font-family: var(--vscode-editor-font-family, monospace); }
    .muted { color: var(--vscode-descriptionForeground, #888); font-style: italic; }
    button { margin-top: 12px; padding: 4px 12px; background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border: none; border-radius: 2px; cursor: pointer; }
    .notes { margin-top: 8px; padding: 6px 8px; background: var(--vscode-textBlockQuote-background, rgba(127,127,127,.1)); border-radius: 3px; font-size: 0.85rem; }
  </style>
</head>
<body>
  <h1>Fliwright TDD Loop</h1>
  <div id="content"><p class="muted">Loading…</p></div>
  <div id="notes"></div>
  <div><button id="refresh" type="button">Refresh</button></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const content = document.getElementById('content');
    const notesEl = document.getElementById('notes');
    function esc(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
    function row(label, value, cls) {
      return '<div class="row"><span class="label">' + esc(label) + '</span><span class="value ' + (cls || '') + '">' + esc(value) + '</span></div>';
    }
    function render(model) {
      if (!model) { content.innerHTML = '<p class="muted">No TDD runtime snapshot yet. Start the loop from the agent (fliwright_tdd_start) to populate this panel.</p>'; notesEl.innerHTML = ''; return; }
      const badge = '<span class="badge badge-' + model.phase + '">' + esc(model.phaseLabel) + '</span>';
      let html = '<div class="row"><span class="label">Phase</span><span>' + badge + '</span></div>';
      html += row('Connected', model.connected ? 'yes' : 'no');
      html += row('Daemon', model.daemonStatus);
      if (model.appId) html += row('App id', model.appId);
      html += row('Launch mode', model.launchMode + (model.launchMode === 'attach' ? ' (degraded)' : ''));
      html += row('Supports restart', model.supportsRestart ? 'yes' : 'no');
      html += row('Restart capable', model.restartCapable ? 'yes' : 'no');
      html += row('Driver connections', model.driverConnections);
      html += row('Fixture driver sharing', model.fixtureDriverSharing);
      if (model.focusedTestLabel) html += row('Focused test', model.focusedTestLabel);
      if (model.lastResultStatus) {
        html += row('Last result', model.lastResultStatus, 'badge-' + model.lastResultStatus);
        if (model.lastResultDurationMs !== undefined) html += row('Last duration', model.lastResultDurationMs + ' ms');
        if (model.lastResultSync) html += row('Last sync', model.lastResultSync);
        if (model.lastResultFailureMessage) html += row('Failure', model.lastResultFailureMessage);
      }
      html += row('Baseline version', model.baselineVersion);
      if (model.unsupportedState.length) html += row('Unsupported state', model.unsupportedState.join(', '));
      if (model.updatedAtMs) html += row('Updated', new Date(model.updatedAtMs).toLocaleTimeString());
      content.innerHTML = html;
      notesEl.innerHTML = model.notes.length ? '<div class="notes">' + model.notes.map(esc).join('<br>') + '</div>' : '';
    }
    document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg && msg.type === 'snapshot') render(msg.model);
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
