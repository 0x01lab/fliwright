export type {
  ProviderInfo,
  WidgetInfo,
  WidgetSnapshot,
  HealingResult,
  MockResponse,
  MockRouteResponse,
  MockRouteConfig,
  MockCall,
  WidgetMatch,
  TestResult,
  VMServiceEvent,
  ProtocolMessage,
  SelectorInput,
  FailureContext,
  HealingReport,
} from './types.js';

export type { FliwrightPlugin, PluginContext } from './interfaces/Plugin.js';
export type { StateAdapter } from './interfaces/StateAdapter.js';
export type { MockAdapter } from './interfaces/MockAdapter.js';
export type { FinderStrategy } from './interfaces/FinderStrategy.js';
export type { HealingStrategy } from './interfaces/HealingStrategy.js';

export { PluginRegistry } from './PluginRegistry.js';
export { Protocol } from './Protocol.js';
export { VMServiceConnector } from './VMServiceConnector.js';
export { FliwrightDriver } from './Driver.js';
export type { DriverOptions } from './Driver.js';

export { Page } from './Page.js';
export { Locator } from './Locator.js';
export { Selector } from './Selector.js';
export { Assertion, AssertionError, createExpect } from './Assertion.js';
export { FailureCollector } from './FailureCollector.js';
export { MockManager } from './MockManager.js';
export { SnapshotStore } from './SnapshotStore.js';
export { SelfHealingEngine } from './SelfHealingEngine.js';
export { MultiDimensionalHealingStrategy, ngramSimilarity } from './strategies/MultiDimensionalHealingStrategy.js';
