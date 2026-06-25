import { describe, expect, it } from 'vitest';
import { __webviewPanels } from 'vscode';
import { TddLoopPanel, renderHtml } from '../src/tddloop/TddLoopPanel.js';
import type { TddLoopSnapshot } from '../src/tddloop/TddLoopViewModel.js';

describe('TddLoopPanel', () => {
  it('renderHtml produces a CSP-protected document with a nonce and the inline script', () => {
    const html = renderHtml({ cspSource: 'vscode-resource:' } as any);
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("script-src 'nonce-");
    expect(html).toContain('acquireVsCodeApi');
    expect(html).toContain('Fliwright TDD Loop');
  });

  it('open() creates a panel and posts a snapshot view model (idle when no data)', () => {
    const before = __webviewPanels.length;
    const panel = new TddLoopPanel(undefined, {});
    panel.open();
    const created = __webviewPanels[before];
    expect(created).toBeDefined();
    expect(created.webview.html).toContain('Fliwright TDD Loop');
    // postMessage is synchronous in the stub; the snapshot is posted immediately on open().
    const last = created.webview.postedMessages.at(-1) as any;
    expect(last.type).toBe('snapshot');
    // No snapshot written yet → idle placeholder model (not null).
    expect(last.model).not.toBeNull();
    expect(last.model.phase).toBe('idle');
  });

  it('open(snapshot) posts a view model derived from the snapshot', () => {
    const snapshot: TddLoopSnapshot = {
      connected: true,
      daemonStatus: 'running',
      supportsRestart: true,
      launchMode: 'start',
      restartCapable: true,
      driverConnections: 1,
      fixtureDriverSharing: 'vm-service-url',
      focusedTest: { file: 'src/login.test.ts', testName: 'logs in' },
      lastResult: { status: 'green', file: 'src/login.test.ts', durationMs: 5, lastSync: 'reload', baselineVersion: 1 },
      baselineVersion: 1,
    };
    const before = __webviewPanels.length;
    const panel = new TddLoopPanel(undefined, {});
    panel.open(snapshot);
    const created = __webviewPanels[before];
    const last = created.webview.postedMessages.at(-1) as any;
    expect(last.model.phase).toBe('green');
    expect(last.model.focusedTestLabel).toBe('logs in (src/login.test.ts)');
  });

  it('update() pushes a new snapshot without recreating the panel', () => {
    const before = __webviewPanels.length;
    const panel = new TddLoopPanel(undefined, {});
    panel.open();
    const created = __webviewPanels[before];
    const messagesAfterOpen = created.webview.postedMessages.length;
    panel.update({
      connected: true,
      daemonStatus: 'running',
      supportsRestart: true,
      launchMode: 'start',
      restartCapable: true,
      driverConnections: 1,
      fixtureDriverSharing: 'vm-service-url',
      lastResult: { status: 'red', file: 'a.test.ts', durationMs: 2, lastSync: 'restart', baselineVersion: 1 },
      baselineVersion: 1,
    });
    expect(__webviewPanels.length).toBe(before + 1); // no new panel
    const last = created.webview.postedMessages.at(-1) as any;
    expect(last.model.phase).toBe('red');
    expect(created.webview.postedMessages.length).toBeGreaterThan(messagesAfterOpen);
  });

  it('dispose() is idempotent', () => {
    const panel = new TddLoopPanel(undefined, {});
    expect(() => {
      panel.dispose();
      panel.dispose();
    }).not.toThrow();
  });
});
