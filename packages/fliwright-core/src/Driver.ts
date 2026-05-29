import { PluginRegistry } from './PluginRegistry.js';
import { VMServiceConnector } from './VMServiceConnector.js';
import type { FliwrightPlugin } from './interfaces/Plugin.js';
import type { StateAdapter } from './interfaces/StateAdapter.js';
import type { MockAdapter } from './interfaces/MockAdapter.js';
import type { FinderStrategy } from './interfaces/FinderStrategy.js';
import type { HealingStrategy } from './interfaces/HealingStrategy.js';
import type { TestResult } from './types.js';

export interface DriverOptions { plugins?: FliwrightPlugin[]; }

export class FliwrightDriver {
  private registry = new PluginRegistry();
  private connector = new VMServiceConnector();

  constructor(options: DriverOptions = {}) {
    for (const plugin of options.plugins ?? []) { this.registry.register(plugin); }
  }

  async connect(vmServiceUrl: string): Promise<void> {
    await this.connector.connect(vmServiceUrl);
    await this.registry.initAll((method, params) => this.connector.sendRequest(method, params));
  }

  async attachMockConnector(mockWS: { on: (event: string, fn: Function) => void; send: (data: string) => void; close: () => void }): Promise<void> {
    this.connector.attachMock(mockWS);
    await this.registry.initAll((method, params) => this.connector.sendRequest(method, params));
  }

  sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> { return this.connector.sendRequest(method, params); }

  getStateAdapter(name: string): StateAdapter { return this.registry.getStateAdapter(name); }
  getMockAdapter(name: string): MockAdapter { return this.registry.getMockAdapter(name); }
  getFinderStrategy(name: string): FinderStrategy { return this.registry.getFinderStrategy(name); }
  getHealingStrategy(name: string): HealingStrategy { return this.registry.getHealingStrategy(name); }

  async notifyTestStart(testName: string): Promise<void> { await this.registry.notifyTestStart(testName); }
  async notifyTestEnd(testName: string, result: TestResult): Promise<void> { await this.registry.notifyTestEnd(testName, result); }

  async dispose(): Promise<void> {
    await this.registry.disposeAll();
    this.connector.disconnect();
  }
}
