import { describe, expect, it, vi } from 'vitest';
import { FliwrightMockService } from '../../src/index.js';
import { MockManager } from '../../src/MockManager.js';

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
});
