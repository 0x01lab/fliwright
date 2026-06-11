import type { MockRouteResponse, MockCall, SendRequest } from './types.js';
import type { MockAdapter } from './interfaces/MockAdapter.js';
import { ToolMockServer, type ToolMockServerOptions } from './ToolMockServer.js';

export class MockManager implements MockAdapter {
  /** @internal */ _server = new ToolMockServer();
  private passthrough = true;
  private usesFlutterStore = false;

  constructor(private sendRequest: SendRequest) {}

  get controllerUrl(): string | null {
    return this._server.url;
  }

  async startServer(options?: ToolMockServerOptions): Promise<string> {
    if (options) {
      if (this._server.url) await this._server.stop();
      this._server = new ToolMockServer(options);
    }
    return this._server.start();
  }

  async stopServer(): Promise<void> {
    await this._server.stop();
  }

  /** Alias for MockAdapter compatibility. */
  async addRoute(pattern: string, response: MockRouteResponse): Promise<void> {
    await this.route(pattern, response);
  }

  async route(path: string, response: MockRouteResponse & { method?: string }): Promise<void> {
    this._server.route(path, response);
    const synced = await this.trySyncFlutterRoute(path, response);
    if (synced) {
      this.usesFlutterStore = true;
      return;
    }
  }

  async removeRoute(path: string, method?: string): Promise<void> {
    if (this.usesFlutterStore) {
      await this.sendRequest('ext.fliwright.mock.removeRoute', {
        path,
        ...(method ? { method } : {}),
      });
      return;
    }
    this._server.removeRoute(path, method);
  }

  async clear(): Promise<void> {
    if (this.usesFlutterStore) {
      await this.sendRequest('ext.fliwright.mock.clearRoutes');
      return;
    }
    this._server.clear();
  }

  async setPassthrough(enabled: boolean): Promise<void> {
    this.passthrough = enabled;
    const synced = await this.trySendRequest('ext.fliwright.mock.setPassthrough', {
      enabled: String(enabled),
    });
    if (synced) {
      this.usesFlutterStore = true;
      return;
    }
    this._server.setPassthrough(enabled);
  }

  async getCalls(path?: string): Promise<MockCall[]> {
    if (this.usesFlutterStore) {
      const result = await this.sendRequest('ext.fliwright.mock.getCalls', path ? { path } : {}) as { calls?: MockCall[] };
      return result.calls ?? [];
    }
    return this._server.getCalls(path);
  }

  async listRoutes(): Promise<Array<{ id: string; method?: string; path: string }>> {
    if (this.usesFlutterStore) {
      const result = await this.sendRequest('ext.fliwright.mock.listRoutes', {}) as {
        routes?: Array<{ id: string; method?: string; path: string }>;
      };
      return result.routes ?? [];
    }
    return this._server.listRoutes();
  }

  async clearCalls(): Promise<void> {
    if (this.usesFlutterStore) {
      await this.sendRequest('ext.fliwright.mock.clearCalls');
      return;
    }
    this._server.clearCalls();
  }

  // --- Rule switching API ---

  /**
   * Load mock rules from a directory and apply all active rules to Flutter.
   * Defaults to `.fliwright/mocks` if no path given.
   * If mock-index.json is missing, scans api/*.json.
   */
  async loadRules(mockDir?: string): Promise<void> {
    const dir = mockDir ?? '.fliwright/mocks';
    await this._server.loadRules(dir);
    for (const route of this._server.listRoutes()) {
      const entry = this._server.ruleStore.listEndpoints().find((endpoint) => (
        endpoint.endpoint === route.path &&
        (!route.method || endpoint.method.toUpperCase() === route.method.toUpperCase())
      ));
      const response = entry ? this._server.ruleStore.getActiveResponse(entry.endpoint, entry.method) : null;
      if (response) await this.route(route.path, { ...response, method: route.method });
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
    return this._server.ruleStore.listEndpoints();
  }

  /**
   * Switch the active rule for an endpoint and apply it to the Flutter mock server.
   * Throws if the endpoint or rule name is not found.
   */
  async switchRule(endpoint: string, ruleName: string, method?: string): Promise<void> {
    this._server.switchRule(endpoint, ruleName, method);
    if (this.usesFlutterStore) {
      const entry = this._server.ruleStore.listEndpoints().find((item) => (
        item.endpoint === endpoint && (!method || item.method.toUpperCase() === method.toUpperCase())
      ));
      const response = entry ? this._server.ruleStore.getActiveResponse(endpoint, entry.method) : null;
      if (response && entry) {
        await this.route(endpoint, { ...response, method: entry.method });
      }
    }
  }

  async configureFlutterController(_url?: string): Promise<void> {
    await this.sendRequest('ext.fliwright.mock.setPassthrough', {
      enabled: String(this.passthrough),
    });
    for (const route of this._server.listRoutes()) {
      const response = this._server.getRouteResponse(route.path, route.method) ?? {};
      await this.syncFlutterRoute(route.path, { ...response, method: route.method });
    }
    this.usesFlutterStore = true;
  }

  private async syncFlutterRoute(path: string, response: MockRouteResponse & { method?: string }): Promise<void> {
    await this.sendRequest('ext.fliwright.mock.addRoute', {
      route: JSON.stringify({
        path,
        method: response.method,
        response: {
          status: response.status,
          headers: response.headers,
          body: response.body,
          delay: response.delay,
        },
      }),
    });
  }

  private async trySyncFlutterRoute(path: string, response: MockRouteResponse & { method?: string }): Promise<boolean> {
    return this.trySendRequest('ext.fliwright.mock.addRoute', {
      route: JSON.stringify({
        path,
        method: response.method,
        response: {
          status: response.status,
          headers: response.headers,
          body: response.body,
          delay: response.delay,
        },
      }),
    });
  }

  private async trySendRequest(method: string, params?: Record<string, unknown>): Promise<boolean> {
    try {
      const result = await this.sendRequest(method, params);
      if (
        result &&
        typeof result === 'object' &&
        'error' in result &&
        typeof (result as { error?: unknown }).error === 'string'
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}
