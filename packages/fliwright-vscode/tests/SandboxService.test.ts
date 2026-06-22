import { describe, expect, it, vi } from 'vitest';
import { Uri } from 'vscode';
import { SandboxService } from '../src/sandbox/SandboxService.js';
import type { MockDiscoveryResult, MockRuleEntry } from '../src/types.js';

describe('SandboxService', () => {
  it('applies one selected mock rule through driver.mock.routeFlutter', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const sendRequest = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'ext.fliwright.mock.debugState') {
        return {
          mode: 'http',
          serverPort: 12345,
          routes: [{ method: 'GET', path: '/v1/token' }],
        };
      }
      return { routes: [{ method: 'GET', path: '/v1/token' }] };
    });
    const service = new SandboxService();
    const entry = mockRule('success');

    const applied = await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, entry);

    expect(routeFlutter).toHaveBeenCalledWith('/v1/token', {
      id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:success',
      method: 'GET',
      status: 200,
      delay: undefined,
      headers: undefined,
      body: { ok: true },
    });
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.debugState', {});
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.listRoutes', {});
    expect(applied.ruleName).toBe('success');
    expect(service.isApplied(entry)).toBeDefined();
  });

  it('syncs active rules from Flutter route ids without pushing local rules', async () => {
    const service = new SandboxService();
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      {
        id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:error',
        method: 'GET',
        path: '/v1/token',
      },
    ]);
    const routeFlutter = vi.fn();

    const result = await service.syncFromFlutter(
      { mock: { listFlutterRoutes, routeFlutter } } as any,
      discovery(),
    );

    expect(result.routes).toHaveLength(1);
    expect(result.applied).toMatchObject([
      {
        endpoint: '/v1/token',
        method: 'GET',
        ruleName: 'error',
      },
    ]);
    expect(service.getAppliedRules()).toHaveLength(1);
    expect(routeFlutter).not.toHaveBeenCalled();
  });

  it('treats Flutter route ids without rule metadata as stale for multi-rule endpoints', async () => {
    const service = new SandboxService();
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      { id: 'flutter-route', method: 'GET', path: '/v1/token' },
    ]);

    const result = await service.syncFromFlutter(
      { mock: { listFlutterRoutes } } as any,
      discovery(),
    );

    expect(result.applied).toHaveLength(0);
    expect(result.unmatched).toMatchObject([
      { id: 'flutter-route', method: 'GET', path: '/v1/token' },
    ]);
  });

  it('adopts Flutter route ids without rule metadata for single-rule endpoints', async () => {
    const service = new SandboxService();
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      { id: 'flutter-route', method: 'GET', path: '/v1/token' },
    ]);
    const result = discovery();
    result.endpoints[0]!.endpointFile.rules = [
      { name: 'success', status: 200 },
    ];

    const sync = await service.syncFromFlutter(
      { mock: { listFlutterRoutes } } as any,
      result,
    );

    expect(sync.applied).toMatchObject([
      {
        endpoint: '/v1/token',
        method: 'GET',
        ruleName: 'success',
      },
    ]);
    expect(sync.unmatched).toHaveLength(0);
  });

  it('rebuilds stale Flutter cache from workspace defaults after mocks and VM are ready', async () => {
    const service = new SandboxService();
    const clearFlutterRoutes = vi.fn().mockResolvedValue(undefined);
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      { id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:deleted-rule', method: 'GET', path: '/v1/token' },
    ]);
    const sendRequest = httpReadySendRequest([{ method: 'GET', path: '/v1/token' }]);
    const stale = vi.fn();

    const result = await service.reconcileFromFlutter(
      { mock: { listFlutterRoutes, clearFlutterRoutes, routeFlutter }, sendRequest } as any,
      discovery(),
      {
        applyDefaultRules: true,
        onStaleRoutes: stale,
      },
    );

    expect(result.rebuilt).toBe(true);
    expect(stale).toHaveBeenCalledOnce();
    expect(clearFlutterRoutes).toHaveBeenCalledOnce();
    expect(result.reconciled).toMatchObject([
      { endpoint: '/v1/token', method: 'GET', ruleName: 'error' },
    ]);
    expect(routeFlutter).toHaveBeenCalledWith('/v1/token', expect.objectContaining({
      id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:error',
    }));
    expect(service.getAppliedRules()).toMatchObject([
      { endpoint: '/v1/token', method: 'GET', ruleName: 'error' },
    ]);
  });

  it('fills missing endpoints while preserving valid Flutter cached routes', async () => {
    const service = new SandboxService();
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      { id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:error', method: 'GET', path: '/v1/token' },
    ]);
    const sendRequest = httpReadySendRequest([
      { method: 'GET', path: '/v1/token' },
      { method: 'POST', path: '/v1/profile' },
    ]);
    const result = discovery();
    result.endpoints.push({
      kind: 'endpoint',
      uri: Uri.file('/tmp/profile.json'),
      indexed: true,
      endpointFile: {
        version: 1,
        name: 'Profile',
        method: 'POST',
        endpoint: '/v1/profile',
        rules: [{ name: 'success', status: 201 }],
      },
    });

    const sync = await service.reconcileFromFlutter(
      { mock: { listFlutterRoutes, routeFlutter }, sendRequest } as any,
      result,
      { applyDefaultRules: true },
    );

    expect(sync.applied).toMatchObject([
      { endpoint: '/v1/token', method: 'GET', ruleName: 'error' },
    ]);
    expect(sync.reconciled).toMatchObject([
      { endpoint: '/v1/profile', method: 'POST', ruleName: 'success' },
    ]);
    expect(routeFlutter).toHaveBeenCalledTimes(1);
    expect(routeFlutter).toHaveBeenCalledWith('/v1/profile', expect.objectContaining({ method: 'POST' }));
    expect(service.getAppliedRules()).toHaveLength(2);
  });

  it('does not activate defaults while reconciling Flutter state by default', async () => {
    const service = new SandboxService();
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const listFlutterRoutes = vi.fn().mockResolvedValue([]);
    const sendRequest = httpReadySendRequest([{ method: 'GET', path: '/v1/token' }]);

    const sync = await service.reconcileFromFlutter(
      { mock: { listFlutterRoutes, routeFlutter }, sendRequest } as any,
      discovery(),
    );

    expect(sync.applied).toHaveLength(0);
    expect(sync.reconciled).toHaveLength(0);
    expect(sync.skipped).toBeGreaterThan(0);
    expect(routeFlutter).not.toHaveBeenCalled();
    expect(service.getAppliedRules()).toHaveLength(0);
  });

  it('does not auto-apply defaults for suppressed endpoints during sync', async () => {
    const service = new SandboxService();
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const listFlutterRoutes = vi.fn().mockResolvedValue([]);
    const sendRequest = httpReadySendRequest([{ method: 'GET', path: '/v1/token' }]);

    const sync = await service.reconcileFromFlutter(
      { mock: { listFlutterRoutes, routeFlutter }, sendRequest } as any,
      discovery(),
      {
        applyDefaultRules: true,
        suppressedEndpoints: [{ method: 'GET', endpoint: '/v1/token' }],
      },
    );

    expect(sync.reconciled).toHaveLength(0);
    expect(sync.skipped).toBeGreaterThan(0);
    expect(routeFlutter).not.toHaveBeenCalled();
    expect(service.getAppliedRules()).toHaveLength(0);
  });

  it('removes suppressed Flutter routes instead of adopting them during sync', async () => {
    const service = new SandboxService();
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const removeFlutterRoute = vi.fn().mockResolvedValue(undefined);
    const listFlutterRoutes = vi.fn()
      .mockResolvedValueOnce([
        {
          id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:success',
          method: 'GET',
          path: '/v1/token',
        },
      ])
      .mockResolvedValueOnce([]);
    const sendRequest = httpReadySendRequest([]);

    const sync = await service.reconcileFromFlutter(
      { mock: { listFlutterRoutes, removeFlutterRoute, routeFlutter }, sendRequest } as any,
      discovery(),
      {
        applyDefaultRules: true,
        suppressedEndpoints: [{ method: 'GET', endpoint: '/v1/token' }],
      },
    );

    expect(removeFlutterRoute).toHaveBeenCalledWith('/v1/token', 'GET');
    expect(routeFlutter).not.toHaveBeenCalled();
    expect(sync.applied).toHaveLength(0);
    expect(service.getAppliedRules()).toHaveLength(0);
  });

  it('adopts VSCode-managed Flutter routes even when they were set outside VS Code', async () => {
    const service = new SandboxService();
    const removeFlutterRoute = vi.fn().mockResolvedValue(undefined);
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      { id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:success', method: 'GET', path: '/v1/token' },
    ]);
    const sendRequest = httpReadySendRequest([{ method: 'GET', path: '/v1/token' }]);

    const sync = await service.reconcileFromFlutter(
      { mock: { listFlutterRoutes, removeFlutterRoute }, sendRequest } as any,
      discovery(),
      { restoreSelections: true, selectedEntries: [] },
    );

    expect(removeFlutterRoute).not.toHaveBeenCalled();
    expect(sync.pruned).toBe(0);
    expect(sync.applied).toMatchObject([
      { endpoint: '/v1/token', method: 'GET', ruleName: 'success' },
    ]);
    expect(service.getAppliedRules()).toMatchObject([
      { endpoint: '/v1/token', method: 'GET', ruleName: 'success' },
    ]);
  });

  it('prunes foreign (non-VSCode) Flutter routes too when the desired state is empty', async () => {
    // Desired-state driven prune: "no active rule in VSCode" must clear the
    // Flutter store completely, including routes without a fliwright-vscode: id
    // (legacy/script-added). This is the behavior the user opted into.
    const service = new SandboxService();
    const removeFlutterRoute = vi.fn().mockResolvedValue(undefined);
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      { id: 'test-script-route', method: 'GET', path: '/v1/token' },
    ]);
    const sendRequest = httpReadySendRequest([{ method: 'GET', path: '/v1/token' }]);
    const result = discovery();
    // Single-rule endpoint so the foreign route is adopted (matched), not treated as stale.
    result.endpoints[0]!.endpointFile.rules = [{ name: 'success', status: 200 }];
    result.endpoints[0]!.defaultRule = undefined;

    const sync = await service.reconcileFromFlutter(
      { mock: { listFlutterRoutes, removeFlutterRoute }, sendRequest } as any,
      result,
      { restoreSelections: true, selectedEntries: [] },
    );

    expect(removeFlutterRoute).toHaveBeenCalledWith('/v1/token', 'GET');
    expect(sync.pruned).toBe(1);
    expect(sync.applied).toEqual([]);
  });

  it('keeps VSCode-managed Flutter routes that match a restored selection', async () => {
    const service = new SandboxService();
    const removeFlutterRoute = vi.fn().mockResolvedValue(undefined);
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      { id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:success', method: 'GET', path: '/v1/token' },
    ]);
    const sendRequest = httpReadySendRequest([{ method: 'GET', path: '/v1/token' }]);
    const selected = mockRule('success');

    const sync = await service.reconcileFromFlutter(
      { mock: { listFlutterRoutes, removeFlutterRoute }, sendRequest } as any,
      discovery(),
      { restoreSelections: true, selectedEntries: [selected] },
    );

    expect(removeFlutterRoute).not.toHaveBeenCalled();
    expect(sync.pruned).toBe(0);
    expect(service.getAppliedRules()).toMatchObject([
      { endpoint: '/v1/token', method: 'GET', ruleName: 'success' },
    ]);
  });

  it('reconciles a restored selection over a different cached Flutter rule', async () => {
    const service = new SandboxService();
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const removeFlutterRoute = vi.fn().mockResolvedValue(undefined);
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      { id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:success', method: 'GET', path: '/v1/token' },
    ]);
    const sendRequest = httpReadySendRequest([{ method: 'GET', path: '/v1/token' }]);
    const selected = mockRule('error');

    const sync = await service.reconcileFromFlutter(
      { mock: { listFlutterRoutes, removeFlutterRoute, routeFlutter }, sendRequest } as any,
      discovery(),
      { selectedEntries: [selected] },
    );

    expect(routeFlutter).toHaveBeenCalledWith('/v1/token', expect.objectContaining({
      id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:error',
      method: 'GET',
    }));
    expect(removeFlutterRoute).not.toHaveBeenCalled();
    expect(sync.applied).toEqual([]);
    expect(sync.reconciled).toMatchObject([
      { endpoint: '/v1/token', method: 'GET', ruleName: 'error' },
    ]);
    expect(service.getAppliedRules()).toMatchObject([
      { endpoint: '/v1/token', method: 'GET', ruleName: 'error' },
    ]);
  });

  it('accepts wrapped VM service extension payloads', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const sendRequest = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'ext.fliwright.mock.debugState') {
        return {
          result: JSON.stringify({
            mode: 'dio',
            interceptorInjected: true,
            routes: [],
          }),
        };
      }
      return {
        result: JSON.stringify({
          routes: [{ method: 'POST', path: '/api/v1/user/info' }],
        }),
      };
    });
    const service = new SandboxService();
    const entry = mockRule('success');
    entry.endpoint = '/api/v1/user/info';
    entry.method = 'POST';

    const applied = await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, entry);

    expect(applied).toMatchObject({
      endpoint: '/api/v1/user/info',
      method: 'POST',
      ruleName: 'success',
    });
  });

  it('keeps only one active rule per method and endpoint', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const sendRequest = httpReadySendRequest([{ method: 'GET', path: '/v1/token' }]);
    const service = new SandboxService();
    const success = mockRule('success');
    const error = mockRule('error');
    error.rule.status = 400;

    await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, success);
    await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, error);

    expect(service.getAppliedRules()).toHaveLength(1);
    expect(service.getAppliedRules()[0]?.ruleName).toBe('error');
    expect(service.isApplied(success)).toBeUndefined();
    expect(service.isApplied(error)).toBeDefined();
  });

  it('routes multiple rules directly through the same driver', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const sendRequest = httpReadySendRequest([
      { method: 'GET', path: '/v1/token' },
      { method: 'GET', path: '/v1/profile' },
    ]);
    const service = new SandboxService();
    const driver = { mock: { routeFlutter }, sendRequest } as any;
    const first = mockRule('success');
    const second = mockRule('error');
    second.endpoint = '/v1/profile';

    await service.applyRule(driver, first);
    await service.applyRule(driver, second);

    expect(routeFlutter).toHaveBeenCalledTimes(2);
  });

  it('stops only the currently active rule for an endpoint', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const sendRequest = httpReadySendRequest([{ method: 'GET', path: '/v1/token' }]);
    const removeFlutterRoute = vi.fn().mockResolvedValue(undefined);
    const listFlutterRoutes = vi.fn().mockResolvedValue([]);
    const service = new SandboxService();
    const success = mockRule('success');
    const error = mockRule('error');

    await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, success);

    await expect(service.stopRule({ mock: { removeFlutterRoute, listFlutterRoutes } } as any, error)).resolves.toBe(false);
    expect(removeFlutterRoute).not.toHaveBeenCalled();
    expect(service.getAppliedRules()).toHaveLength(1);

    await expect(service.stopRule({ mock: { removeFlutterRoute, listFlutterRoutes } } as any, success)).resolves.toBe(true);
    expect(removeFlutterRoute).toHaveBeenCalledWith('/v1/token', 'GET');
    expect(service.getAppliedRules()).toHaveLength(0);
  });

  it('stops an applied rule through the Flutter removeRoute API even before Flutter mode is established', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const removeFlutterRoute = vi.fn().mockResolvedValue(undefined);
    const sendRequest = httpReadySendRequest([{ method: 'GET', path: '/v1/token' }]);
    const service = new SandboxService();
    const success = mockRule('success');

    await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, success);

    await expect(service.stopRule({ mock: { removeFlutterRoute } } as any, success)).resolves.toBe(true);
    expect(removeFlutterRoute).toHaveBeenCalledWith('/v1/token', 'GET');
    expect(service.getAppliedRules()).toHaveLength(0);
  });

  it('does not clear local active state when Flutter still lists the route after stop', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const removeFlutterRoute = vi.fn().mockResolvedValue(undefined);
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      { id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:success', method: 'GET', path: '/v1/token' },
    ]);
    const sendRequest = httpReadySendRequest([{ method: 'GET', path: '/v1/token' }]);
    const service = new SandboxService();
    const success = mockRule('success');

    await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, success);

    await expect(service.stopRule({ mock: { removeFlutterRoute, listFlutterRoutes } } as any, success)).rejects.toThrow(
      'Flutter mock route is still active after stop: GET /v1/token',
    );
    expect(service.getAppliedRules()).toHaveLength(1);
  });

  it('reapplies the same route after stop when addRoute returns a stringified VM service payload', async () => {
    const routeFlutter = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        result: JSON.stringify(vmExtensionResult({ success: true, id: 'reapplied-route' })),
      });
    const removeFlutterRoute = vi.fn().mockResolvedValue(undefined);
    const sendRequest = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'ext.fliwright.mock.debugState') {
        return {
          mode: 'http',
          serverPort: 12345,
          routes: [],
        };
      }
      return { routes: [] };
    });
    const service = new SandboxService();
    const entry = mockRule('success');
    entry.endpoint = '/api/v1/user/info';
    entry.method = 'POST';

    await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, entry);
    await expect(service.stopRule({ mock: { removeFlutterRoute } } as any, entry)).resolves.toBe(true);
    const reapplied = await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, entry);

    expect(removeFlutterRoute).toHaveBeenCalledWith('/api/v1/user/info', 'POST');
    expect(routeFlutter).toHaveBeenCalledTimes(2);
    expect(reapplied).toMatchObject({
      endpoint: '/api/v1/user/info',
      method: 'POST',
      ruleName: 'success',
    });
    expect(service.isApplied(entry)).toBeDefined();
  });

  it('stops a Flutter route even when local active state was not recorded', async () => {
    const removeFlutterRoute = vi.fn().mockResolvedValue(undefined);
    const listFlutterRoutes = vi.fn()
      .mockResolvedValueOnce([
        {
          id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:success',
          method: 'GET',
          path: '/v1/token',
        },
      ])
      .mockResolvedValueOnce([]);
    const service = new SandboxService();

    await expect(service.stopRule({ mock: { removeFlutterRoute, listFlutterRoutes } } as any, mockRule('success')))
      .resolves.toBe(true);

    expect(removeFlutterRoute).toHaveBeenCalledWith('/v1/token', 'GET');
  });

  it('applies index default rules and skips invalid files', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const sendRequest = httpReadySendRequest([{ method: 'GET', path: '/v1/token' }]);
    const service = new SandboxService();

    const result = await service.applyDefaultMocks({ mock: { routeFlutter }, sendRequest } as any, discovery());

    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]?.ruleName).toBe('error');
    expect(result.skipped).toBe(1);
    expect(routeFlutter).toHaveBeenCalledWith('/v1/token', expect.objectContaining({ status: 500 }));
  });

  it('applies default mocks in bulk without starting a controller', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const sendRequest = httpReadySendRequest([
      { method: 'GET', path: '/v1/token' },
      { method: 'POST', path: '/v1/profile' },
    ]);
    const service = new SandboxService();
    const result = discovery();
    result.endpoints.push({
      kind: 'endpoint',
      uri: Uri.file('/tmp/profile.json'),
      indexed: true,
      endpointFile: {
        version: 1,
        name: 'Profile',
        method: 'POST',
        endpoint: '/v1/profile',
        rules: [
          { name: 'success', status: 201 },
        ],
      },
    });

    await service.applyDefaultMocks({ mock: { routeFlutter }, sendRequest } as any, result);

    expect(routeFlutter).toHaveBeenCalledTimes(2);
  });

  it('does not mark a Dio mock active when the interceptor is not injected', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const sendRequest = vi.fn().mockResolvedValue({
      mode: 'dio',
      interceptorInjected: false,
      routes: [{ method: 'GET', path: '/v1/token' }],
    });
    const service = new SandboxService();
    const entry = mockRule('success');

    await expect(service.applyRule({ mock: { routeFlutter }, sendRequest } as any, entry)).rejects.toThrow(
      'FliwrightDioMockInterceptor is not injected',
    );

    expect(routeFlutter).toHaveBeenCalledOnce();
    expect(service.getAppliedRules()).toHaveLength(0);
    expect(service.isApplied(entry)).toBeUndefined();
  });

  it('surfaces strict routeFlutter errors before active verification', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    routeFlutter.mockRejectedValueOnce(new Error('Flutter mock route registration failed: Invalid route JSON: bad payload'));
    const sendRequest = vi.fn();
    const service = new SandboxService();
    const entry = mockRule('success');

    await expect(service.applyRule({ mock: { routeFlutter }, sendRequest } as any, entry)).rejects.toThrow(
      'Flutter mock route registration failed: Invalid route JSON: bad payload',
    );

    expect(routeFlutter).toHaveBeenCalledOnce();
    expect(sendRequest).not.toHaveBeenCalled();
    expect(service.getAppliedRules()).toHaveLength(0);
  });

  it('does not mark a mock active when Flutter explicitly reports a failed registration', async () => {
    const routeFlutter = vi.fn().mockResolvedValue({ success: false });
    const sendRequest = vi.fn().mockResolvedValue({
      mode: 'http',
      serverPort: 12345,
      routes: [],
    });
    const service = new SandboxService();
    const entry = mockRule('success');

    await expect(service.applyRule({ mock: { routeFlutter }, sendRequest } as any, entry)).rejects.toThrow(
      'Flutter mock route was not registered: GET /v1/token. Available Flutter routes: (none)',
    );

    expect(service.getAppliedRules()).toHaveLength(0);
  });

  it('accepts completed routeFlutter calls when the extension returns an empty success payload', async () => {
    const routeFlutter = vi.fn().mockResolvedValue({});
    const sendRequest = vi.fn().mockResolvedValue({
      mode: 'http',
      serverPort: 12345,
      routes: [],
    });
    const service = new SandboxService();

    const applied = await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, mockRule('success'));

    expect(applied.ruleName).toBe('success');
    expect(service.getAppliedRules()).toHaveLength(1);
  });

  it('accepts completed routeFlutter calls even when the extension returns no payload', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const sendRequest = vi.fn().mockResolvedValue({
      mode: 'http',
      serverPort: 12345,
      routes: [],
    });
    const service = new SandboxService();

    const applied = await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, mockRule('success'));

    expect(applied.ruleName).toBe('success');
    expect(service.getAppliedRules()).toHaveLength(1);
  });

  it('accepts successful addRoute even when immediate route list is stale', async () => {
    const routeFlutter = vi.fn().mockResolvedValue({
      result: JSON.stringify({ success: true, id: 'registered-route' }),
    });
    const sendRequest = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'ext.fliwright.mock.debugState') {
        return {
          result: JSON.stringify({
            mode: 'dio',
            interceptorInjected: true,
            routes: [],
          }),
        };
      }
      return {
        result: JSON.stringify({ routes: [] }),
      };
    });
    const service = new SandboxService();
    const entry = mockRule('success');
    entry.endpoint = '/api/v1/user/info';
    entry.method = 'POST';

    const applied = await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, entry);

    expect(applied).toMatchObject({
      endpoint: '/api/v1/user/info',
      method: 'POST',
      ruleName: 'success',
    });
    expect(service.getAppliedRules()).toHaveLength(1);
  });

  it('accepts completed routeFlutter calls with a VM Success envelope when the immediate route list is stale', async () => {
    const routeFlutter = vi.fn().mockResolvedValue({ type: 'Success' });
    const sendRequest = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'ext.fliwright.mock.debugState') {
        return {
          result: JSON.stringify({
            mode: 'dio',
            interceptorInjected: true,
            routes: [],
          }),
        };
      }
      return {
        result: JSON.stringify({ routes: [] }),
      };
    });
    const service = new SandboxService();
    const entry = mockRule('success');
    entry.endpoint = '/api/v1/user/info';
    entry.method = 'POST';

    const applied = await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, entry);

    expect(applied).toMatchObject({
      endpoint: '/api/v1/user/info',
      method: 'POST',
      ruleName: 'success',
    });
    expect(service.getAppliedRules()).toHaveLength(1);
  });

  it('accepts real VM service extension response wrappers', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(vmExtensionResult({ success: true, id: 'registered-route' }));
    const sendRequest = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'ext.fliwright.mock.debugState') {
        return vmExtensionResult({
          mode: 'dio',
          interceptorInjected: true,
          routes: [],
        });
      }
      return vmExtensionResult({
        routes: [{ method: 'POST', path: '/api/v1/user/info' }],
      });
    });
    const service = new SandboxService();
    const entry = mockRule('success');
    entry.endpoint = '/api/v1/user/info';
    entry.method = 'POST';

    const applied = await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, entry);

    expect(applied).toMatchObject({
      endpoint: '/api/v1/user/info',
      method: 'POST',
      ruleName: 'success',
    });
  });

  it('clears routes and tracked state', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const sendRequest = httpReadySendRequest([{ method: 'GET', path: '/v1/token' }]);
    const clearFlutterRoutes = vi.fn().mockResolvedValue(undefined);
    const service = new SandboxService();
    await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, mockRule('success'));

    const count = await service.clear({ mock: { clearFlutterRoutes } } as any);

    expect(count).toBe(1);
    expect(clearFlutterRoutes).toHaveBeenCalledOnce();
    expect(service.getAppliedRules()).toHaveLength(0);
  });

  it('clears routes through the Flutter clearRoutes API even before Flutter mode is established', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const clearFlutterRoutes = vi.fn().mockResolvedValue(undefined);
    const sendRequest = httpReadySendRequest([{ method: 'GET', path: '/v1/token' }]);
    const service = new SandboxService();
    await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, mockRule('success'));

    const count = await service.clear({ mock: { clearFlutterRoutes } } as any);

    expect(count).toBe(1);
    expect(clearFlutterRoutes).toHaveBeenCalledOnce();
    expect(service.getAppliedRules()).toHaveLength(0);
  });

  it('falls back to the VM service clearRoutes extension when the core mock helper is unavailable', async () => {
    const routeFlutter = vi.fn().mockResolvedValue(undefined);
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.inspect') {
        return {
          httpReadiness: {
            registered: true,
            active: true,
            routes: [{ method: 'GET', path: '/v1/token' }],
          },
        };
      }
      return {};
    });
    const service = new SandboxService();
    await service.applyRule({ mock: { routeFlutter }, sendRequest } as any, mockRule('success'));

    const count = await service.clear({ mock: {}, sendRequest } as any);

    expect(count).toBe(1);
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.clearRoutes');
    expect(service.getAppliedRules()).toHaveLength(0);
  });

  it('reads active rules from the Flutter store, marking foreign routes as external', async () => {
    const service = new SandboxService();
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      { id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:success', method: 'GET', path: '/v1/token' },
      { id: 'test-script-route', method: 'POST', path: '/v1/profile' },
    ]);

    const active = await service.getActiveRules({ mock: { listFlutterRoutes } } as any);

    expect(listFlutterRoutes).toHaveBeenCalledOnce();
    expect(active).toMatchObject([
      { endpoint: '/v1/token', method: 'GET', ruleName: 'success' },
      { endpoint: '/v1/profile', method: 'POST', ruleName: '(external)' },
    ]);
  });

  it('getActiveRules skips routes with no resolvable method', async () => {
    const service = new SandboxService();
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      { id: 'no-method', path: '/v1/whatever' },
    ]);

    const active = await service.getActiveRules({ mock: { listFlutterRoutes } } as any);

    expect(active).toEqual([]);
  });
});

