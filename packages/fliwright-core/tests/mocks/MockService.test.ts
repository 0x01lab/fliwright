import { describe, expect, it, vi } from 'vitest';
import { FliwrightMockService } from '../../src/index.js';
import { MockManager } from '../../src/MockManager.js';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function createMockSendRequest(responses: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation((method: string) => {
    if (method in responses) return Promise.resolve(responses[method]);
    return Promise.reject(new Error(`No mock response for ${method}`));
  });
}

describe('FliwrightMockService', () => {
  it('connects once and proxies operations through the core mock runtime', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': { success: true },
      'ext.fliwright.mock.getCalls': {
        calls: [{
          method: 'GET',
          path: '/api/ping',
          url: 'https://dev.ex.io/api/ping',
          headers: {},
          timestamp: 'now',
          backend: 'dio',
        }],
      },
    });
    const driver = {
      connect: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      mock: new MockManager(sendRequest),
    };
    const service = new FliwrightMockService({
      createDriver: () => driver as any,
    });

    await service.connect('http://127.0.0.1:12345');
    await service.routeFlutter('/api/ping', { method: 'GET', status: 200 });
    await expect(service.waitForCall({ path: '/api/ping', method: 'GET' }, { timeout: 100 })).resolves.toHaveLength(1);

    expect(driver.connect).toHaveBeenCalledWith('ws://127.0.0.1:12345/ws');
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.addRoute', {
      route: JSON.stringify({
        path: '/api/ping',
        method: 'GET',
        response: {
          status: 200,
          headers: undefined,
          body: undefined,
          delay: undefined,
        },
      }),
    });
    await service.dispose();
    expect(driver.dispose).toHaveBeenCalledOnce();
  });

  it('requires a connection before mock operations', async () => {
    const service = new FliwrightMockService();

    await expect(service.clearRoutes()).rejects.toThrow('mock service is not connected');
  });

  it('proxies activateRules through the connected runtime', async () => {
    const mockDir = await mkdtemp(join(tmpdir(), 'fliwright-mock-service-'));
    await mkdir(join(mockDir, 'api'));
    await writeFile(join(mockDir, 'api', 'ping.json'), JSON.stringify({
      version: 1,
      name: 'Ping',
      method: 'GET',
      endpoint: '/api/ping',
      rules: [
        { name: 'success', status: 200, body: { ok: true } },
      ],
    }));
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': { success: true },
      'ext.fliwright.mock.clearForeignRoutes': { success: true },
      'ext.fliwright.mock.listRoutes': {
        routes: [{
          id: 'fliwright-vscode:GET:%2Fapi%2Fping:success',
          method: 'GET',
          path: '/api/ping',
        }],
      },
      'ext.fliwright.mock.clearCalls': { success: true },
    });
    const driver = {
      connect: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      mock: new MockManager(sendRequest),
    };
    const service = new FliwrightMockService({
      createDriver: () => driver as any,
    });

    await service.connect('ws://127.0.0.1:12345/ws');
    await service.activateRules({
      mockDir,
      routes: [{ path: '/api/ping', method: 'GET', rule: 'success' }],
    });

    expect(sendRequest.mock.calls.map((call) => call[0])).toEqual([
      'ext.fliwright.mock.addRoute',
      'ext.fliwright.mock.clearForeignRoutes',
      'ext.fliwright.mock.addRoute',
      'ext.fliwright.mock.listRoutes',
      'ext.fliwright.mock.clearCalls',
    ]);
  });
});
