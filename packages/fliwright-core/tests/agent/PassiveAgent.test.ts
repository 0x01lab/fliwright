import { describe, expect, it } from 'vitest';
import {
  AiRuntime,
  MockAiAdapter,
  PassiveAgent,
  TimelineRecorder,
  type AgentVisibleFailure,
} from '../../src/index.js';

const failure: AgentVisibleFailure = {
  code: 'assertion_failed',
  title: 'Next button enabled',
  message: 'enabled=false',
  timelineNodeId: 'assertion-1',
  recoveryHints: [{ kind: 'observe', description: 'Inspect current screen.' }],
};

describe('PassiveAgent', () => {
  it('does not diagnose when passive mode is disabled', async () => {
    const runtime = new AiRuntime({
      adapter: new MockAiAdapter([new Error('should not be called')]),
    });
    const agent = new PassiveAgent({ aiRuntime: runtime, passive: false });

    await expect(agent.diagnose(failure)).resolves.toBeNull();
  });

  it('records passive diagnosis as an ai-call node', async () => {
    const recorder = new TimelineRecorder({ runId: 'run-1', testName: 'diagnosis test' });
    const runtime = new AiRuntime({
      adapter: new MockAiAdapter([{
        text: JSON.stringify({
          summary: 'Next is disabled',
          rootCause: 'Form validation did not pass',
          suggestedActions: ['Inspect field validation messages'],
          confidence: 0.8,
        }),
        json: {
          summary: 'Next is disabled',
          rootCause: 'Form validation did not pass',
          suggestedActions: ['Inspect field validation messages'],
          confidence: 0.8,
        },
      }]),
    });
    const agent = new PassiveAgent({ aiRuntime: runtime, recorder, passive: true });

    const diagnosis = await agent.diagnose(failure, {
      allowedTools: ['fliwright_timeline_get'],
    });

    expect(diagnosis?.summary).toBe('Next is disabled');
    expect(recorder.toJSON().nodes[0]).toMatchObject({
      kind: 'ai-call',
      title: 'Diagnose: Next button enabled',
      status: 'passed',
      metadata: {
        mode: 'passive-diagnosis',
        failureCode: 'assertion_failed',
      },
    });
  });
});
