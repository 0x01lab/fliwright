import { describe, expect, it, vi } from 'vitest';
import type { FliwrightDriver } from '@fliwright/core';
import { workspace } from 'vscode';
import { __webviewPanels } from 'vscode';
import { ScreenshotPreviewPanel, ScreenshotService } from '../src/screenshot/ScreenshotService.js';

describe('ScreenshotService', () => {
  it('captures the connected app as an in-memory png preview', async () => {
    const bytes = Buffer.from('png-bytes');
    const driver = {
      page: {
        screenshot: vi.fn(async () => bytes),
      },
    } as unknown as FliwrightDriver;
    const createDirectory = vi.spyOn(workspace.fs, 'createDirectory');
    const writeFile = vi.spyOn(workspace.fs, 'writeFile');
    const service = new ScreenshotService();

    const preview = await service.capture(driver);

    expect(driver.page.screenshot).toHaveBeenCalledWith({ pixelRatio: 1 });
    expect(preview).toEqual({
      dataUri: 'data:image/png;base64,cG5nLWJ5dGVz',
      mimeType: 'image/png',
    });
    expect(createDirectory).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('sends screenshot bytes to the preview webview instead of embedding them in html', async () => {
    __webviewPanels.length = 0;
    const panel = new ScreenshotPreviewPanel();
    const preview = {
      dataUri: 'data:image/png;base64,cG5nLWJ5dGVz',
      mimeType: 'image/png' as const,
    };

    panel.show(preview);

    const webview = __webviewPanels.at(-1)?.webview;
    expect(webview?.html).not.toContain(preview.dataUri);
    expect(webview?.postedMessages).toEqual([
      {
        type: 'screenshot',
        base64: 'cG5nLWJ5dGVz',
        mimeType: 'image/png',
      },
    ]);
  });
});
