import { describe, expect, it } from 'vitest';
import { parseTimelineData, summarizeTimeline } from '../../src/timeline/TimelineReader.js';

describe('TimelineReader', () => {
  it('rejects malformed or node-less timeline data', () => {
    expect(parseTimelineData('{not json}')).toBeUndefined();
    expect(parseTimelineData(JSON.stringify({ runId: 'run-1' }))).toBeUndefined();
  });

  it('summarizes timeline nodes, screenshots, and the first visible failure', () => {
    const timeline = parseTimelineData(JSON.stringify({
      version: 1,
      runId: 'run-1',
      testName: 'checkout',
      mode: 'test',
      status: 'failed',
      startedAt: '2026-08-07T00:00:00.000Z',
      nodes: [
        { id: 'page-1', kind: 'page', title: 'Checkout', status: 'passed', startedAt: 'x' },
        {
          id: 'step-1',
          kind: 'step',
          title: 'Submit',
          status: 'failed',
          startedAt: 'x',
          artifacts: [{ kind: 'screenshot', path: 'artifacts/screenshots/step-1.png' }],
        },
      ],
      agentVisibleFailures: [{
        code: 'assertion_failed',
        title: 'Submit',
        message: 'Button remained disabled',
        timelineNodeId: 'step-1',
        recoveryHints: [],
      }],
    }));

    expect(timeline).toBeDefined();
    expect(summarizeTimeline(timeline!)).toEqual({
      mode: 'test',
      nodeCount: 2,
      pages: 1,
      stepsPassed: 0,
      stepsFailed: 1,
      screenshots: 1,
      firstFailure: {
        code: 'assertion_failed',
        title: 'Submit',
        message: 'Button remained disabled',
        timelineNodeId: 'step-1',
        recoveryHints: [],
      },
    });
  });
});
