import { describe, expect, it, vi } from 'vitest';
import { commands, Uri, window } from 'vscode';
import type { RecordingSession } from '../src/types.js';
import { RecordingPanel } from '../src/webview/RecordingPanel.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('RecordingPanel', () => {
  it('serves local evidence by webview URL and refuses references outside the recording', () => {
    const root = mkdtempSync(join(tmpdir(), 'recording-panel-'));
    const { panel, getPostedMessages, restore } = createPanel();
    try {
      mkdirSync(join(root, 'screenshots'));
      writeFileSync(join(root, 'screenshots/frame.png'), 'png');
      panel.open({ status: 'preview', rawEventCount: 0, operationCount: 1, artifactDirectory: root,
        frames: [ { id: 'frame', index: 0, kind: 'tap', status: 'ready', timestamp: 1,
          position: { x: 1, y: 2 }, screenshot: { path: 'screenshots/frame.png', byteLength: 3, format: 'png' } },
        { id: 'escape', index: 1, kind: 'tap', status: 'ready', timestamp: 2,
          position: { x: 1, y: 2 }, screenshot: { path: '../outside.png', byteLength: 3, format: 'png' } } ],
      });
      const message = getPostedMessages()[0] as any;
      expect(message.session.frames[0].screenshot.uri).toContain(`/webview${root}/screenshots/frame.png`);
      expect(message.session.frames[1]).toMatchObject({ status: 'error', screenshot: undefined });
      expect(JSON.stringify(message)).not.toContain('base64');
    } finally { restore(); rmSync(root, { recursive: true, force: true }); }
  });
  it.each([
    ['confirmRecordingCheckpoints', 'fliwright.confirmRecordingCheckpoints'],
    ['verifyRecording', 'fliwright.verifyRecording'],
  ])('forwards %s from the review panel', (type, command) => {
    const { panel, sendMessage, restore } = createPanel();
    const spy = vi.spyOn(commands, 'executeCommand').mockResolvedValue(undefined);
    try {
      panel.open({ status: 'preview', rawEventCount: 0, operationCount: 0 });
      sendMessage({ type });
      expect(spy).toHaveBeenCalledWith(command);
    } finally { spy.mockRestore(); restore(); }
  });

  it('forwards edited checkpoint candidates to the recorder review handler', () => {
    const onReviewRecordingCheckpoints = vi.fn();
    const { panel, sendMessage, restore } = createPanel({ onReviewRecordingCheckpoints });
    panel.open({ status: 'preview', rawEventCount: 0, operationCount: 1 });

    const checkpoints = [{
      id: 'saved',
      query: { match: { key: 'result' } },
      matcher: 'toHaveText',
      expected: 'Saved',
      source: 'snapshot',
      confirmed: true,
    }] as const;
    sendMessage({ type: 'reviewRecordingCheckpoints', checkpoints });

    expect(onReviewRecordingCheckpoints).toHaveBeenCalledWith(checkpoints);
    restore();
  });
  function createPanel(options?: ConstructorParameters<typeof RecordingPanel>[1]): {
    panel: RecordingPanel;
    getHtml: () => string;
    getPostedMessages: () => unknown[];
    sendMessage: (msg: unknown) => void;
    restore: () => void;
  } {
    const postedMessages: unknown[] = [];
    const messageHandlers: Array<(msg: unknown) => void> = [];
    let html = '';

    const mockWebviewPanel = {
      webview: {
        cspSource: 'vscode-resource:',
        get html() { return html; },
        set html(value: string) { html = value; },
        asWebviewUri(uri: Uri) {
          return Uri.file(`/webview${uri.path}`);
        },
        postMessage(message: unknown) {
          postedMessages.push(message);
          return Promise.resolve(true);
        },
        onDidReceiveMessage(handler: (msg: unknown) => void) {
          messageHandlers.push(handler);
          return { dispose() {} };
        },
      },
      onDidDispose() {
        return { dispose() {} };
      },
      reveal() {},
      dispose() {},
    };

    const originalCreate = window.createWebviewPanel;
    (window as any).createWebviewPanel = vi.fn(() => mockWebviewPanel);

    return {
      panel: new RecordingPanel(Uri.file('/extension'), options),
      getHtml: () => html,
      getPostedMessages: () => postedMessages,
      sendMessage: (msg: unknown) => messageHandlers.forEach(h => h(msg)),
      restore: () => { (window as any).createWebviewPanel = originalCreate; },
    };
  }

  it('creates a webview panel with scripting and local roots enabled', () => {
    const { panel, restore } = createPanel();

    panel.open({ status: 'idle', rawEventCount: 0, operationCount: 0, frames: [] });

    expect(window.createWebviewPanel).toHaveBeenCalledWith(
      'fliwright.recording',
      'Fliwright Recording',
      expect.anything(),
      {
        enableScripts: true,
        localResourceRoots: [Uri.file('/extension')],
      },
    );

    restore();
  });

  it('renders shell HTML that loads the local React Flow bundle and CSS', () => {
    const { panel, getHtml, restore } = createPanel();

    panel.open({ status: 'recording', rawEventCount: 1, operationCount: 0, frames: [] });

    const html = getHtml();
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("img-src vscode-resource: data:");
    expect(html).toContain('dist/webview/recordingCanvas.js');
    expect(html).toContain('dist/webview/recordingCanvas.css');
    expect(html).toContain('dist/webview/tailwind.css');
    expect(html).toContain('<div id="root"></div>');

    restore();
  });

  it('posts the session to the webview on open and update', () => {
    const { panel, getPostedMessages, restore } = createPanel();
    const first: RecordingSession = {
      status: 'recording',
      rawEventCount: 2,
      operationCount: 1,
      frames: [
        {
          id: 'frame-1',
          index: 0,
          kind: 'tap',
          status: 'ready',
          timestamp: 1000,
          position: { x: 10, y: 20 },
          screenshot: { path: 'screenshots/frame.png', byteLength: 3, format: 'png', width: 100, height: 200, pixelRatio: 1 },
        },
      ],
    };

    panel.open(first);
    panel.update({ ...first, rawEventCount: 3 });

    expect(getPostedMessages()).toEqual([
      { type: 'session', session: first },
      { type: 'session', session: { ...first, rawEventCount: 3 } },
    ]);

    restore();
  });

  it('reposts the latest session when the webview reports ready', () => {
    const { panel, getPostedMessages, sendMessage, restore } = createPanel();

    panel.open({ status: 'preview', rawEventCount: 0, operationCount: 0, generatedCode: 'code' });
    sendMessage({ type: 'ready' });

    expect(getPostedMessages()).toHaveLength(2);
    expect(getPostedMessages()[1]).toEqual({
      type: 'session',
      session: {
        status: 'preview',
        rawEventCount: 0,
        operationCount: 0,
        generatedCode: 'code',
        frames: [],
      },
    });

    restore();
  });

  it('sends insertRecordedTest command from webview messages', () => {
    const { panel, sendMessage, restore } = createPanel();
    panel.open({ status: 'preview', rawEventCount: 0, operationCount: 0, generatedCode: 'code' });

    const executeSpy = vi.fn();
    const originalExecute = commands.executeCommand;
    (commands as any).executeCommand = executeSpy;

    sendMessage({ type: 'insertRecordedTest' });
    expect(executeSpy).toHaveBeenCalledWith('fliwright.insertRecordedTest');

    (commands as any).executeCommand = originalExecute;
    restore();
  });

  it('sends openRecording command from webview messages', () => {
    const { panel, sendMessage, restore } = createPanel();
    panel.open({ status: 'preview', rawEventCount: 0, operationCount: 0, generatedCode: 'code', recordingDir: '/workspace/.fliwright/recordings/recording-1' });

    const executeSpy = vi.fn();
    const originalExecute = commands.executeCommand;
    (commands as any).executeCommand = executeSpy;

    sendMessage({ type: 'openSavedRecording' });
    expect(executeSpy).toHaveBeenCalledWith('fliwright.openRecording');

    (commands as any).executeCommand = originalExecute;
    restore();
  });

  it('sends startRecording command from webview messages', () => {
    const { panel, sendMessage, restore } = createPanel();
    panel.open({ status: 'preview', rawEventCount: 0, operationCount: 0, frames: [] });

    const executeSpy = vi.fn();
    const originalExecute = commands.executeCommand;
    (commands as any).executeCommand = executeSpy;

    sendMessage({ type: 'startRecording' });
    expect(executeSpy).toHaveBeenCalledWith('fliwright.startRecording');

    (commands as any).executeCommand = originalExecute;
    restore();
  });

  it('sends stopRecording command from webview messages', () => {
    const { panel, sendMessage, restore } = createPanel();
    panel.open({ status: 'recording', rawEventCount: 0, operationCount: 0 });

    const executeSpy = vi.fn();
    const originalExecute = commands.executeCommand;
    (commands as any).executeCommand = executeSpy;

    sendMessage({ type: 'stopRecording' });
    expect(executeSpy).toHaveBeenCalledWith('fliwright.stopRecording');

    (commands as any).executeCommand = originalExecute;
    restore();
  });

  it('forwards frame inclusion messages from the webview', () => {
    const onSetFrameIncluded = vi.fn();
    const { panel, sendMessage, restore } = createPanel({ onSetFrameIncluded });
    panel.open({ status: 'recording', rawEventCount: 0, operationCount: 0 });

    sendMessage({ type: 'setFrameIncluded', frameId: 'frame-1', included: false });

    expect(onSetFrameIncluded).toHaveBeenCalledWith('frame-1', false);
    restore();
  });

  it('runs flow clean requests and posts the result back to the webview', async () => {
    const onCleanFlow = vi.fn(async () => ({
      flow: {
        version: 1,
        id: 'checkout',
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
        nodes: [{ id: 'screen-1', type: 'screen', title: 'Checkout' }],
        edges: [],
      },
      plan: {
        version: 1,
        keptNodeIds: ['screen-1'],
        removedNodeIds: ['tap-noise'],
        reasons: [],
      },
      applied: false,
    }));
    const { panel, getPostedMessages, sendMessage, restore } = createPanel({ onCleanFlow });
    panel.open({ status: 'preview', rawEventCount: 0, operationCount: 2, frames: [] });

    sendMessage({ type: 'cleanFlow', requestId: 'clean-1', apply: false, instructions: 'keep checkout only' });
    await Promise.resolve();

    expect(onCleanFlow).toHaveBeenCalledWith({
      apply: false,
      instructions: 'keep checkout only',
    });
    expect(getPostedMessages().at(-1)).toEqual({
      type: 'flowCleanResult',
      requestId: 'clean-1',
      result: expect.objectContaining({
        applied: false,
        plan: expect.objectContaining({
          removedNodeIds: ['tap-noise'],
        }),
      }),
    });
    restore();
  });

  it('posts flow clean errors back to the webview', async () => {
    const onCleanFlow = vi.fn(async () => {
      throw new Error('AI disabled');
    });
    const { panel, getPostedMessages, sendMessage, restore } = createPanel({ onCleanFlow });
    panel.open({ status: 'preview', rawEventCount: 0, operationCount: 2, frames: [] });

    sendMessage({ type: 'cleanFlow', requestId: 'clean-1', apply: true });
    await Promise.resolve();

    expect(getPostedMessages().at(-1)).toEqual({
      type: 'flowCleanResult',
      requestId: 'clean-1',
      error: 'AI disabled',
    });
    restore();
  });
});
