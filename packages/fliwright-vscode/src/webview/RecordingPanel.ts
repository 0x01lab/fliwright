import * as vscode from 'vscode';
import type { FlowCleanPlan, FliwrightFlowDocument } from '@fliwright/core';
import type { RecordingSession } from '../types.js';
import type { CanvasToExtensionMessage, ExtensionToCanvasMessage, RecordingCanvasSession } from './recording-canvas/types.js';

export interface RecordingPanelOptions {
  onSetFrameIncluded?: (frameId: string, included: boolean) => void | Promise<void>;
  onUpdateFlow?: (flow: FliwrightFlowDocument) => void | Promise<void>;
  onCleanFlow?: (options: { apply: boolean; instructions?: string }) => Promise<{
    flow: FliwrightFlowDocument;
    plan: FlowCleanPlan;
    applied: boolean;
  }>;
}

export class RecordingPanel {
  private panel: vscode.WebviewPanel | undefined;
  private lastSession: RecordingSession | undefined;

  constructor(
    private readonly extensionUri?: vscode.Uri,
    private readonly options: RecordingPanelOptions = {},
  ) {}

  open(session: RecordingSession): void {
    this.lastSession = session;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'fliwright.recording',
        'Fliwright Recording',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: this.extensionUri ? [this.extensionUri] : undefined,
        },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((message: CanvasToExtensionMessage) => {
        if (message.type === 'ready') {
          this.postSession();
        }
        if (message.type === 'insertRecordedTest') {
          void vscode.commands.executeCommand('fliwright.insertRecordedTest');
        }
        if (message.type === 'startRecording') {
          void vscode.commands.executeCommand('fliwright.startRecording');
        }
        if (message.type === 'openSavedRecording') {
          void vscode.commands.executeCommand('fliwright.openRecording');
        }
        if (message.type === 'stopRecording') {
          void vscode.commands.executeCommand('fliwright.stopRecording');
        }
        if (message.type === 'setFrameIncluded') {
          void this.options.onSetFrameIncluded?.(message.frameId, message.included);
        }
        if (message.type === 'updateFlow') {
          void this.options.onUpdateFlow?.(message.flow);
        }
        if (message.type === 'cleanFlow') {
          void this.handleCleanFlow(message.requestId, {
            apply: Boolean(message.apply),
            instructions: message.instructions,
          });
        }
      });
      this.panel.webview.html = renderRecordingHtml(this.panel.webview, this.extensionUri);
    }
    this.postSession();
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  update(session: RecordingSession): void {
    this.lastSession = session;
    this.postSession();
  }

  private postSession(): void {
    if (!this.panel || !this.lastSession) return;
    const message: ExtensionToCanvasMessage = {
      type: 'session',
      session: toCanvasSession(this.lastSession),
    };
    void this.panel.webview.postMessage?.(message);
  }

  private async handleCleanFlow(requestId: string, options: { apply: boolean; instructions?: string }): Promise<void> {
    if (!this.panel) return;
    try {
      if (!this.options.onCleanFlow) throw new Error('Flow cleaning is not available.');
      const result = await this.options.onCleanFlow(options);
      const message: ExtensionToCanvasMessage = {
        type: 'flowCleanResult',
        requestId,
        result,
      };
      void this.panel.webview.postMessage?.(message);
    } catch (error) {
      const message: ExtensionToCanvasMessage = {
        type: 'flowCleanResult',
        requestId,
        error: error instanceof Error ? error.message : String(error),
      };
      void this.panel.webview.postMessage?.(message);
    }
  }
}

function renderRecordingHtml(webview: vscode.Webview, extensionUri?: vscode.Uri): string {
  const nonce = getNonce();
  const scriptUri = resourceUri(webview, extensionUri, 'dist/webview/recordingCanvas.js');
  const styleUri = resourceUri(webview, extensionUri, 'dist/webview/recordingCanvas.css');
  const tailwindUri = resourceUri(webview, extensionUri, 'dist/webview/tailwind.css');
  const cspSource = webview.cspSource ?? 'vscode-resource:';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link nonce="${nonce}" rel="stylesheet" href="${tailwindUri}">
  <link nonce="${nonce}" rel="stylesheet" href="${styleUri}">
  <title>Fliwright Recording</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function resourceUri(webview: vscode.Webview, extensionUri: vscode.Uri | undefined, relativePath: string): string {
  if (!extensionUri || typeof webview.asWebviewUri !== 'function') {
    return relativePath;
  }
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...relativePath.split('/'))).toString();
}

function toCanvasSession(session: RecordingSession): RecordingCanvasSession {
  return {
    ...session,
    frames: session.frames ?? [],
  };
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
