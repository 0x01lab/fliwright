import type { MockRouteResponse, MockCall } from './types.js';

type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export class MockManager {
  constructor(private sendRequest: SendRequest) {}

  async route(path: string, response: MockRouteResponse & { method?: string }): Promise<void> {
    const config = {
      path,
      method: response.method,
      response: {
        status: response.status,
        headers: response.headers,
        body: response.body,
        delay: response.delay,
      },
    };
    await this.sendRequest('ext.fliwright.mock.addRoute', {
      route: JSON.stringify(config),
    });
  }

  async removeRoute(path: string): Promise<void> {
    await this.sendRequest('ext.fliwright.mock.removeRoute', { path });
  }

  async clear(): Promise<void> {
    await this.sendRequest('ext.fliwright.mock.clearRoutes', {});
  }

  async setPassthrough(enabled: boolean): Promise<void> {
    await this.sendRequest('ext.fliwright.mock.setPassthrough', {
      enabled: String(enabled),
    });
  }

  async getCalls(path?: string): Promise<MockCall[]> {
    const params = path ? { path } : {};
    const result = (await this.sendRequest('ext.fliwright.mock.getCalls', params)) as {
      calls: MockCall[];
    };
    return result.calls ?? [];
  }
}
