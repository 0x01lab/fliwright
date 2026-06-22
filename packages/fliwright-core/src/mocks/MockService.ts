import { FliwrightDriver } from '../Driver.js';
import type { MockRouteResponse } from '../types.js';
import { readWorkspaceConfigSync } from '../WorkspaceConfig.js';
import { MockRuntime } from './MockRuntime.js';
import type { NormalizedRequestMatcher, WaitForMockCallOptions } from './types.js';

export interface FliwrightMockServiceOptions {
  createDriver?: () => FliwrightDriver;
}

export class FliwrightMockService {
  private driver: FliwrightDriver | undefined;
  private runtime: MockRuntime | undefined;
  private connectedUrl: string | undefined;

  constructor(private readonly options: FliwrightMockServiceOptions = {}) {}

  get isConnected(): boolean {
    return this.runtime !== undefined;
  }

  get currentUrl(): string | undefined {
    return this.connectedUrl;
  }

  async connect(vmServiceUrl = vmServiceUrlFromEnv()): Promise<MockRuntime> {
    const url = toWebSocketUrl(vmServiceUrl);
    if (!url) {
      throw new Error(
        'No VM Service URL provided. Pass mock.connect(vmServiceUrl) or set FLIWRIGHT_VM_URL / FLIWRIGHT_VM_SERVICE_URL.',
      );
    }
    if (this.runtime && this.connectedUrl === url) return this.runtime;

    await this.dispose();
    const driver = this.options.createDriver?.() ?? new FliwrightDriver();
    await driver.connect(url);
    this.driver = driver;
    this.runtime = new MockRuntime(driver.mock);
    this.connectedUrl = url;
    return this.runtime;
  }

  useDriver(driver: FliwrightDriver): MockRuntime {
    this.driver = driver;
    this.runtime = new MockRuntime(driver.mock);
    this.connectedUrl = undefined;
    return this.runtime;
  }

  async dispose(): Promise<void> {
    const driver = this.driver;
    this.driver = undefined;
    this.runtime = undefined;
    this.connectedUrl = undefined;
    await driver?.dispose();
  }

  async loadRules(mockDir?: string): Promise<void> {
    return this.requireRuntime().loadRules(mockDir);
  }

  async switchRule(endpoint: string, ruleName: string, method?: string): Promise<void> {
    return this.requireRuntime().switchRule(endpoint, ruleName, method);
  }

  async route(path: string, response: MockRouteResponse & { method?: string; id?: string }): Promise<void> {
    return this.requireRuntime().route(path, response);
  }

  async routeFlutter(path: string, response: MockRouteResponse & { method?: string; id?: string }): Promise<unknown> {
    return this.requireRuntime().routeFlutter(path, response);
  }

  async removeRoute(path: string, method?: string): Promise<void> {
    return this.requireRuntime().removeRoute(path, method);
  }

  async clearRoutes(): Promise<void> {
    return this.requireRuntime().clearRoutes();
  }

  async clearCalls(): Promise<void> {
    return this.requireRuntime().clearCalls();
  }

  async setPassthrough(enabled: boolean): Promise<void> {
    return this.requireRuntime().setPassthrough(enabled);
  }

  async getCalls(path?: string): Promise<Awaited<ReturnType<MockRuntime['getCalls']>>> {
    return this.requireRuntime().getCalls(path);
  }

  async listRoutes(): Promise<Awaited<ReturnType<MockRuntime['listRoutes']>>> {
    return this.requireRuntime().listRoutes();
  }

  listRules(): ReturnType<MockRuntime['listRules']> {
    return this.requireRuntime().listRules();
  }

  async findCalls(matcher: NormalizedRequestMatcher): Promise<Awaited<ReturnType<MockRuntime['findCalls']>>> {
    return this.requireRuntime().findCalls(matcher);
  }

  async waitForCall(
    matcher: NormalizedRequestMatcher | string,
    options?: WaitForMockCallOptions,
  ): Promise<Awaited<ReturnType<MockRuntime['waitForCall']>>> {
    return this.requireRuntime().waitForCall(matcher, options);
  }

  private requireRuntime(): MockRuntime {
    if (!this.runtime) {
      throw new Error('Fliwright mock service is not connected. Call mock.connect(vmServiceUrl) first.');
    }
    return this.runtime;
  }
}

export const mock = new FliwrightMockService();

function vmServiceUrlFromEnv(): string {
  return process.env.FLIWRIGHT_VM_URL
    ?? process.env.FLIWRIGHT_VM_SERVICE_URL
    ?? readWorkspaceConfigSync().vmServiceUrl
    ?? '';
}

function toWebSocketUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  const wsUrl = trimmed
    .replace(/^http:\/\//i, 'ws://')
    .replace(/^https:\/\//i, 'wss://')
    .replace(/\/$/, '');
  return wsUrl.endsWith('/ws') ? wsUrl : `${wsUrl}/ws`;
}
