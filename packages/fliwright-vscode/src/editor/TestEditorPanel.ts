// packages/fliwright-vscode/src/editor/TestEditorPanel.ts
import * as vscode from 'vscode';
import { AnnotationParser } from './AnnotationParser.js';
import { AnnotationWriter } from './AnnotationWriter.js';
import { getEditorHtml } from './getHtml.js';
import type { StepModel, WebviewToExt, ExtToWebview } from './types.js';

/** VS Code output channel, set from extension.ts */
export let editorOutput: vscode.OutputChannel | undefined;
export function setEditorOutput(ch: vscode.OutputChannel): void { editorOutput = ch; }
function output(msg: string): void { editorOutput?.appendLine(msg); }

export class TestEditorPanel implements vscode.Disposable {
  private readonly parser = new AnnotationParser();
  private readonly writer = new AnnotationWriter();
  private steps: StepModel[] = [];
  private testName?: string;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly document: vscode.TextDocument,
  ) {
    // 设置 Webview 选项
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, '.fliwright', 'snapshots'),
      ],
    };

    // 处理 Webview 消息
    panel.webview.onDidReceiveMessage((msg: WebviewToExt | { type: 'ready' }) => {
      if (msg.type === 'ready') {
        // Webview 加载完毕，发送初始数据
        output('[FliwrightEditor] Webview ready, sending init data: ' + this.steps.length + ' steps');
        this.panel.webview.postMessage({
          type: 'init',
          steps: this.steps,
          code: this.document.getText(),
          testName: this.testName,
        } satisfies ExtToWebview);
        return;
      }
      this.handleMessage(msg);
    }, null, this.disposables);

    // 首次渲染
    this.refreshFromDocument();
  }

  /** 从文档内容解析并渲染 */
  refreshFromDocument(): void {
    const code = this.document.getText();
    const result = this.parser.parse(code);
    this.steps = result.steps;
    this.testName = result.testName;
    this.render();
  }

  /** 发送消息到 Webview */
  postMessage(message: ExtToWebview): void {
    this.panel.webview.postMessage(message);
  }

  private render(): void {
    const html = getEditorHtml(this.steps, {
      testName: this.testName,
      cspSource: this.panel.webview.cspSource,
      nonce: getNonce(),
    });
    this.panel.webview.html = html;
  }

  private async handleMessage(msg: WebviewToExt): Promise<void> {
    switch (msg.type) {
      case 'select-step':
      case 'toggle-expand':
        // 纯 UI 状态，Webview 自行处理
        break;

      case 'edit-step-name': {
        const step = this.steps[msg.index];
        if (!step) break;
        const code = this.document.getText();
        const updated = this.writer.updateAnnotation(code, step.annotationLine, { name: msg.name });
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          this.document.lineAt(0).range.start,
          this.document.lineAt(this.document.lineCount - 1).range.end,
        );
        edit.replace(this.document.uri, fullRange, updated);
        await vscode.workspace.applyEdit(edit);
        break;
      }

      case 'delete-step': {
        const step = this.steps[msg.index];
        if (!step) break;
        const code = this.document.getText();
        const updated = this.writer.deleteStep(code, {
          annotationLine: step.annotationLine,
          sourceEndLine: step.sourceEndLine + 1, // +1 because AnnotationWriter uses exclusive end
        });
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          this.document.lineAt(0).range.start,
          this.document.lineAt(this.document.lineCount - 1).range.end,
        );
        edit.replace(this.document.uri, fullRange, updated);
        await vscode.workspace.applyEdit(edit);
        break;
      }

      case 'open-source': {
        const step = this.steps.length > 0 ? this.steps[0] : undefined;
        const line = step ? step.annotationLine : 0;
        await vscode.window.showTextDocument(this.document.uri, {
          selection: new vscode.Range(line, 0, line, 0),
        });
        break;
      }

      case 'run-test':
        await vscode.commands.executeCommand('fliwright.runCurrentTest');
        break;

      case 'edit-code':
      case 'apply-healing':
        // v2 features
        break;
    }
  }

  dispose(): void {
    for (const d of this.disposables) { d.dispose(); }
    this.disposables = [];
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
