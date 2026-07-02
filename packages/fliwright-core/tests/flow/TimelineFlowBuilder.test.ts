import { describe, expect, it } from 'vitest';
import { buildFlowFromTimeline } from '../../src/flow/TimelineFlowBuilder.js';
import type { TimelineData } from '../../src/timeline/types.js';

describe('buildFlowFromTimeline', () => {
  it('creates a linear business flow from timeline nodes', () => {
    const timeline: TimelineData = {
      version: 1,
      runId: 'run-1',
      testName: 'checkout test',
      mode: 'test',
      status: 'passed',
      startedAt: '2026-06-30T00:00:00.000Z',
      nodes: [
        {
          id: 'page-1',
          kind: 'page',
          title: 'Checkout',
          status: 'passed',
          startedAt: '2026-06-30T00:00:01.000Z',
          route: '/checkout',
          artifacts: [{
            kind: 'screenshot',
            path: '.fliwright/runs/run-1/checkout.png',
            mimeType: 'image/png',
          }],
        },
        {
          id: 'action-2',
          parentId: 'page-1',
          kind: 'action',
          title: 'Tap Pay',
          status: 'passed',
          startedAt: '2026-06-30T00:00:02.000Z',
          metadata: { selector: 'text=Pay' },
          codeRef: { file: 'tests/checkout.test.ts', line: 12 },
        },
        {
          id: 'branch-3',
          parentId: 'page-1',
          kind: 'branch',
          title: 'Payment result',
          status: 'passed',
          startedAt: '2026-06-30T00:00:03.000Z',
          metadata: { when: 'payment.success == true' },
        },
      ],
    };

    const flow = buildFlowFromTimeline({ timeline, targetFile: 'tests/checkout.test.ts' }, {
      createdAt: '2026-06-30T01:00:00.000Z',
    });

    expect(flow).toMatchObject({
      version: 1,
      id: 'flow-run-1',
      title: 'checkout test',
      source: {
        kind: 'timeline',
        runId: 'run-1',
        testName: 'checkout test',
        targetFile: 'tests/checkout.test.ts',
      },
      metadata: {
        timelineStatus: 'passed',
        timelineMode: 'test',
        timelineNodeCount: 3,
        includedNodeCount: 3,
      },
    });
    expect(flow.nodes).toEqual([
      expect.objectContaining({
        id: 'timeline-page-1',
        type: 'screen',
        title: 'Checkout',
        route: '/checkout',
        screenshot: {
          source: 'runtime',
          path: '.fliwright/runs/run-1/checkout.png',
          format: 'png',
        },
      }),
      expect.objectContaining({
        id: 'timeline-action-2',
        type: 'action',
        selector: 'text=Pay',
        metadata: expect.objectContaining({
          timelineParentId: 'page-1',
          codeRef: { file: 'tests/checkout.test.ts', line: 12 },
        }),
      }),
      expect.objectContaining({
        id: 'timeline-branch-3',
        type: 'decision',
        decisionRules: [{
          id: 'branch-3-rule',
          when: 'payment.success == true',
        }],
      }),
    ]);
    expect(flow.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['timeline-page-1', 'timeline-action-2'],
      ['timeline-action-2', 'timeline-branch-3'],
    ]);
  });

  it('omits failure nodes by default and can include them as notes', () => {
    const timeline: TimelineData = {
      version: 1,
      runId: 'run-fail',
      testName: 'failing test',
      mode: 'test',
      status: 'failed',
      startedAt: '2026-06-30T00:00:00.000Z',
      nodes: [
        {
          id: 'step-1',
          kind: 'step',
          title: 'Submit',
          status: 'failed',
          startedAt: '2026-06-30T00:00:01.000Z',
        },
        {
          id: 'failure-2',
          kind: 'failure',
          title: 'Selector failure',
          status: 'failed',
          startedAt: '2026-06-30T00:00:02.000Z',
          error: {
            code: 'selector_not_found',
            title: 'Selector not found',
            message: 'Could not find text=Submit',
            recoveryHints: [],
          },
        },
      ],
    };

    expect(buildFlowFromTimeline({ timeline }).nodes.map((node) => node.id)).toEqual(['timeline-step-1']);

    const withFailures = buildFlowFromTimeline({ timeline }, { includeFailures: true });
    expect(withFailures.nodes[1]).toEqual(expect.objectContaining({
      id: 'timeline-failure-2',
      type: 'note',
      notes: 'Could not find text=Submit',
    }));
  });
});
