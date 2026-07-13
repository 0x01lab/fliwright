export type {
  ProviderInfo,
  WidgetInfo,
  KeyedAncestor,
  ResolvedSelector,
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
  IconSelector,
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
  FormRuleAction,
  FormActionLocator,
  FormActionScriptContext,
  FormActionScript,
  FormRuleDataEntry,
  FormDataScenarioValue,
  FormDataScenario,
  FormSkill,
  FormRule,
  FormRulesFile,
  MockRuleBase,
  MockRule,
  MockRuleOverride,
  MockEndpointConfig,
  NormalizedMockEndpointConfig,
  MockIndex,
  MockRuleEntry,
  BridgeContext,
  SourceLocation,
  SourceMapNode,
  SourceMapOptions,
  SourceMapResult,
  BridgeQuery,
  BridgeQueryMatch,
  BridgeQueryResult,
  FrameCaptureResult,
} from './types.js';
export type {
  FliwrightFigmaBinding,
  FliwrightFlowDecisionRule,
  FliwrightFlowDocument,
  FliwrightFlowEdge,
  FliwrightFlowNode,
  FliwrightFlowNodeType,
  FliwrightFlowPosition,
  FliwrightFlowScreenshotRef,
  FliwrightFlowSource,
  FliwrightFlowSourceKind,
  FliwrightFlowViewport,
  RecordingToFlowInput,
  RecordingToFlowOptions,
  TimelineToFlowInput,
  TimelineToFlowOptions,
} from './flow/types.js';
export { buildFlowFromRecording } from './flow/RecordingFlowBuilder.js';
export { buildFlowFromTimeline } from './flow/TimelineFlowBuilder.js';
export {
  FLIWRIGHT_FLOWS_DIR,
  flowFileName,
  flowFilePath,
  sanitizeFlowFileId,
} from './flow/FlowFile.js';
export { figmaBindingFromUrl, parseFigmaUrl } from './flow/FigmaBinding.js';
export type { ParsedFigmaUrl } from './flow/FigmaBinding.js';
export { buildFlowAgentSpec } from './flow/FlowAgentSpec.js';
export type { FlowAgentImplementationPlan, FlowAgentSpec, FlowAgentSpecNode } from './flow/FlowAgentSpec.js';
export { buildFlowReviewPlan } from './flow/FlowReviewPlan.js';
export type { FlowReviewPlan, FlowReviewPlanOptions, FlowReviewTarget } from './flow/FlowReviewPlan.js';
export { buildFlowReviewBundle } from './flow/FlowReviewBundle.js';
export type { FlowReviewBundle, FlowReviewBundleOptions, FlowReviewFigmaCaptureTask } from './flow/FlowReviewBundle.js';
export { captureFigmaReviewScreenshots, FigmaRestScreenshotProvider } from './flow/FigmaRestScreenshotProvider.js';
export type { FigmaRestScreenshotProviderOptions, FigmaScreenshotProvider } from './flow/FigmaRestScreenshotProvider.js';
export { buildFlowReviewReport } from './flow/FlowReviewReport.js';
export type {
  FlowReviewArtifactInput,
  FlowReviewComparisonInput,
  FlowReviewItemStatus,
  FlowReviewReport,
  FlowReviewReportInput,
  FlowReviewReportItem,
} from './flow/FlowReviewReport.js';
export {
  buildFlowVisualComparisons,
  compareDecodedPngs,
  compareFlowScreenshots,
} from './flow/FlowVisualDiff.js';
export type {
  DecodedPng,
  FlowVisualDiffInput,
  FlowVisualDiffOptions,
} from './flow/FlowVisualDiff.js';
export { generateFlowTestSkeleton } from './flow/FlowTestGenerator.js';
export type { FlowTestGeneratorOptions } from './flow/FlowTestGenerator.js';
export { applyFlowCleanPlan, buildFlowCleanPrompt, cleanFlowWithAi } from './flow/FlowCleaner.js';
export type {
  FlowCleanOptions,
  FlowCleanPlan,
  FlowCleanReason,
  FlowCleanResult,
  RawFlowCleanPlan,
} from './flow/FlowCleaner.js';
export { validateFlow } from './flow/FlowValidator.js';
export type {
  FlowValidationIssue,
  FlowValidationOptions,
  FlowValidationResult,
  FlowValidationSeverity,
} from './flow/FlowValidator.js';

export type { FliwrightPlugin, PluginContext } from './interfaces/Plugin.js';
export type { StateAdapter } from './interfaces/StateAdapter.js';
export type { MockAdapter } from './interfaces/MockAdapter.js';
export type { FinderStrategy } from './interfaces/FinderStrategy.js';
export type { HealingStrategy } from './interfaces/HealingStrategy.js';

