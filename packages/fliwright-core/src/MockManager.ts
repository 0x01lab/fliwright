import type { MockRouteResponse, MockCall, SendRequest } from './types.js';
import type { MockAdapter } from './interfaces/MockAdapter.js';
import { ToolMockServer, type ToolMockServerOptions } from './ToolMockServer.js';

export class MockManager implements MockAdapter {
  /** @internal */ _server = new ToolMockServer();
  private remoteControllerUrl: string | null = process.env.FLIWRIGHT_MOCK_CONTROLLER_URL ?? null;

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
      return;
    }
    this._server.clear();
  }

  async setPassthrough(enabled: boolean): Promise<void> {
    if (this.remoteControllerUrl) {
      await requestJson(`${this.remoteControllerUrl}/passthrough`, {
        method: 'POST',
        body: { enabled },
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
        const entry = this._server.ruleStore.listEndpoints().find((endpoint) => endpoint.endpoint === route.path);
        const response = entry ? this._server.ruleStore.getActiveResponse(entry.endpoint) : null;
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
  async switchRule(endpoint: string, ruleName: string): Promise<void> {
    this._server.switchRule(endpoint, ruleName);
  }

  async configureFlutterController(url?: string): Promise<void> {
    const controllerUrl = url ?? this.controllerUrl ?? await this.startServer();
    this.remoteControllerUrl = controllerUrl;
    const result = await this.sendRequest('ext.fliwright.mock.setController', { url: controllerUrl });
    if (
      result &&
      typeof result === 'object' &&
      'error' in result &&
      typeof (result as { error?: unknown }).error === 'string'
    ) {
      throw new Error(`Fliwright mock set controller failed: ${(result as { error: string }).error}`);
    }
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
