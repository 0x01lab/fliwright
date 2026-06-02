import { beforeEach, describe, it, expect, vi } from 'vitest';
import { MockManager } from '../src/MockManager.js';
import { MockRuleStore } from '../src/MockRuleStore.js';

function createMockSendRequest(responses: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation((method: string) => Promise.resolve(responses[method] ?? {}));
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
    store.entries.set('/api/test', {
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

  it('configureFlutterController() sends provided controller URL to Flutter', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.setController': { controllerUrl: 'ok' },
    });
    const mock = new MockManager(sendRequest);

    await mock.configureFlutterController('http://127.0.0.1:18080');

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.setController', {
      url: 'http://127.0.0.1:18080',
    });
  });
});
