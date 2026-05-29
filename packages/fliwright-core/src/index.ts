export type {
  ProviderInfo,
  WidgetInfo,
  WidgetSnapshot,
  HealingResult,
  MockResponse,
  WidgetMatch,
  TestResult,
  VMServiceEvent,
  ProtocolMessage,
} from './types.js';

export type { FliwrightPlugin, PluginContext } from './interfaces/Plugin.js';
export type { StateAdapter } from './interfaces/StateAdapter.js';
export type { MockAdapter } from './interfaces/MockAdapter.js';
export type { FinderStrategy } from './interfaces/FinderStrategy.js';
export type { HealingStrategy } from './interfaces/HealingStrategy.js';

export { PluginRegistry } from './PluginRegistry.js';
export { Protocol } from './Protocol.js';
