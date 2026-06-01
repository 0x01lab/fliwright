import * as path from 'node:path';
import * as vscode from 'vscode';
import type { FailureEntry } from '../types.js';

export class FailurePanel {
  constructor(private readonly extensionUri: vscode.Uri) {}

  open(failure: FailureEntry): void {
    const panel = vscode.window.createWebviewPanel(
      'fliwright.failure',
      `Fliwright Failure: ${failure.testName}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, localResourceRoots: [this.extensionUri] },
    );
    panel.webview.html = renderFailureHtml(failure);
    panel.webview.onDidReceiveMessage(async (message: FailureWebviewMessage) => {
      if (message.type === 'openSource') {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(message.file));
        const editor = await vscode.window.showTextDocument(doc);
        const position = new vscode.Position(Math.max(message.line - 1, 0), 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position));
      }
      if (message.type === 'copySelector') {
        await vscode.env.clipboard.writeText(message.selector);
      }
      if (message.type === 'applySelector') {
        await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(message.file), vscode.Uri.file(message.file), 'Review selector update');
        vscode.window.showInformationMessage(`Review selector update: ${message.from} -> ${message.to}`);
      }
    });
  }
}

type FailureWebviewMessage =
  | { type: 'openSource'; file: string; line: number }
  | { type: 'copySelector'; selector: string }
  | { type: 'applySelector'; file: string; line: number; from: string; to: string };

function renderFailureHtml(failure: FailureEntry): string {
  const suggestion = failure.healingSuggestion;
  const screenshot = failure.screenshotPath
    ? `<section><h2>Screenshot</h2><p>${escapeHtml(path.basename(failure.screenshotPath))}</p></section>`
    : '';
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
    h1 { font-size: 18px; margin: 0 0 12px; }
    h2 { font-size: 13px; margin: 18px 0 8px; }
    pre { background: var(--vscode-editor-background); padding: 12px; overflow: auto; border-radius: 4px; }
    button { margin-right: 8px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(failure.testName)}</h1>
  <section><h2>Error</h2><pre>${escapeHtml(failure.error ?? JSON.stringify(failure.assertion ?? {}, null, 2))}</pre></section>
  ${screenshot}
  <section><h2>Widget Tree</h2><pre>${escapeHtml(JSON.stringify(failure.widgetTree ?? {}, null, 2))}</pre></section>
  <section><h2>Self-Healing</h2>${
    suggestion
      ? `<p>${escapeHtml(suggestion.originalSelector)} -> ${escapeHtml(suggestion.suggestedSelector)} (${Math.round(suggestion.confidence * 100)}%)</p>
         <button id="copy">Copy selector</button><button id="apply">Apply with diff</button>`
      : '<p>No healing suggestion available.</p>'
  }</section>
  <script>
    const vscode = acquireVsCodeApi();
    const suggestion = ${JSON.stringify(suggestion ?? null)};
    const source = ${JSON.stringify(failure.source ?? null)};
    document.getElementById('copy')?.addEventListener('click', () => vscode.postMessage({ type: 'copySelector', selector: suggestion.suggestedSelector }));
    document.getElementById('apply')?.addEventListener('click', () => source && vscode.postMessage({ type: 'applySelector', file: source.file, line: source.line, from: suggestion.originalSelector, to: suggestion.suggestedSelector }));
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
