import * as vscode from 'vscode';
import { TestEditorPanel } from './TestEditorPanel.js';

export class TestEditorProvider implements vscode.CustomEditorProvider<TestDocument> {
  private readonly panels = new Map<string, TestEditorPanel>();
  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<TestDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  constructor(private readonly extensionUri: vscode.Uri) {}

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<TestDocument> {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: TestDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(document.uri);
    const panel = new TestEditorPanel(webviewPanel, this.extensionUri, doc);
    this.panels.set(document.uri.toString(), panel);

    webviewPanel.onDidDispose(() => {
      const p = this.panels.get(document.uri.toString());
      if (p) { p.dispose(); }
      this.panels.delete(document.uri.toString());
    });
  }

  /** 获取指定 URI 的编辑器面板（供 EditorBridge 使用） */
  getPanel(uri: vscode.Uri): TestEditorPanel | undefined {
    return this.panels.get(uri.toString());
  }

  saveCustomDocument(_document: TestDocument, _cancellation: vscode.CancellationToken): Thenable<void> {
    return Promise.resolve();
  }

  saveCustomDocumentAs(_document: TestDocument, _destination: vscode.Uri, _cancellation: vscode.CancellationToken): Thenable<void> {
    return Promise.resolve();
  }

  revertCustomDocument(_document: TestDocument, _cancellation: vscode.CancellationToken): Thenable<void> {
    return Promise.resolve();
  }

  backupCustomDocument(_document: TestDocument, _context: vscode.CustomDocumentBackupContext, _cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
    return Promise.resolve({ id: '', delete: () => {} });
  }
}

export interface TestDocument extends vscode.CustomDocument {
  // CustomDocument already has uri and dispose
}
