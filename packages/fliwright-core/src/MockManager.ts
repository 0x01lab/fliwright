import type { MockRouteResponse, MockCall, SendRequest } from './types.js';
import type { MockAdapter } from './interfaces/MockAdapter.js';
import { ToolMockServer, type ToolMockServerOptions } from './ToolMockServer.js';

export class MockManager implements MockAdapter {
  /** @internal */ _server = new ToolMockServer();
  private remoteControllerUrl: string | null = process.env.FLIWRIGHT_MOCK_CONTROLLER_URL ?? null;
  private passthrough = true;

  constructor(private sendRequest: SendRequest) {}

  get controllerUrl(): string | null {
    return this.remoteControllerUrl ?? this._server.url;
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
    if (this.remoteControllerUrl) {
      await requestJson(`${this.remoteControllerUrl}/routes`, {
        method: 'POST',
        body: { path, method: response.method, response },
      });
      await this.syncFlutterRoute(path, response);
      return;
    }
    this._server.route(path, response);
  }

  async removeRoute(path: string, method?: string): Promise<void> {
    if (this.remoteControllerUrl) {
      await requestJson(`${this.remoteControllerUrl}/routes`, {
        method: 'DELETE',
        body: { path, method },
      });
      await this.sendRequest('ext.fliwright.mock.removeRoute', {
        path,
        ...(method ? { method } : {}),
      });
      return;
    }
    this._server.removeRoute(path, method);
  }

  async clear(): Promise<void> {
    if (this.remoteControllerUrl) {
      await requestJson(`${this.remoteControllerUrl}/routes`, {
        method: 'DELETE',
        body: {},
      });
      await this.sendRequest('ext.fliwright.mock.clearRoutes');
      return;
    }
    this._server.clear();
  }

  async setPassthrough(enabled: boolean): Promise<void> {
    this.passthrough = enabled;
    if (this.remoteControllerUrl) {
      await requestJson(`${this.remoteControllerUrl}/passthrough`, {
        method: 'POST',
        body: { enabled },
      });
      await this.sendRequest('ext.fliwright.mock.setPassthrough', {
        enabled: String(enabled),
      });
      return;
    }
    this._server.setPassthrough(enabled);
  }

  async getCalls(path?: string): Promise<MockCall[]> {
    if (this.remoteControllerUrl) {
      const url = new URL(`${this.remoteControllerUrl}/calls`);
      if (path) url.searchParams.set('path', path);
      const result = await requestJson(url.toString()) as { calls?: MockCall[] };
      return result.calls ?? [];
    }
    return this._server.getCalls(path);
  }

  async listRoutes(): Promise<Array<{ id: string; method?: string; path: string }>> {
    if (this.remoteControllerUrl) {
      const result = await requestJson(`${this.remoteControllerUrl}/routes`) as {
        routes?: Array<{ id: string; method?: string; path: string }>;
      };
      return result.routes ?? [];
    }
    return this._server.listRoutes();
  }

  async clearCalls(): Promise<void> {
    if (this.remoteControllerUrl) {
      await requestJson(`${this.remoteControllerUrl}/calls`, { method: 'DELETE' });
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
    if (this.remoteControllerUrl) {
      for (const route of this._server.listRoutes()) {
        const entry = this._server.ruleStore.listEndpoints().find((endpoint) => (
          endpoint.endpoint === route.path &&
          (!route.method || endpoint.method.toUpperCase() === route.method.toUpperCase())
        ));
        const response = entry ? this._server.ruleStore.getActiveResponse(entry.endpoint, entry.method) : null;
        if (response) await this.route(route.path, { ...response, method: route.method });
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
    return this._server.ruleStore.listEndpoints();
  }

  /**
   * Switch the active rule for an endpoint and apply it to the Flutter mock server.
   * Throws if the endpoint or rule name is not found.
   */
  async switchRule(endpoint: string, ruleName: string, method?: string): Promise<void> {
    this._server.switchRule(endpoint, ruleName, method);
    if (this.remoteControllerUrl) {
      const entry = this._server.ruleStore.listEndpoints().find((item) => (
        item.endpoint === endpoint && (!method || item.method.toUpperCase() === method.toUpperCase())
      ));
      const response = entry ? this._server.ruleStore.getActiveResponse(endpoint, entry.method) : null;
      if (response && entry) {
        await this.route(endpoint, { ...response, method: entry.method });
      }
    }
  }

  async configureFlutterController(url?: string): Promise<void> {
    const controllerUrl = url ?? this.controllerUrl ?? await this.startServer();
    const result = await this.sendRequest('ext.fliwright.mock.setController', { url: controllerUrl });
    if (
      result &&
      typeof result === 'object' &&
      'error' in result &&
      typeof (result as { error?: unknown }).error === 'string'
    ) {
      throw new Error(`Fliwright mock set controller failed: ${(result as { error: string }).error}`);
    }
    this.remoteControllerUrl = controllerUrl;
    await this.sendRequest('ext.fliwright.mock.setPassthrough', {
      enabled: String(this.passthrough),
    });
    for (const route of this._server.listRoutes()) {
      await this.syncFlutterRoute(route.path, { method: route.method });
    }
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
}

async function requestJson(
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) as unknown : {};
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body
      ? String((body as { error?: unknown }).error)
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}