export { PluginRegistry } from './PluginRegistry.js';
export { Protocol } from './Protocol.js';
export { VMServiceConnector, setConnectorDebugLog } from './VMServiceConnector.js';
export { AppInstance } from './AppInstance.js';
export type {
  AppCapabilityDescriptor,
  AppCapabilityProxy,
  AppEnvironment,
  AppInfo,
  AppSnapshot,
  AuthCapability,
  AuthStatus,
} from './AppInstance.js';
export { FliwrightDriver } from './Driver.js';
export type { DriverOptions } from './Driver.js';
export {
  FLIWRIGHT_WORKSPACE_CONFIG_PATH,
  clearWorkspaceVmServiceUrl,
  readWorkspaceConfig,
  readWorkspaceConfigSync,
  workspaceConfigPath,
  writeWorkspaceConfig,
  writeWorkspaceVmServiceUrl,
} from './WorkspaceConfig.js';
export type { FliwrightWorkspaceConfig } from './WorkspaceConfig.js';

export { Page } from './Page.js';
export type {
  NavigationWaitUntil,
  PageNavigationOptions,
  PageViewport,
  PullToRefreshOptions,
  PullToRefreshResult,
  ResetToHomeOptions,
} from './Page.js';
export { SelectController, builtInSelectRecipes } from './SelectRecipes.js';
export type { SelectRecipe, SelectRecipeContext, SelectRecipeUseOptions } from './SelectRecipes.js';
export { Locator } from './Locator.js';
export { Selector } from './Selector.js';
export { Assertion, AssertionError, createExpect } from './Assertion.js';
export type { AssertionOptions, AssertionTimelineOptions } from './Assertion.js';
export { FailureCollector } from './FailureCollector.js';
export { TraceCollector, isActionMethod, TraceStore } from './TraceCollector.js';
export type { TraceStep, TraceMeta, TraceData, TraceMode } from './TraceCollector.js';
export {
  FLIWRIGHT_RUNS_ROOT_ENV,
  ensureFliwrightRunsRoot,
  legacyProjectRunsRoot,
  projectRunsRoot,
  projectRunsRootCandidates,
  resolveFliwrightRunsRoot,
  sanitizeProjectPathName,
} from './runArtifacts.js';
export type {
  EnsureFliwrightRunsRootOptions,
  ProjectRunsRootResult,
  ResolveFliwrightRunsRootOptions,
} from './runArtifacts.js';
export { EventAggregator } from './EventAggregator.js';
export {
  CompactLogFormatter,
  ConsoleLogSink,
  FileLogSink,
  JsonLogFormatter,
  JsonlLogSink,
  MemoryLogSink,
  MultiLogSink,
  PrettyLogFormatter,
  StructuredLogger,
  createNoopLogger,
  normalizeLogError,
} from './logging.js';
export type {
  FliwrightLogError,
  FliwrightLogEvent,
  FliwrightLogInput,
  FliwrightLogKind,
  FliwrightLogLevel,
  FliwrightLogMode,
  FliwrightLogStatus,
  FliwrightLogger,
  FliwrightLoggerOptions,
  LogFormatter,
  LogSink,
  PrettyLogFormatterOptions,
} from './logging.js';
export { CodeGenerator } from './CodeGenerator.js';
export { MockManager } from './MockManager.js';
export { MockRuleStore, normalizeMockEndpointConfig } from './MockRuleStore.js';
export { ToolMockServer } from './ToolMockServer.js';
export type { ToolMockRequest, ToolMockResult, ToolMockServerOptions } from './ToolMockServer.js';
export { RecorderController } from './RecorderController.js';
export type { RecorderStartOptions } from './RecorderController.js';
export { SnapshotStore } from './SnapshotStore.js';
export { SelfHealingEngine } from './SelfHealingEngine.js';
export { MultiDimensionalHealingStrategy, ngramSimilarity } from './strategies/MultiDimensionalHealingStrategy.js';
export { FormHelper } from './FormHelper.js';
export { builtInFormActionScripts } from './FormActionScripts.js';
export { SemanticInferrer } from './SemanticInferrer.js';
export { FakerGenerator } from './FakerGenerator.js';
export { SkillRegistry } from './SkillRegistry.js';
export { JsonRuleLoader } from './JsonRuleLoader.js';
export { SelectorResolver, buildBaseSelector } from './SelectorResolver.js';
export { serializeSelectorQuery } from './SelectorSerializer.js';
export { RecordedSelectorResolver } from './RecordedSelectorResolver.js';
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
export type {
  AiResponseFormat,
  AiProviderName,
  AiCacheMode,
  JsonSchemaType,
  JsonSchema,
  AiImageInput,
  AiFileInput,
  AiRequest,
  AiGenerateRequest,
  AiVisionOptions,
  AiVisibleOptions,
  AiInspectRequest,
  AiClassifyRequest,
  AiResponse,
  AiAdapterResponse,
  AiInvocationContext,
  AiAdapter,
  AiRuntimeContext,
  AiCallContext,
  AiRuntimeConfig,
  AiCliAdapterOptions,
  AiArtifactMeta,
} from './ai/types.js';
export {
  AiInvocationError,
  AiDisabledError,
  AiTimeoutError,
  AiParseError,
  AiSchemaValidationError,
  AiAssertionError,
} from './ai/errors.js';
export { validateJsonSchema } from './ai/AiSchemaValidator.js';
export { AiArtifactStore } from './ai/AiArtifactStore.js';
export type { AiArtifactPathInput } from './ai/AiArtifactStore.js';
export { MockAiAdapter } from './ai/adapters/MockAiAdapter.js';
export type { MockAiAdapterHandler, MockAiAdapterItem } from './ai/adapters/MockAiAdapter.js';
export { AiRuntime } from './ai/AiRuntime.js';
export { CliJsonAdapter } from './ai/adapters/CliJsonAdapter.js';
export { ClaudeCliAdapter } from './ai/adapters/ClaudeCliAdapter.js';
export { CodexCliAdapter } from './ai/adapters/CodexCliAdapter.js';
export { resolveAiConfig } from './ai/config.js';
export { ai, configureAi } from './ai/capability.js';

