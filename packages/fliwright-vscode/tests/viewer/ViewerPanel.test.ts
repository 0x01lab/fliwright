import { describe, expect, it, vi } from 'vitest';
import { env, Uri, window } from 'vscode';
import type { LoadedRun } from '../../src/runviewer/RunViewerService.js';
import type { RunViewerService } from '../../src/runviewer/RunViewerService.js';
import { ViewerPanel } from '../../src/viewer/ViewerPanel.js';

function makeLoadedRun(overrides: Partial<LoadedRun> = {}): LoadedRun {
  return {
    timeline: {
      version: 1,
      runId: '2026-01-01T00-00-00',
      testName: 'login flow',
      mode: 'test',
      status: 'failed',
      startedAt: '2026-01-01T00:00:00Z',
      nodes: [
        { id: 'page-1', kind: 'page', title: 'Login', status: 'passed', startedAt: '2026-01-01T00:00:00Z' },
        { id: 'assertion-1', kind: 'assertion', title: 'sees dashboard', status: 'failed', startedAt: '2026-01-01T00:00:01Z' },
      ],
    },
    logs: [],
    runDir: Uri.file('/runs/2026-01-01T00-00-00'),
    ...overrides,
  };
}

/** Minimal RunViewerService fake — only loadRun is exercised by openForRun. */
function fakeService(loaded: LoadedRun | undefined): RunViewerService {
  return { loadRun: async () => loaded } as unknown as RunViewerService;
}

describe('ViewerPanel', () => {
  function createPanel(loaded: LoadedRun | undefined = makeLoadedRun()): {
    panel: ViewerPanel;
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
      panel: new ViewerPanel(Uri.file('/extension'), fakeService(loaded)),
      getHtml: () => html,
      getPostedMessages: () => postedMessages,
      sendMessage: (msg: unknown) => messageHandlers.forEach(h => h(msg)),
      restore: () => { (window as any).createWebviewPanel = originalCreate; },
    };
  }

  it('creates a webview panel with scripting and run dir + extension roots', async () => {
    const loaded = makeLoadedRun();
    const { panel, restore } = createPanel(loaded);

    await panel.openForRun(loaded.runDir);

    expect(window.createWebviewPanel).toHaveBeenCalledWith(
      'fliwright.traceViewer',
      expect.stringContaining('login flow'),
      expect.anything(),
      {
        enableScripts: true,
        localResourceRoots: [loaded.runDir, Uri.file('/extension')],
      },
    );

    restore();
  });

  it('renders shell HTML loading the React bundle and CSS with a nonce CSP', async () => {
    const loaded = makeLoadedRun();
    const { panel, getHtml, restore } = createPanel(loaded);

    await panel.openForRun(loaded.runDir);

    const html = getHtml();
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("img-src vscode-resource: data:");
    expect(html).toContain("style-src vscode-resource: 'unsafe-inline'");
    expect(html).toContain('nonce-');
    expect(html).toContain('dist/webview/viewerApp.js');
    expect(html).toContain('dist/webview/viewerApp.css');
    expect(html).toContain('<div id="root"></div>');

    restore();
  });

  it('posts the serialized run to the webview on open', async () => {
    const loaded = makeLoadedRun();
    const { panel, getPostedMessages, restore } = createPanel(loaded);

    await panel.openForRun(loaded.runDir);

    const posted = getPostedMessages();
    expect(posted).toHaveLength(1);
    expect((posted[0] as any).type).toBe('run');
    expect((posted[0] as any).run.timeline.testName).toBe('login flow');
    expect((posted[0] as any).run.screenshotBaseUrl).toContain('/webview');
    expect((posted[0] as any).run.traceBaseUrl).toContain('/trace');

    restore();
  });

  it('reposts the run when the webview reports ready', async () => {
    const loaded = makeLoadedRun();
    const { panel, getPostedMessages, sendMessage, restore } = createPanel(loaded);

    await panel.openForRun(loaded.runDir);
    sendMessage({ type: 'ready' });

    expect(getPostedMessages()).toHaveLength(2);
    expect((getPostedMessages()[1] as any).type).toBe('run');

    restore();
  });

  it('writes Copy-prompt text to the clipboard', async () => {
    const loaded = makeLoadedRun();
    const { panel, sendMessage, restore } = createPanel(loaded);
    await panel.openForRun(loaded.runDir);

    const writeSpy = vi.fn(async () => undefined);
    const originalWrite = env.clipboard.writeText;
    env.clipboard.writeText = writeSpy;

    sendMessage({ type: 'copy', text: 'failure prompt block' });
    await Promise.resolve();

    expect(writeSpy).toHaveBeenCalledWith('failure prompt block');

    env.clipboard.writeText = originalWrite;
    restore();
  });

  it('handles openSource by opening the document', async () => {
    const loaded = makeLoadedRun();
    const { panel, sendMessage, restore } = createPanel(loaded);
    await panel.openForRun(loaded.runDir);

    const showSpy = vi.fn(async () => ({ selection: undefined, revealRange() {} }));
    const originalShow = window.showTextDocument;
    (window as any).showTextDocument = showSpy;

    sendMessage({ type: 'openSource', file: '/test/foo.ts', line: 10, column: 3 });
    await Promise.resolve();

    expect(showSpy).toHaveBeenCalled();

    (window as any).showTextDocument = originalShow;
    restore();
  });
});
