export type { AppHandle, AppStartParams, DaemonMessage, DaemonTransport } from './daemon/DaemonTransport.js';
export { FlutterDaemonController } from './daemon/FlutterDaemonController.js';
export { FlutterDaemonEndpointSource } from './daemon/FlutterDaemonEndpointSource.js';
export type { FlutterDaemonEndpointSourceOptions } from './daemon/FlutterDaemonEndpointSource.js';
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
export { TddRuntime } from './runtime/TddRuntime.js';
export { PersistentTestExecutor } from './executor/PersistentTestExecutor.js';
export type { BootOptions, TestRunOutcome } from './executor/PersistentTestExecutor.js';
export { defaultArtifactsRoot, defaultStatusFilePath } from './executor/PersistentTestExecutor.js';
export { focusAndRerun } from './executor/FocusedRerunRecipe.js';
export { collectResultsFromModules } from './executor/TestRunResults.js';
export type { CollectedResult } from './executor/TestRunResults.js';
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
export type {
  CycleOpts,
  ResetAdapterResult,
  ResetCategory,
  ResetReport,
  RuntimeSnapshot,
  BaselineConfig,
  StartOpts,
  TddCycleResult,
  TddSyncResult,
  TddRuntimeDeps,
} from './types.js';
