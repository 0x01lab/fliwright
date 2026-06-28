import { describe, expect, it } from 'vitest';
import type { TraceData } from '@fliwright/core';
import { getTraceHtml } from '../src/trace/getTraceHtml.js';

describe('getTraceHtml', () => {
  it('uses delegated click handlers for CSP-compatible trace selection', () => {
    const traces = new Map<string, TraceData>([
      [
        "tests/quote's-case",
        {
          meta: {
            testName: 'BusinessAlertManager renders paged alerts',
            runId: 'run-1',
            startedAt: '2026-06-28T00:00:00Z',
            status: 'failed',
            totalSteps: 1,
            traceVersion: 1,
          },
          steps: [
            {
              index: 0,
              action: 'tap',
              selector: 'text=Continue',
              status: 'fail',
              durationMs: 12,
              timestamp: '2026-06-28T00:00:01Z',
              screenshotFile: 'step-0.png',
            },
          ],
        },
      ],
    ]);

    const html = getTraceHtml(traces, {
      runId: '2026-06-28T00-00-00',
      cspSource: 'vscode-resource:',
      nonce: 'nonce-1',
      screenshotBaseUrls: new Map([["tests/quote's-case", 'vscode-resource:/trace']]),
    });

    expect(html).not.toContain('onclick=');
    expect(html).toContain("addEventListener('click', onClick)");
    expect(html).toContain('data-action="select-test"');
    expect(html).toContain('data-dir="');
    expect(html).toContain("selectTest(el.getAttribute('data-dir'))");
    expect(html).toContain('data-action="select-step"');
    expect(html).toContain('data-idx="');
    expect(html).toContain("selectStep(Number(el.getAttribute('data-idx')))");
  });
});
