import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FliwrightLogEvent } from '@fliwright/core';
import { LogsTab } from '../../src/webview/viewer/components/LogsTab.js';
import type { SerializableRun } from '../../src/webview/viewer/types.js';
import type { Selection } from '../../src/webview/viewer/artifacts.js';

function renderError(error: FliwrightLogEvent['error']): string {
  const node = { id: 'action-2', kind: 'action' as const, title: 'Scroll', status: 'failed' as const,
    startedAt: '2026-11-11T00:00:00Z' };
  const log: FliwrightLogEvent = { version: 1, id: 'log-1', runId: 'run-1', mode: 'test',
    level: 'error', kind: 'action', timestamp: node.startedAt, message: 'Scroll failed',
    timelineNodeId: node.id, error };
  const run: SerializableRun = { runId: 'run-1', screenshotBaseUrl: '', traceBaseUrl: '', logs: [log],
    timeline: { version: 2, runId: 'run-1', mode: 'test', status: 'failed', startedAt: node.startedAt, nodes: [node] } };
  const selection: Selection = { key: node.id, mode: 'timeline', node, logs: [log] };
  return renderToStaticMarkup(createElement(LogsTab, { run, selection }));
}

describe('LogsTab error details', () => {
  it('opens error details and renders all structured error fields as a tree', () => {
    const error = { message: 'No widget found matching selector', code: 'WIDGET_NOT_FOUND',
      actionContext: { action: 'scrollIntoView', target: { key: 'assets.home.token' } } };
    const html = renderError(error);

    expect(html).toMatch(/<details open=""[^>]*><summary[^>]*>error<\/summary>/);
    expect(html).toContain('WIDGET_NOT_FOUND');
    expect(html).toContain('actionContext:');
    expect(html).toContain('assets.home.token');
    expect(html).not.toContain('[object Object]');
  });

  it('keeps native error name, message and multiline stack readable', () => {
    const html = renderError({ name: 'Error', message: 'Scroll failed', stack: 'Error: Scroll failed\n    at scrollIntoView' });
    expect(html).toContain('name:');
    expect(html).toContain('message:');
    expect(html).toContain('Error: Scroll failed\n    at scrollIntoView');
  });
});