export type {
  AgentPolicy,
  AgentVisibleFailure,
  CodeRef,
  TimelineArtifactRef,
  TimelineData,
  TimelineNode,
  TimelineNodeKind,
  TimelineNodeStartOptions,
  TimelineNodeStatus,
  TimelineRecorderOptions,
  TimelineRunMode,
  TimelineRunStatus,
} from './timeline/types.js';
export { TimelineRecorder } from './timeline/TimelineRecorder.js';
export { TimelineArtifactStore } from './timeline/TimelineArtifactStore.js';
export type { TimelineArtifactStoreOptions } from './timeline/TimelineArtifactStore.js';
export {
  TIMELINE_ARTIFACT_KIND_AI,
  TIMELINE_ARTIFACT_KIND_DIAGNOSTICS,
  TIMELINE_ARTIFACT_KIND_LOG,
  TIMELINE_ARTIFACT_KIND_SCREENSHOT,
  TIMELINE_ARTIFACT_KIND_SNAPSHOT,
  TIMELINE_ARTIFACT_KIND_TRACE,
  TIMELINE_ARTIFACTS_DIR,
  TIMELINE_DIAGNOSTICS_DIR,
  TIMELINE_FILE_NAME,
  TIMELINE_LOG_EVENTS_FILE,
  TIMELINE_LOGS_DIR,
  TIMELINE_SCREENSHOTS_DIR,
  TIMELINE_SNAPSHOTS_DIR,
  TIMELINE_TRACE_DIR,
  TIMELINE_TRACE_FILE,
} from './timeline/constants.js';
export { FlowRuntime, createAgentFailure, wrapAgentError } from './timeline/FlowRuntime.js';
export type { FlowFrameOptions, FlowManualOptions, FlowRuntimeOptions } from './timeline/FlowRuntime.js';
export { FliwrightAgentError } from './agent/FliwrightAgentError.js';
export { AgentRuntime } from './agent/AgentRuntime.js';
export type { AgentRuntimeOptions } from './agent/AgentRuntime.js';
export { PassiveAgent } from './agent/PassiveAgent.js';
export type { AgentDiagnosis, PassiveAgentContext, PassiveAgentOptions } from './agent/PassiveAgent.js';
export { AgentRepair } from './agent/AgentRepair.js';
export type { AgentRepairOptions, RepairProposal, RepairResult, SafeRepairAction } from './agent/AgentRepair.js';
export { MockRuntime, matchesCall } from './mocks/MockRuntime.js';
export { FliwrightMockService, mock } from './mocks/MockService.js';
export {
  MockRuleController,
  mockRuleController,
  mockRuleRouteId,
} from './mocks/MockRuleController.js';
export type {
  FlutterMockRouteTarget,
  FlutterMockRouteSummary,
  MockRuleRouteResponse,
  ParsedMockRuleRouteId,
} from './mocks/MockRuleController.js';
export type { FliwrightMockServiceOptions } from './mocks/MockService.js';
export type {
  ActivateMockRule,
  ActivateMockRulesOptions,
  MockBackend,
  MockTimelineMetadata,
  NormalizedMockCall,
  NormalizedRequestMatcher,
  TimelineMockResponse,
  WaitForMockCallOptions,
} from './mocks/types.js';
