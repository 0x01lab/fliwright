import { describe, expect, it } from 'vitest';
import { FliwrightAgentError } from '../../src/agent/FliwrightAgentError.js';
import { TimelineNodeLifecycle } from '../../src/timeline/TimelineNodeLifecycle.js';
import { TimelineRecorder } from '../../src/timeline/TimelineRecorder.js';

describe('TimelineNodeLifecycle', () => {
  it('completes a node and wraps failures through one lifecycle', async () => {
    const recorder = new TimelineRecorder({ runId: 'run-1', testName: 'lifecycle test' });
    const lifecycle = new TimelineNodeLifecycle(recorder);

    await expect(lifecycle.run({
      kind: 'step',
      title: 'Open Markets',
      body: () => 'opened',
      onFailure: () => ({
        failure: { code: 'step_failed', title: 'Open Markets', message: 'unreachable', recoveryHints: [] },
      }),
    })).resolves.toBe('opened');

    const result = lifecycle.run({
      kind: 'step',
      title: 'Load Markets',
      body: async () => {
        throw new Error('route unavailable');
      },
      onFailure: async (error, timelineNodeId) => ({
        failure: {
          code: 'step_failed' as const,
          title: 'Load Markets',
          message: error instanceof Error ? error.message : String(error),
          timelineNodeId,
          recoveryHints: [],
        },
        artifacts: [{ kind: 'diagnostics', path: 'artifacts/diagnostics/step-2.json' }],
      }),
    });

    await expect(result).rejects.toBeInstanceOf(FliwrightAgentError);

    expect(recorder.toJSON().nodes[0]).toMatchObject({
      kind: 'step',
      status: 'passed',
    });
    expect(recorder.toJSON().nodes[1]).toMatchObject({
      kind: 'step',
      status: 'failed',
      artifacts: [{ kind: 'diagnostics' }],
      error: { code: 'step_failed', timelineNodeId: 'step-2' },
    });
  });
});
