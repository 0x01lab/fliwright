import type { MockRouteResponse, MockCall, SendRequest } from './types.js';
import type { MockAdapter } from './interfaces/MockAdapter.js';
import { MockRuleStore } from './MockRuleStore.js';

export class MockManager implements MockAdapter {
  /** @internal */ _ruleStore = new MockRuleStore();

  constructor(private sendRequest: SendRequest) {}

  /** Alias for MockAdapter compatibility. */
  async addRoute(pattern: string, response: MockRouteResponse): Promise<void> {
    await this.route(pattern, response);
  }

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

  async listRoutes(): Promise<Array<{ id: string; method?: string; path: string }>> {
    const result = (await this.sendRequest('ext.fliwright.mock.listRoutes', {})) as {
      routes: Array<{ id: string; method?: string; path: string }>;
    };
    return result.routes ?? [];
  }

  async clearCalls(): Promise<void> {
    await this.sendRequest('ext.fliwright.mock.clearCalls', {});
  }

  // --- Rule switching API ---

  /**
   * Load mock rules from a directory and apply all active rules to Flutter.
   * Defaults to `.fliwright/mocks` if no path given.
   * Silently skips if directory or index file doesn't exist.
   */
  async loadRules(mockDir?: string): Promise<void> {
    const dir = mockDir ?? '.fliwright/mocks';
    await this._ruleStore.loadFromDirectory(dir);

    for (const ep of this._ruleStore.listEndpoints()) {
      const response = this._ruleStore.getActiveResponse(ep.endpoint);
      if (response) {
        await this.route(ep.endpoint, { ...response, method: ep.method });
      }
    }
  }

  /**
   * List all loaded endpoints with their available rules and current active rule.
   * Returns empty array if loadRules() hasn't been called.
   */
  listRules(): Array<{
    endpoint: string;
    method: string;
    rules: string[];
    activeRule: string;
  }> {
    return this._ruleStore.listEndpoints();
  }

  /**
   * Switch the active rule for an endpoint and apply it to the Flutter mock server.
   * Throws if the endpoint or rule name is not found.
   */
  async switchRule(endpoint: string, ruleName: string): Promise<void> {
    this._ruleStore.switchRule(endpoint, ruleName);
    const response = this._ruleStore.getActiveResponse(endpoint);
    if (response) {
      const entry = this._ruleStore.listEndpoints().find((e) => e.endpoint === endpoint);
      await this.route(endpoint, { ...response, method: entry?.method });
    }
  }
}
