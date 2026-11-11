import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { RunStatusBar } from '../../src/webview/viewer/components/RunStatusBar.js';
import type { SerializableRun } from '../../src/webview/viewer/types.js';

function run(status: 'passed' | 'running'): SerializableRun {
  return { runId: 'current-run', screenshotBaseUrl: '', traceBaseUrl: '', logs: [],
    timeline: { version: 2, runId: 'current-run', testName: 'Checkout', mode: 'test', status,
      startedAt: '2026-11-08T00:00:00Z', nodes: [] } };
}

it('shows a report button with its run scope in the toolbar', () => {
  const html = renderToStaticMarkup(createElement(RunStatusBar, { run: run('passed'), onGenerateReport: vi.fn(), generatingReport: false }));
  expect(html).toContain('Generate Report');
  expect(html).toContain('all tests in this run');
  expect(html).not.toContain('disabled=""');
});

it.each([{ status: 'passed' as const, busy: true }, { status: 'running' as const, busy: false }])(
  'disables report generation while running or saving (%o)', ({ status, busy }) => {
    const html = renderToStaticMarkup(createElement(RunStatusBar, { run: run(status), onGenerateReport: vi.fn(), generatingReport: busy }));
    expect(html).toContain('disabled=""');
  },
);
