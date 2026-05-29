import type { TestResult } from '../types.js';

export interface PluginContext {
  sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown>;
  registerStateAdapter(name: string, adapter: unknown): void;
  registerMockAdapter(name: string, adapter: unknown): void;
  registerFinderStrategy(name: string, strategy: unknown): void;
  registerHealingStrategy(name: string, strategy: unknown): void;
}

export interface FliwrightPlugin {
  readonly name: string;
  onInit?(context: PluginContext): Promise<void>;
  onTestStart?(testName: string): Promise<void>;
  onTestEnd?(testName: string, result: TestResult): Promise<void>;
  onDispose?(): Promise<void>;
}
