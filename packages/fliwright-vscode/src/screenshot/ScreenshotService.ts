import * as vscode from 'vscode';
import type { FliwrightDriver } from '@fliwright/core';

export interface ScreenshotPreview {
  dataUri: string;
  mimeType: 'image/png';
  fullPage?: boolean;
}

export class ScreenshotService {
  async capture(driver: FliwrightDriver, options?: { fullPage?: boolean }): Promise<ScreenshotPreview> {
    // Capture detail at the source so HiDPI previews do not enlarge a 1x bitmap.
    const bytes = await driver.page.screenshot({ pixelRatio: 3, ...(options?.fullPage ? { fullPage: true } : {}) });
    return {
      dataUri: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
      mimeType: 'image/png',
      ...(options?.fullPage ? { fullPage: true } : {}),
    };
  }
}

export class ScreenshotPreviewPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  show(preview: ScreenshotPreview): void {
    const title = preview.fullPage ? 'Fliwright Long Screenshot' : 'Fliwright Screenshot';
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'fliwright.screenshotPreview',
        title,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside);
    }

    this.panel.title = title;
    this.panel.webview.html = screenshotHtml(preview.fullPage === true);
    void this.panel.webview.postMessage(screenshotMessage(preview));
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }
}

function screenshotMessage(preview: ScreenshotPreview): { type: 'screenshot'; base64: string; mimeType: 'image/png' } {
  return {
    type: 'screenshot',
    base64: preview.dataUri.replace(/^data:image\/png;base64,/, ''),
    mimeType: preview.mimeType,
  };
}

function screenshotHtml(fullPage: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fliwright Screenshot</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: ${fullPage ? 'flex-start' : 'center'};
      justify-content: center;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    img {
      max-width: 100vw;
      max-height: ${fullPage ? 'none' : '100vh'};
      object-fit: contain;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="empty" id="empty">Waiting for screenshot...</div>
  <img id="screenshot" alt="Fliwright app screenshot">
  <script>
    let currentUrl;
    const image = document.getElementById('screenshot');
    const empty = document.getElementById('empty');

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.type !== 'screenshot') return;

      const raw = atob(message.base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) {
        bytes[i] = raw.charCodeAt(i);
      }

      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = URL.createObjectURL(new Blob([bytes], { type: message.mimeType }));
      image.src = currentUrl;
      empty.style.display = 'none';
    });
  </script>
</body>
</html>`;
}
