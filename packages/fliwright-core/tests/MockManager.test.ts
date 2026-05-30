import { describe, it, expect, vi } from 'vitest';
import { MockManager } from '../src/MockManager.js';

function createMockSendRequest(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
    if (responses[method] !== undefined) return Promise.resolve(responses[method]);
    return Promise.resolve({});
  });
}

describe('MockManager', () => {
  it('route() sends addRoute to Dart via VM Service', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': { success: true, id: 'route_1' },
    });
    const mock = new MockManager(sendRequest);
    await mock.route('/api/login', { status: 200, body: { token: 'xxx' } });

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.addRoute', {
      route: expect.any(String),
    });
    const call = sendRequest.mock.calls[0][1] as { route: string };
    const parsed = JSON.parse(call.route);
    expect(parsed.path).toBe('/api/login');
    expect(parsed.response.status).toBe(200);
    expect(parsed.response.body).toEqual({ token: 'xxx' });
  });

  it('route() accepts method parameter', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': { success: true, id: 'route_2' },
    });
    const mock = new MockManager(sendRequest);
    await mock.route('/api/users', { method: 'GET', body: [] });

    const call = sendRequest.mock.calls[0][1] as { route: string };
    const parsed = JSON.parse(call.route);
    expect(parsed.method).toBe('GET');
  });

  it('route() accepts delay parameter', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': { success: true, id: 'route_3' },
    });
    const mock = new MockManager(sendRequest);
    await mock.route('/api/slow', { body: { ok: true }, delay: 2000 });

    const call = sendRequest.mock.calls[0][1] as { route: string };
    const parsed = JSON.parse(call.route);
    expect(parsed.response.delay).toBe(2000);
  });

  it('removeRoute() sends removeRoute to Dart', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.removeRoute': { success: true, removed: true },
    });
    const mock = new MockManager(sendRequest);
    await mock.removeRoute('/api/login');

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.removeRoute', {
      path: '/api/login',
    });
  });

  it('clear() sends clearRoutes to Dart', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.clearRoutes': { success: true },
    });
    const mock = new MockManager(sendRequest);
    await mock.clear();

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.clearRoutes', {});
  });

  it('setPassthrough() sends setPassthrough to Dart', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.setPassthrough': { success: true, passthrough: true },
    });
    const mock = new MockManager(sendRequest);
    await mock.setPassthrough(true);

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.setPassthrough', {
      enabled: 'true',
    });
  });

  it('getCalls() retrieves recorded calls from Dart', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.getCalls': {
        calls: [
          { method: 'POST', path: '/api/login', headers: {}, body: '', timestamp: '2026-05-29T00:00:00Z' },
        ],
      },
    });
    const mock = new MockManager(sendRequest);
    const calls = await mock.getCalls('/api/login');

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.getCalls', {
      path: '/api/login',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].path).toBe('/api/login');
  });

  it('getCalls() without filter returns all calls', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.getCalls': { calls: [] },
    });
    const mock = new MockManager(sendRequest);
    await mock.getCalls();

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.getCalls', {});
  });
});
