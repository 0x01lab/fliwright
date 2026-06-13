import { beforeEach, describe, it, expect, vi } from 'vitest';
import { MockManager } from '../src/MockManager.js';
import { MockRuleStore } from '../src/MockRuleStore.js';

function createMockSendRequest(responses: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation((method: string) => {
    if (method in responses) return Promise.resolve(responses[method]);
    return Promise.reject(new Error(`No mock response for ${method}`));
  });
}

describe('MockManager', () => {
  beforeEach(() => {
    delete process.env.FLIWRIGHT_MOCK_CONTROLLER_URL;
  });

  it('route() registers a tool-side route', async () => {
    const mock = new MockManager(createMockSendRequest());
    await mock.route('/api/login', { method: 'POST', status: 200, body: { token: 'xxx' } });

    expect(await mock.listRoutes()).toEqual([
      expect.objectContaining({ method: 'POST', path: '/api/login' }),
    ]);
  });

  it('removeRoute() and clear() mutate tool-side routes', async () => {
    const mock = new MockManager(createMockSendRequest());
    await mock.route('/api/a', { status: 200 });
    await mock.route('/api/b', { status: 200 });

    await mock.removeRoute('/api/a');
    expect(await mock.listRoutes()).toEqual([
      expect.objectContaining({ path: '/api/b' }),
    ]);

    await mock.clear();
    expect(await mock.listRoutes()).toEqual([]);
  });

  it('removeRoute() can remove only one method for a path', async () => {
    const mock = new MockManager(createMockSendRequest());
    await mock.route('/api/user', { method: 'GET', status: 200 });
    await mock.route('/api/user', { method: 'POST', status: 201 });

    await mock.removeRoute('/api/user', 'GET');

    expect(await mock.listRoutes()).toEqual([
      expect.objectContaining({ method: 'POST', path: '/api/user' }),
    ]);
  });

  it('setPassthrough() controls unmatched behavior and getCalls() reads tool-side calls', async () => {
    const mock = new MockManager(createMockSendRequest());
    await mock.setPassthrough(false);

    mock['_server'].handleMockRequest({
      method: 'GET',
      url: 'https://dev.ex.io/api/missing',
      path: '/api/missing',
    });

    const calls = await mock.getCalls('/api/missing');
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/api/missing');

    await mock.clearCalls();
    expect(await mock.getCalls()).toEqual([]);
  });

  it('loadRules() loads rules and applies active responses to tool server', async () => {
    const mock = new MockManager(createMockSendRequest());
    const store = new MockRuleStore();
    vi.spyOn(store, 'loadFromDirectory').mockResolvedValue(undefined);
    vi.spyOn(store, 'listEndpoints').mockReturnValue([
      { endpoint: '/api/test', method: 'GET', rules: ['success'], activeRule: 'success' },
    ]);
    vi.spyOn(store, 'getActiveResponse').mockReturnValue({ status: 200, body: { ok: true } });
    mock['_server'].ruleStore.loadFromDirectory = store.loadFromDirectory.bind(store);
    mock['_server'].ruleStore.listEndpoints = store.listEndpoints.bind(store);
    mock['_server'].ruleStore.getActiveResponse = store.getActiveResponse.bind(store);

    await mock.loadRules('/mocks');

    expect(store.loadFromDirectory).toHaveBeenCalledWith('/mocks');
    expect(await mock.listRoutes()).toEqual([
      expect.objectContaining({ method: 'GET', path: '/api/test' }),
    ]);
  });

  it('switchRule() updates the active tool-side response', async () => {
    const mock = new MockManager(createMockSendRequest());
    const store = mock['_server'].ruleStore as any;
    store.entries.set('GET /api/test', {
      endpoint: '/api/test',
      method: 'GET',
      activeRule: 'success',
      rules: new Map([
        ['success', { name: 'success', status: 200, body: { ok: true } }],
        ['error', { name: 'error', status: 500, body: { fail: true } }],
      ]),
    });

    await mock.switchRule('/api/test', 'error');
    const result = mock['_server'].handleMockRequest({
      method: 'GET',
      url: 'https://dev.ex.io/api/test',
      path: '/api/test',
    });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ fail: true });
  });

  it('switchRule() forwards the selected rule to the Flutter rule store', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': { success: true },
    });
    const mock = new MockManager(sendRequest);
    mock['_server'].ruleStore['entries'].set('GET /api/test', {
      endpoint: '/api/test',
      method: 'GET',
      activeRule: 'success',
      rules: new Map([
        ['success', { name: 'success', status: 200, body: { ok: true } }],
        ['error', { name: 'error', status: 500, body: { fail: true } }],
      ]),
    });
    await mock.route('/api/test', { method: 'GET', status: 200, body: { ok: true } });

    await mock.switchRule('/api/test', 'error', 'GET');

    expect(sendRequest).toHaveBeenLastCalledWith('ext.fliwright.mock.addRoute', {
      route: JSON.stringify({
        path: '/api/test',
        method: 'GET',
        response: {
          status: 500,
          headers: undefined,
          body: { fail: true },
          delay: undefined,
        },
      }),
    });
  });

  it('route() sends complete route data to the Flutter rule store', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': { success: true },
    });
    const mock = new MockManager(sendRequest);

    await mock.route('/api/test', {
      method: 'POST',
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true },
    });

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.addRoute', {
      route: JSON.stringify({
        path: '/api/test',
        method: 'POST',
        response: {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
          body: { ok: true },
          delay: undefined,
        },
      }),
    });
  });

  it('routeFlutter() registers a local mirror and fails on Flutter errors', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': { error: 'Invalid route JSON: bad payload' },
    });
    const mock = new MockManager(sendRequest);

    await expect(mock.routeFlutter('/api/test', { method: 'POST', status: 201 })).rejects.toThrow(
      'Flutter mock route registration failed: Invalid route JSON: bad payload',
    );

    expect(await mock.listRoutes()).toEqual([
      expect.objectContaining({ method: 'POST', path: '/api/test' }),
    ]);
  });

  it('routeFlutter() detects wrapped Flutter extension errors', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': {
        result: JSON.stringify({ error: 'Missing parameter: route' }),
      },
    });
    const mock = new MockManager(sendRequest);

    await expect(mock.routeFlutter('/api/test', { method: 'GET', status: 200 })).rejects.toThrow(
      'Flutter mock route registration failed: Missing parameter: route',
    );
  });

  it('routeFlutter() detects VM service extension response errors', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': vmExtensionResult({ error: 'Missing parameter: route' }),
    });
    const mock = new MockManager(sendRequest);

    await expect(mock.routeFlutter('/api/test', { method: 'GET', status: 200 })).rejects.toThrow(
      'Flutter mock route registration failed: Missing parameter: route',
    );
  });

  it('routeFlutter() marks Flutter store as authoritative after success', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': { success: true },
      'ext.fliwright.mock.listRoutes': {
        routes: [{ id: 'flutter-route', method: 'GET', path: '/api/test' }],
      },
    });
    const mock = new MockManager(sendRequest);

    await mock.routeFlutter('/api/test', { method: 'GET', status: 200 });

    expect(await mock.listRoutes()).toEqual([
      { id: 'flutter-route', method: 'GET', path: '/api/test' },
    ]);
  });

  it('listRoutes() unwraps VM service extension responses', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': vmExtensionResult({ success: true }),
      'ext.fliwright.mock.listRoutes': vmExtensionResult({
        routes: [{ id: 'flutter-route', method: 'POST', path: '/api/v1/user/info' }],
      }),
    });
    const mock = new MockManager(sendRequest);

    await mock.routeFlutter('/api/v1/user/info', { method: 'POST', status: 200 });

    expect(await mock.listRoutes()).toEqual([
      { id: 'flutter-route', method: 'POST', path: '/api/v1/user/info' },
    ]);
  });

  it('listFlutterRoutes() reads Flutter routes even before local Flutter mode is active', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.listRoutes': vmExtensionResult({
        routes: [{ id: 'flutter-route', method: 'GET', path: '/api/from-flutter' }],
      }),
    });
    const mock = new MockManager(sendRequest);

    expect(await mock.listFlutterRoutes()).toEqual([
      { id: 'flutter-route', method: 'GET', path: '/api/from-flutter' },
    ]);
  });

  it('switchRule() targets the requested method for shared endpoint paths', async () => {
    const mock = new MockManager(createMockSendRequest());
    const store = mock['_server'].ruleStore as any;
    store.entries.set('GET /api/user', {
      endpoint: '/api/user',
      method: 'GET',
      activeRule: 'success',
      rules: new Map([
        ['success', { name: 'success', status: 200, body: { method: 'GET' } }],
        ['error', { name: 'error', status: 500, body: { fail: 'get' } }],
      ]),
    });
    store.entries.set('POST /api/user', {
      endpoint: '/api/user',
      method: 'POST',
      activeRule: 'success',
      rules: new Map([
        ['success', { name: 'success', status: 201, body: { method: 'POST' } }],
        ['error', { name: 'error', status: 422, body: { fail: 'post' } }],
      ]),
    });
    await mock.route('/api/user', { method: 'GET', status: 200, body: { method: 'GET' } });
    await mock.route('/api/user', { method: 'POST', status: 201, body: { method: 'POST' } });

    await mock.switchRule('/api/user', 'error', 'POST');

    const getResult = mock['_server'].handleMockRequest({
      method: 'GET',
      url: 'https://dev.ex.io/api/user',
      path: '/api/user',
    });
    const postResult = mock['_server'].handleMockRequest({
      method: 'POST',
      url: 'https://dev.ex.io/api/user',
      path: '/api/user',
    });

    expect(getResult.status).toBe(200);
    expect(getResult.body).toEqual({ method: 'GET' });
    expect(postResult.status).toBe(422);
    expect(postResult.body).toEqual({ fail: 'post' });
  });

  it('configureFlutterController() syncs passthrough without setting a controller URL', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.setPassthrough': { passthrough: true },
    });
    const mock = new MockManager(sendRequest);

    await mock.configureFlutterController('http://127.0.0.1:18080');

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.setPassthrough', {
      enabled: 'true',
    });
    expect(sendRequest).not.toHaveBeenCalledWith('ext.fliwright.mock.setController', expect.anything());
  });

  it('configureFlutterController() syncs existing tool-side routes to Flutter', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.setPassthrough': { passthrough: true },
      'ext.fliwright.mock.addRoute': { success: true },
    });
    const mock = new MockManager(sendRequest);
    mock['_server'].route('/api/users', { method: 'GET', status: 200, body: [] });

    await mock.configureFlutterController('http://127.0.0.1:18080');

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.setPassthrough', {
      enabled: 'true',
    });
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.addRoute', {
      route: JSON.stringify({
        path: '/api/users',
        method: 'GET',
        response: {
          status: 200,
          headers: undefined,
          body: [],
          delay: undefined,
        },
      }),
    });
  });
});

function vmExtensionResult(response: unknown) {
  return {
    type: '_ExtensionType',
    response: JSON.stringify(response),
  };
}
