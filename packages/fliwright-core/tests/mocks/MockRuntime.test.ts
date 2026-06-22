import { describe, expect, it, vi } from 'vitest';
import { MockManager, MockRuntime, TimelineRecorder } from '../../src/index.js';

function createMockSendRequest(responses: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation((method: string) => {
    if (method in responses) return Promise.resolve(responses[method]);
    return Promise.reject(new Error(`No mock response for ${method}`));
  });
}

describe('MockRuntime', () => {
  it('records timeline nodes for mock operations', async () => {
    const recorder = new TimelineRecorder({ runId: 'run-1', testName: 'mock test' });
    const manager = new MockManager(createMockSendRequest());
    const mock = new MockRuntime(manager, recorder);

    await mock.route('/api/register', { method: 'POST', status: 200, body: { ok: true } });
    await mock.clearCalls();

    expect(recorder.toJSON().nodes.map((node) => [node.kind, node.status, node.metadata?.operation])).toEqual([
      ['mock', 'passed', 'route'],
      ['mock', 'passed', 'clearCalls'],
    ]);
  });

  it('groups rules setup under a step node', async () => {
    const recorder = new TimelineRecorder({ runId: 'run-1', testName: 'mock test' });
    const manager = new MockManager(createMockSendRequest());
    const mock = new MockRuntime(manager, recorder);

    await mock.rules('Use success API', async () => {
      await mock.route('/api/register', { method: 'POST', status: 200 });
    });

    const data = recorder.toJSON();
    expect(data.nodes[0]).toMatchObject({ kind: 'step', title: 'Use success API' });
    expect(data.nodes[1]).toMatchObject({ kind: 'mock', parentId: data.nodes[0].id });
  });

  it('findCalls filters by method path and body', async () => {
    const manager = new MockManager(createMockSendRequest());
    const mock = new MockRuntime(manager);

    await manager.route('/api/register', { method: 'POST', status: 200 });
    manager['_server'].handleMockRequest({
      method: 'POST',
      path: '/api/register',
      url: 'https://dev.ex.io/api/register',
      body: JSON.stringify({ email: 'ada@example.com' }),
    });

    await expect(mock.findCalls({
      method: 'POST',
      path: '/api/register',
      body: { email: 'ada@example.com' },
    })).resolves.toHaveLength(1);
  });

  it('waitForCall resolves when a matching call appears', async () => {
    const manager = new MockManager(createMockSendRequest());
    const mock = new MockRuntime(manager);
    await manager.route('/api/onboard-info', { method: 'GET', status: 200 });

    const waitPromise = mock.waitForCall({
      method: 'GET',
      path: '/api/onboard-info',
    }, { timeout: 500, interval: 10 });

    setTimeout(() => {
      manager['_server'].handleMockRequest({
        method: 'GET',
        path: '/api/onboard-info',
        url: 'https://dev.ex.io/api/onboard-info',
      });
    }, 20);

    await expect(waitPromise).resolves.toHaveLength(1);
  });

  it('waitForCall rejects with recorded call diagnostics on timeout', async () => {
    const manager = new MockManager(createMockSendRequest());
    const mock = new MockRuntime(manager);
    await manager.route('/api/other', { method: 'POST', status: 200 });
    manager['_server'].handleMockRequest({
      method: 'POST',
      path: '/api/other',
      url: 'https://dev.ex.io/api/other',
    });

    await expect(mock.waitForCall('/api/missing', { timeout: 30, interval: 10 })).rejects.toThrow('POST /api/other');
  });
});
