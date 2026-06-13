export type {
  ProviderInfo,
  WidgetInfo,
  WidgetSnapshot,
  AgentFindQuery,
  AgentSnapshotOptions,
  AgentSnapshotRef,
  AgentSnapshotResult,
  RefTarget,
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
  SelectorQuery,
  MatchCriteria,
  FallbackCriteria,
  FilterCriteria,
  PositionFilter,
  SelectorAst,
  FailureContext,
  HealingReport,
  RawInputEvent,
  RecordingFrame,
  RecordingScreenshot,
  RecordedOperation,
  CodegenOptions,
  FormFieldMeta,
  FormControlType,
  FormFieldOption,
  SemanticType,
  FormFillResult,
  FormAnalyzeResult,
  FormHelperOptions,
  FormSkill,
  FormRule,
  FormRulesFile,
  MockRule,
  MockEndpointConfig,
  MockIndex,
  MockRuleEntry,
} from './types.js';

export type { FliwrightPlugin, PluginContext } from './interfaces/Plugin.js';
export type { StateAdapter } from './interfaces/StateAdapter.js';
export type { MockAdapter } from './interfaces/MockAdapter.js';
export type { FinderStrategy } from './interfaces/FinderStrategy.js';
export type { HealingStrategy } from './interfaces/HealingStrategy.js';

export { PluginRegistry } from './PluginRegistry.js';
export { Protocol } from './Protocol.js';
export { VMServiceConnector, setConnectorDebugLog } from './VMServiceConnector.js';
export { FliwrightDriver } from './Driver.js';
export type { DriverOptions } from './Driver.js';

export { Page } from './Page.js';
export { Locator } from './Locator.js';
export { Selector } from './Selector.js';
export { Assertion, AssertionError, createExpect } from './Assertion.js';
export { FailureCollector } from './FailureCollector.js';
export { TraceCollector, isActionMethod, TraceStore } from './TraceCollector.js';
export type { TraceStep, TraceMeta, TraceData, TraceMode } from './TraceCollector.js';
export { EventAggregator } from './EventAggregator.js';
export { CodeGenerator } from './CodeGenerator.js';
export { MockManager } from './MockManager.js';
export { MockRuleStore } from './MockRuleStore.js';
export { ToolMockServer } from './ToolMockServer.js';
export type { ToolMockRequest, ToolMockResult, ToolMockServerOptions } from './ToolMockServer.js';
export { RecorderController } from './RecorderController.js';
export type { RecorderStartOptions } from './RecorderController.js';
export { SnapshotStore } from './SnapshotStore.js';
export { SelfHealingEngine } from './SelfHealingEngine.js';
export { MultiDimensionalHealingStrategy, ngramSimilarity } from './strategies/MultiDimensionalHealingStrategy.js';
export { FormHelper } from './FormHelper.js';
export { SemanticInferrer } from './SemanticInferrer.js';
export { FakerGenerator } from './FakerGenerator.js';
export { SkillRegistry } from './SkillRegistry.js';
export { JsonRuleLoader } from './JsonRuleLoader.js';
export { SelectorResolver, resolveSelector } from './SelectorResolver.js';
export {
  selectorQuerySchema,
  matchCriteriaSchema,
  filterCriteriaSchema,
  fallbackCriteriaSchema,
  positionFilterSchema,
  validateSelectorQuery,
  parseSelectorJson,
} from './wire-protocol.js';
export { DartCodeGenerator } from './DartCodeGenerator.js';
export { AssertionSuggester } from './AssertionSuggester.js';
export type { AssertionSuggestion } from './AssertionSuggester.js';
