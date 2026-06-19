import { describe, expect, it } from 'vitest';
import {
  AgentRuntime,
  AiRuntime,
  FliwrightAgentError,
  MockAiAdapter,
  TimelineRecorder,
} from '../../src/index.js';

describe('AgentRuntime', () => {
  it('records active generate calls', async () => {
    const recorder = new TimelineRecorder({ runId: 'run-1', testName: 'agent test' });
    const aiRuntime = new AiRuntime({
      adapter: new MockAiAdapter([{ text: '{"email":"ada@example.com"}', json: { email: 'ada@example.com' } }]),
    });
    const agent = new AgentRuntime({ aiRuntime, recorder });

    const value = await agent.generate<{ email: string }>('Generate register payload', {
      schema: {
        type: 'object',
        properties: { email: { type: 'string' } },
        required: ['email'],
      },
    });

    expect(value.email).toBe('ada@example.com');
    expect(recorder.toJSON().nodes[0]).toMatchObject({
      kind: 'ai-call',
      status: 'passed',
      metadata: { mode: 'active', responseFormat: 'json', hasSchema: true },
    });
  });

  it('turns AI failures into agent visible failures', async () => {
    const recorder = new TimelineRecorder({ runId: 'run-1', testName: 'agent test' });
    const aiRuntime = new AiRuntime({
      adapter: new MockAiAdapter([new Error('provider down')]),
    });
    const agent = new AgentRuntime({ aiRuntime, recorder });

    await expect(agent.ask('Ask provider')).rejects.toBeInstanceOf(FliwrightAgentError);

    expect(recorder.toJSON().agentVisibleFailures?.[0]).toMatchObject({
      code: 'ai_call_failed',
      title: 'Ask provider',
    });
  });
});
