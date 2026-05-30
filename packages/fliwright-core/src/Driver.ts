import { Page } from './Page.js';
import { PluginRegistry } from './PluginRegistry.js';
import { VMServiceConnector } from './VMServiceConnector.js';
import type { MockWebSocket } from './VMServiceConnector.js';
import type { FliwrightPlugin } from './interfaces/Plugin.js';
import type { StateAdapter } from './interfaces/StateAdapter.js';
import type { MockAdapter } from './interfaces/MockAdapter.js';
import type { FinderStrategy } from './interfaces/FinderStrategy.js';
import type { HealingStrategy } from './interfaces/HealingStrategy.js';
import { MockManager } from './MockManager.js';
import { SelfHealingEngine } from './SelfHealingEngine.js';
import { SnapshotStore } from './SnapshotStore.js';
import { MultiDimensionalHealingStrategy } from './strategies/MultiDimensionalHealingStrategy.js';
import type { TestResult } from './types.js';

export interface DriverOptions { plugins?: FliwrightPlugin[]; }

export class FliwrightDriver {
  private registry = new PluginRegistry();
  private connector = new VMServiceConnector();
  private _page: Page | null = null;
  private _mock: MockManager | null = null;
  private _healing: SelfHealingEngine | null = null;

  get mock(): MockManager {
    if (!this._mock) {
      this._mock = new MockManager((method, params) => this.connector.sendRequest(method, params));
    }
    return this._mock;
  }

  get healing(): SelfHealingEngine {
    if (!this._healing) {
      this._healing = new SelfHealingEngine(
        new SnapshotStore(),
        new MultiDimensionalHealingStrategy(),
      );
    }
    return this._healing;
  }

  get state(): StateAdapter {
    return this.registry.getStateAdapter('riverpod');
  }

  constructor(options: DriverOptions = {}) {
    for (const plugin of options.plugins ?? []) { this.registry.register(plugin); }
  }

  get page(): Page {
    if (!this._page) {
      this._page = new Page((method, params) => this.connector.sendRequest(method, params));
    }
    return this._page;
  }

  async connect(vmServiceUrl: string): Promise<void> {
    await this.connector.connect(vmServiceUrl);
    await this.registry.initAll(
      (method, params) => this.connector.sendRequest(method, params),
      this.connector,
    );
  }

  async attachMockConnector(mockWS: MockWebSocket): Promise<void> {
    this.connector.attachMock(mockWS);
    await this.registry.initAll(
      (method, params) => this.connector.sendRequest(method, params),
      this.connector,
    );
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
