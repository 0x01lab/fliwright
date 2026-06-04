import { describe, expect, it, vi } from 'vitest';
import { commands, window } from 'vscode';
import type { RecordingSession } from '../src/types.js';
import { RecordingPanel } from '../src/webview/RecordingPanel.js';

describe('RecordingPanel', () => {
  function createPanel(): { panel: RecordingPanel; getHtml: () => string; getMessages: () => Array<{ type: string }> } {
    const messages: Array<{ type: string }> = { length: 0 } as any;
    const messageHandlers: Array<(msg: any) => void> = [];
    let html = '';

    const mockWebviewPanel = {
      webview: {
        get html() { return html; },
        set html(value: string) { html = value; },
        onDidReceiveMessage(handler: (msg: any) => void) {
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
      panel: new RecordingPanel(),
      getHtml: () => html,
      getMessages: () => messages,
      sendMessage: (msg: any) => messageHandlers.forEach(h => h(msg)),
      restore: () => { (window as any).createWebviewPanel = originalCreate; },
    };
  }

  describe('open', () => {
    it('creates a webview panel with scripting enabled', () => {
      const { panel, restore } = createPanel();
      panel.open({ status: 'idle', rawEventCount: 0, operationCount: 0 });

      expect(window.createWebviewPanel).toHaveBeenCalledWith(
        'fliwright.recording',
        'Fliwright Recording',
        expect.anything(),
        { enableScripts: true },
      );

      restore();
    });

    it('reuses existing panel on subsequent opens', () => {
      const { panel, restore } = createPanel();
      panel.open({ status: 'idle', rawEventCount: 0, operationCount: 0 });
      panel.open({ status: 'recording', rawEventCount: 5, operationCount: 3 });

      expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);

      restore();
    });
  });

  describe('HTML rendering', () => {
    it('renders idle state as "Ready to Record"', () => {
      const { panel, getHtml, restore } = createPanel();
      panel.open({ status: 'idle', rawEventCount: 0, operationCount: 0 });

      const html = getHtml();
      expect(html).toContain('Ready to Record');
      expect(html).toContain('Raw events');
      expect(html).toContain('active editor');
      expect(html).not.toContain('Stop Recording');
      expect(html).not.toContain('Generated Test');

      restore();
    });

    it('renders recording state with stop button', () => {
      const { panel, getHtml, restore } = createPanel();
      panel.open({ status: 'recording', rawEventCount: 12, operationCount: 5, startedAt: Date.now() });

      const html = getHtml();
      expect(html).toContain('Recording');
      expect(html).toContain('>12<');
      expect(html).toContain('>5<');
      expect(html).toContain('Stop Recording');
      expect(html).not.toContain('Generated Test');

      restore();
    });

    it('renders preview state with generated code and insert button', () => {
      const { panel, getHtml, restore } = createPanel();
      const session: RecordingSession = {
        status: 'preview',
        rawEventCount: 12,
        operationCount: 5,
        generatedCode: "test('login flow', async () => { await page.click('#btn'); });",
        targetFile: '/app/tests/login.test.ts',
      };
      panel.open(session);

      const html = getHtml();
      expect(html).toContain('Recording Preview');
      expect(html).toContain('Generated Test');
      // escapeHtml escapes < > & " but not single quotes — verify > is escaped in =>
      expect(html).toContain("test('login flow', async () =&gt;");
      expect(html).toContain('/app/tests/login.test.ts');
      expect(html).toContain('Insert Recorded Test');
      expect(html).not.toContain('Stop Recording');

      restore();
    });
  });

  describe('HTML escaping (XSS prevention)', () => {
    it('escapes special characters in generated code within <pre>', () => {
      const { panel, getHtml, restore } = createPanel();
      const session: RecordingSession = {
        status: 'preview',
        rawEventCount: 0,
        operationCount: 0,
        generatedCode: '<script>alert("xss")</script>&<>"',
      };
      panel.open(session);

      const html = getHtml();
      // The <pre> block should contain escaped content
      expect(html).toContain('<pre>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&amp;&lt;&gt;&quot;</pre>');
      // Raw unescaped injected code should not appear (the template's own <script> is fine)
      expect(html).not.toContain('<script>alert');

      restore();
    });

    it('escapes special characters in targetFile path', () => {
      const { panel, getHtml, restore } = createPanel();
      const session: RecordingSession = {
        status: 'preview',
        rawEventCount: 0,
        operationCount: 0,
        generatedCode: 'test("a", () => {});',
        targetFile: '<img onerror="alert(1)">',
      };
      panel.open(session);

      const html = getHtml();
      expect(html).toContain('&lt;img onerror=&quot;alert(1)&quot;&gt;');
      expect(html).not.toContain('<img onerror');

      restore();
    });
  });

  describe('webview message handling', () => {
    it('sends insertRecordedTest command when insert button is clicked', () => {
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

    it('sends stopRecording command when stop button is clicked', () => {
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
  });

  describe('update', () => {
    it('updates HTML without creating a new panel', () => {
      const { panel, getHtml, restore } = createPanel();
      panel.open({ status: 'idle', rawEventCount: 0, operationCount: 0 });

      const idleHtml = getHtml();
      expect(idleHtml).toContain('Ready to Record');

      panel.update({ status: 'recording', rawEventCount: 3, operationCount: 1 });

      const updatedHtml = getHtml();
      expect(updatedHtml).toContain('Recording');
      expect(updatedHtml).toContain('>3<');
      expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);

      restore();
    });

    it('does nothing if no panel has been created', () => {
      const { panel, getHtml, restore } = createPanel();
      // Should not throw
      panel.update({ status: 'recording', rawEventCount: 1, operationCount: 1 });

      expect(getHtml()).toBe('');

      restore();
    });
  });
});
