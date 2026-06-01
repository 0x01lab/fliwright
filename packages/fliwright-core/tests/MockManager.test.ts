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

  it('listRoutes() retrieves registered routes from Dart', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.listRoutes': {
        routes: [
          { id: 'r1', method: 'GET', path: '/api/users' },
          { id: 'r2', method: 'POST', path: '/api/items' },
        ],
      },
    });
    const mock = new MockManager(sendRequest);
    const routes = await mock.listRoutes();

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.listRoutes', {});
    expect(routes).toHaveLength(2);
    expect(routes[0].id).toBe('r1');
    expect(routes[1].path).toBe('/api/items');
  });

  it('clearCalls() sends clearCalls to Dart', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.clearCalls': { cleared: 5 },
    });
    const mock = new MockManager(sendRequest);
    await mock.clearCalls();

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.clearCalls', {});
  });

  it('loadRules() loads rules and applies them via route()', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': { success: true, id: 'route_1' },
    });
    const mock = new MockManager(sendRequest);

    const { MockRuleStore } = await import('../src/MockRuleStore.js');
    const store = new MockRuleStore();
    vi.spyOn(store, 'loadFromDirectory').mockResolvedValue(undefined);
    vi.spyOn(store, 'listEndpoints').mockReturnValue([
      { endpoint: '/api/test', method: 'GET', rules: ['success'], activeRule: 'success' },
    ]);
    vi.spyOn(store, 'getActiveResponse').mockReturnValue({ status: 200, body: { ok: true } });

    mock['_ruleStore'] = store;

    await mock.loadRules('/mocks');

    expect(store.loadFromDirectory).toHaveBeenCalledWith('/mocks');
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.addRoute', {
      route: expect.any(String),
    });
    const call = sendRequest.mock.calls[0][1] as { route: string };
    const parsed = JSON.parse(call.route);
    expect(parsed.path).toBe('/api/test');
    expect(parsed.method).toBe('GET');
    expect(parsed.response.status).toBe(200);
    expect(parsed.response.body).toEqual({ ok: true });
  });

  it('listRules() returns endpoints from ruleStore', async () => {
    const sendRequest = createMockSendRequest({});
    const mock = new MockManager(sendRequest);

    const { MockRuleStore } = await import('../src/MockRuleStore.js');
    const store = new MockRuleStore();
    vi.spyOn(store, 'listEndpoints').mockReturnValue([
      { endpoint: '/api/a', method: 'GET', rules: ['success', 'error'], activeRule: 'success' },
      { endpoint: '/api/b', method: 'POST', rules: ['ok'], activeRule: 'ok' },
    ]);

    mock['_ruleStore'] = store;

    const rules = mock.listRules();
    expect(rules).toHaveLength(2);
    expect(rules[0].endpoint).toBe('/api/a');
    expect(rules[0].rules).toEqual(['success', 'error']);
    expect(rules[1].activeRule).toBe('ok');
  });

  it('switchRule() switches rule and applies via route()', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': { success: true, id: 'route_1' },
    });
    const mock = new MockManager(sendRequest);

    const { MockRuleStore } = await import('../src/MockRuleStore.js');
    const store = new MockRuleStore();
    vi.spyOn(store, 'switchRule').mockReturnValue({ status: 500, body: { error: 'fail' } });
    vi.spyOn(store, 'getActiveResponse').mockReturnValue({ status: 500, body: { error: 'fail' } });
    vi.spyOn(store, 'listEndpoints').mockReturnValue([
      { endpoint: '/api/test', method: 'GET', rules: ['success', 'error'], activeRule: 'error' },
    ]);

    mock['_ruleStore'] = store;

    await mock.switchRule('/api/test', 'error');

    expect(store.switchRule).toHaveBeenCalledWith('/api/test', 'error');
    const call = sendRequest.mock.calls[0][1] as { route: string };
    const parsed = JSON.parse(call.route);
    expect(parsed.path).toBe('/api/test');
    expect(parsed.response.status).toBe(500);
    expect(parsed.response.body).toEqual({ error: 'fail' });
  });

  it('listRules() returns empty array when no rules loaded', () => {
    const sendRequest = createMockSendRequest({});
    const mock = new MockManager(sendRequest);

    const rules = mock.listRules();
    expect(rules).toEqual([]);
  });
});
