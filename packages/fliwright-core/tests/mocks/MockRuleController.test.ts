import { describe, expect, it, vi } from 'vitest';
import { MockRuleController, mockRuleController, mockRuleRouteId } from '../../src/index.js';

describe('mockRuleController', () => {
  it('is the shared singleton for mock rule route identity', () => {
    const id = mockRuleController.createRouteId('/v1/token', 'get', 'success');

    expect(mockRuleController).toBe(MockRuleController.instance);
    expect(id).toBe('fliwright-vscode:GET:%2Fv1%2Ftoken:success');
    expect(mockRuleRouteId('/v1/token', 'GET', 'success')).toBe(id);
    expect(mockRuleController.parseRouteId(id)).toEqual({
      method: 'GET',
      endpoint: '/v1/token',
      ruleName: 'success',
    });
  });

  it('applies Flutter rules through the singleton route shape', async () => {
    const routeFlutter = vi.fn().mockResolvedValue({ success: true });

    await expect(mockRuleController.applyFlutterRule(
      { routeFlutter },
      '/v1/token',
      'GET',
      { name: 'error', status: 500, body: { fail: true } },
    )).resolves.toEqual({ success: true });

    expect(routeFlutter).toHaveBeenCalledWith('/v1/token', {
      id: 'fliwright-vscode:GET:%2Fv1%2Ftoken:error',
      method: 'GET',
      status: 500,
      delay: undefined,
      headers: undefined,
      body: { fail: true },
    });
  });

  it('owns Flutter route mutation helpers', async () => {
    const removeFlutterRoute = vi.fn().mockResolvedValue(undefined);
    const clearFlutterRoutes = vi.fn().mockResolvedValue(undefined);
    const listFlutterRoutes = vi.fn().mockResolvedValue([
      { id: 'route-1', method: 'GET', path: '/v1/token' },
    ]);

    await mockRuleController.removeFlutterRule({ removeFlutterRoute }, '/v1/token', 'GET');
    await mockRuleController.clearFlutterRules({ clearFlutterRoutes });
    await expect(mockRuleController.listFlutterRoutes({ listFlutterRoutes })).resolves.toEqual([
      { id: 'route-1', method: 'GET', path: '/v1/token' },
    ]);

    expect(removeFlutterRoute).toHaveBeenCalledWith('/v1/token', 'GET');
    expect(clearFlutterRoutes).toHaveBeenCalledOnce();
    expect(listFlutterRoutes).toHaveBeenCalledOnce();
  });

  it('falls back to the VM service clearRoutes extension', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ cleared: 1 });

    await mockRuleController.clearFlutterRules({}, sendRequest);

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.clearRoutes');
  });
});