function mockRule(ruleName: string): MockRuleEntry {
  return {
    kind: 'rule',
    uri: Uri.file('/tmp/token.json'),
    endpoint: '/v1/token',
    method: 'GET',
    rule: { name: ruleName, status: 200, body: { ok: true } },
    isDefault: false,
  };
}

function httpReadySendRequest(routes: Array<{ method: string; path: string }>) {
  return vi.fn().mockImplementation(async (method: string) => {
    if (method === 'ext.fliwright.mock.debugState') {
      return {
        mode: 'http',
        serverPort: 12345,
        routes,
      };
    }
    return { routes };
  });
}

function vmExtensionResult(response: unknown) {
  return {
    type: '_ExtensionType',
    response: JSON.stringify(response),
  };
}

function discovery(): MockDiscoveryResult {
  return {
    root: Uri.file('/tmp/.fliwright/mocks'),
    indexUri: Uri.file('/tmp/.fliwright/mocks/mock-index.json'),
    endpoints: [
      {
        kind: 'endpoint',
        uri: Uri.file('/tmp/token.json'),
        indexed: true,
        defaultRule: 'error',
        endpointFile: {
          version: 1,
          name: 'Token',
          method: 'GET',
          endpoint: '/v1/token',
          rules: [
            { name: 'success', status: 200 },
            { name: 'error', status: 500 },
          ],
        },
      },
    ],
    invalid: [
      {
        kind: 'invalid',
        uri: Uri.file('/tmp/bad.json'),
        label: 'bad.json',
        error: 'bad json',
      },
    ],
  };
}
