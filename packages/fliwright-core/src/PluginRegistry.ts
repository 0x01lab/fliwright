import type { FliwrightPlugin, PluginContext } from './interfaces/Plugin.js';
import type { StateAdapter } from './interfaces/StateAdapter.js';
import type { MockAdapter } from './interfaces/MockAdapter.js';
import type { FinderStrategy } from './interfaces/FinderStrategy.js';
import type { HealingStrategy } from './interfaces/HealingStrategy.js';
import type { TestResult } from './types.js';

export class PluginRegistry {
  private plugins = new Map<string, FliwrightPlugin>();
  private stateAdapters = new Map<string, StateAdapter>();
  private mockAdapters = new Map<string, MockAdapter>();
  private finderStrategies = new Map<string, FinderStrategy>();
  private healingStrategies = new Map<string, HealingStrategy>();
  private initialized = false;

  register(plugin: FliwrightPlugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin '${plugin.name}' is already registered`);
    }
    this.plugins.set(plugin.name, plugin);
  }

  resolve(name: string): FliwrightPlugin {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`Plugin '${name}' is not registered`);
    return plugin;
  }

  get pluginNames(): string[] { return [...this.plugins.keys()]; }

  getStateAdapter(name: string): StateAdapter {
    const adapter = this.stateAdapters.get(name);
    if (!adapter) throw new Error(`StateAdapter '${name}' is not registered`);
    return adapter;
  }

  getMockAdapter(name: string): MockAdapter {
    const adapter = this.mockAdapters.get(name);
    if (!adapter) throw new Error(`MockAdapter '${name}' is not registered`);
    return adapter;
  }

  getFinderStrategy(name: string): FinderStrategy {
    const strategy = this.finderStrategies.get(name);
    if (!strategy) throw new Error(`FinderStrategy '${name}' is not registered`);
    return strategy;
  }

  getHealingStrategy(name: string): HealingStrategy {
    const strategy = this.healingStrategies.get(name);
    if (!strategy) throw new Error(`HealingStrategy '${name}' is not registered`);
    return strategy;
  }

  async initAll(sendRequest: (method: string, params?: Record<string, unknown>) => Promise<unknown>): Promise<void> {
    if (this.initialized) return;
    const context: PluginContext = {
      sendRequest,
      registerStateAdapter: (name, adapter) => { this.stateAdapters.set(name, adapter as StateAdapter); },
      registerMockAdapter: (name, adapter) => { this.mockAdapters.set(name, adapter as MockAdapter); },
      registerFinderStrategy: (name, strategy) => { this.finderStrategies.set(name, strategy as FinderStrategy); },
      registerHealingStrategy: (name, strategy) => { this.healingStrategies.set(name, strategy as HealingStrategy); },
    };
    for (const plugin of this.plugins.values()) {
      if (plugin.onInit) await plugin.onInit(context);
    }
    this.initialized = true;
  }

  async notifyTestStart(testName: string): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onTestStart) await plugin.onTestStart(testName);
    }
  }

  async notifyTestEnd(testName: string, result: TestResult): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onTestEnd) await plugin.onTestEnd(testName, result);
    }
  }

  async disposeAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onDispose) await plugin.onDispose();
    }
  }
}
