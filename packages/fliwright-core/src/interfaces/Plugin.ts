import type { TestResult } from '../types.js';
import type { StateAdapter } from './StateAdapter.js';
import type { MockAdapter } from './MockAdapter.js';
import type { FinderStrategy } from './FinderStrategy.js';
import type { HealingStrategy } from './HealingStrategy.js';

export interface PluginContext {
  sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown>;
  registerStateAdapter(name: string, adapter: StateAdapter): void;
  registerMockAdapter(name: string, adapter: MockAdapter): void;
  registerFinderStrategy(name: string, strategy: FinderStrategy): void;
  registerHealingStrategy(name: string, strategy: HealingStrategy): void;
  /** Subscribe to VM Service stream events. Returns unsubscribe function. */
  onEvent(callback: (event: import('../types.js').VMServiceEvent) => void): () => void;
}

export interface FliwrightPlugin {
  readonly name: string;
  onInit?(context: PluginContext): Promise<void>;
  onTestStart?(testName: string): Promise<void>;
  onTestEnd?(testName: string, result: TestResult): Promise<void>;
  onDispose?(): Promise<void>;
}
