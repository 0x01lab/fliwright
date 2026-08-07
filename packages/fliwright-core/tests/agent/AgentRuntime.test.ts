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
      provider: 'mock',
      artifactsDir: '/tmp/fliwright-ai-artifacts',
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
      metadata: {
        mode: 'active',
        provider: 'mock',
        responseFormat: 'json',
        hasSchema: true,
      },
    });
    expect(recorder.toJSON().nodes[0]?.metadata?.artifactsDir)
      .toMatch(/^\/tmp\/fliwright-ai-artifacts\//);
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

  it('records when generate returns its configured fallback', async () => {
    const recorder = new TimelineRecorder({ runId: 'run-1', testName: 'agent test' });
    const aiRuntime = new AiRuntime({
      adapter: new MockAiAdapter([new Error('provider down')]),
    });
    const agent = new AgentRuntime({ aiRuntime, recorder });

    await expect(agent.generate('Generate fallback data', { fallback: { email: 'fallback@example.com' } }))
      .resolves.toEqual({ email: 'fallback@example.com' });

    expect(recorder.toJSON().nodes[0]?.metadata).toMatchObject({
      hasFallback: true,
      fallbackUsed: true,
    });
  });

  it('masks nested credential metadata', async () => {
    const recorder = new TimelineRecorder({ runId: 'run-1', testName: 'agent test' });
    const aiRuntime = new AiRuntime({
      adapter: new MockAiAdapter([{ text: 'ok' }]),
    });
    const agent = new AgentRuntime({ aiRuntime, recorder });

    await agent.ask('Fetch account details', {
      metadata: {
        apiToken: 'token-value',
        request: { authorization: 'Bearer token-value' },
      },
    });

    expect(recorder.toJSON().nodes[0]?.metadata).toMatchObject({
      metadata: {
        apiToken: '<masked>',
        request: { authorization: '<masked>' },
      },
    });
  });
});
