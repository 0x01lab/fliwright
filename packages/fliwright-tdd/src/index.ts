export type { AppHandle, AppStartParams, DaemonMessage, DaemonTransport } from './daemon/DaemonTransport.js';
export { FlutterDaemonController } from './daemon/FlutterDaemonController.js';
export { SubprocessDaemonTransport, parseDaemonLines } from './daemon/SubprocessDaemonTransport.js';
export {
  decideSync,
  isStructuralFileChange,
  looksStructuralAfterReload,
} from './daemon/ReloadStrategy.js';
export type { SyncDecision } from './daemon/ReloadStrategy.js';
export type { SubprocessDaemonTransportOptions } from './daemon/SubprocessDaemonTransport.js';
export { BaselineManager } from './baseline/BaselineManager.js';
export type {
  ResetAdapter,
  ResetContext,
  StorageResetOutcome,
} from './baseline/BaselineManager.js';
export {
  AuthTokensResetAdapter,
  LocalDbResetAdapter,
  SecureStorageResetAdapter,
  StorageBackedResetAdapters,
  StorageResetAdapter,
} from './baseline/StorageResetAdapter.js';
export {
  AppCapabilityResetAdapters,
  IsolatesResetAdapter,
  PermissionsResetAdapter,
  TimersResetAdapter,
  WebviewResetAdapter,
} from './baseline/AppCapabilityResetAdapter.js';
export { TddRepairPlanner } from './repair/TddRepairPlanner.js';
export type { TddRepairPlannerOptions } from './repair/TddRepairPlanner.js';
export { TddRuntime } from './runtime/TddRuntime.js';
export { PersistentTestExecutor } from './executor/PersistentTestExecutor.js';
export type { BootOptions, TestRunOutcome } from './executor/PersistentTestExecutor.js';
export { defaultArtifactsRoot, defaultStatusFilePath } from './executor/PersistentTestExecutor.js';
export { focusAndRerun } from './executor/FocusedRerunRecipe.js';
export { ResultReporter, collectResultsFromFiles } from './executor/ResultReporter.js';
export type { CollectedResult } from './executor/ResultReporter.js';
export { buildTddFailureContext, classifyFailure } from './diagnostics/TddFailureContext.js';
export type {
  BuildTddFailureContextInput,
  TddFailureArtifacts,
  TddFailureAssertion,
  TddFailureContext,
  TddFailureKind,
  TddRecoveryHint,
  TddRecoveryHintKind,
  TddFailureSource,
} from './diagnostics/TddFailureContext.js';
export { generateRedFirstTest, generateRedFirstTestSuite } from './generator/RedFirstTestGenerator.js';
export type {
  GenerateRedFirstTestResult,
  GenerateRedFirstTestSuiteResult,
  RedFirstTestGeneratorOptions,
  RedFirstTestSuiteGeneratorOptions,
} from './generator/RedFirstTestGenerator.js';
export { prepareRedFirstWorkflow } from './workflow/RedFirstWorkflow.js';
export type {
  PrepareRedFirstWorkflowResult,
  RedFirstWorkflowContext,
  RedFirstWorkflowOptions,
  RedFirstWorkflowPlan,
  RedFirstWorkflowStatus,
} from './workflow/RedFirstWorkflow.js';
export {
  bestLocatorHint,
  synthesizeSelector,
  synthesizeSelectorsForElements,
} from './selectors/SelectorSynthesizer.js';
export type {
  SelectorCandidate,
  SelectorSynthesisResult,
  SelectorSynthesisStatus,
  SelectorTraceStep,
  WidgetCandidate,
} from './selectors/SelectorSynthesizer.js';
export type {
  InteractionSpec,
  InteractionSpecValidationIssue,
  InteractionSpecValidationResult,
  LocatorHint,
  SpecAssertion,
  SpecElement,
  SpecElementRole,
  SpecFlow,
  SpecStep,
} from './spec/InteractionSpec.js';
export {
  InteractionSpecValidationError,
  parseInteractionSpec,
  validateInteractionSpec,
} from './spec/InteractionSpec.js';
export { analyzeInteractionSpecCoverage } from './spec/InteractionSpecCoverage.js';
export type {
  InteractionSpecCoverageGap,
  InteractionSpecCoverageGapKind,
  InteractionSpecCoverageReport,
} from './spec/InteractionSpecCoverage.js';
export type {
  CycleOpts,
  ResetAdapterResult,
  ResetCategory,
  ResetReport,
  RuntimeSnapshot,
  Scenario,
  StartOpts,
  TddCycleResult,
  TddSyncResult,
  TddRepairCycleResult,
  TddRepairOpts,
  TddRepairPlan,
  TddRepairPlannerLike,
  TddRepairProposalEntry,
  TddRepairStep,
  TddRepairTrace,
  TddRuntimeDeps,
} from './types.js';
