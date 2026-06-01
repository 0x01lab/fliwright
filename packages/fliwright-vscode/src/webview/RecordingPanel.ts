import * as vscode from 'vscode';
import type { RecordingSession } from '../types.js';

export class RecordingPanel {
  private panel: vscode.WebviewPanel | undefined;

  open(session: RecordingSession): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'fliwright.recording',
        'Fliwright Recording',
        vscode.ViewColumn.Beside,
        { enableScripts: true },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((message: { type: string }) => {
        if (message.type === 'insertRecordedTest') {
          void vscode.commands.executeCommand('fliwright.insertRecordedTest');
        }
        if (message.type === 'stopRecording') {
          void vscode.commands.executeCommand('fliwright.stopRecording');
        }
      });
    }
    this.update(session);
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  update(session: RecordingSession): void {
    if (!this.panel) return;
    this.panel.webview.html = renderRecordingHtml(session);
  }
}

function renderRecordingHtml(session: RecordingSession): string {
  const code = session.generatedCode
    ? `<h2>Generated Test</h2><pre>${escapeHtml(session.generatedCode)}</pre><button id="insert">Insert Recorded Test</button>`
    : '';
  const stop = session.status === 'recording' ? '<button id="stop">Stop Recording</button>' : '';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
    h1 { font-size: 18px; margin: 0 0 12px; }
    h2 { font-size: 13px; margin: 18px 0 8px; }
    dl { display: grid; grid-template-columns: 120px 1fr; gap: 6px 12px; }
    dt { color: var(--vscode-descriptionForeground); }
    dd { margin: 0; }
    pre { background: var(--vscode-editor-background); padding: 12px; overflow: auto; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>${title(session.status)}</h1>
  <dl>
    <dt>Raw events</dt><dd>${session.rawEventCount}</dd>
    <dt>Operations</dt><dd>${session.operationCount}</dd>
    <dt>Target</dt><dd>${escapeHtml(session.targetFile ?? 'active editor')}</dd>
  </dl>
  ${stop}
  ${code}
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('insert')?.addEventListener('click', () => vscode.postMessage({ type: 'insertRecordedTest' }));
    document.getElementById('stop')?.addEventListener('click', () => vscode.postMessage({ type: 'stopRecording' }));
  </script>
</body>
</html>`;
}

function title(status: RecordingSession['status']): string {
  if (status === 'recording') return 'Recording';
  if (status === 'preview') return 'Recording Preview';
  return 'Ready to Record';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
