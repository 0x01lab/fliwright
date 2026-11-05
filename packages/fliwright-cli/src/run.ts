export {
  parseVitestOutput,
  runCommand,
  runVitest,
  finalizeRunArtifacts,
  RunFinalizationError,
  type RunOptions,
  type RunDeps,
} from './commands/run.js';
export { prepareNativeRun, type ManagedNativeRun, type ManagedNativeGrant, type ManagedNativeLaunch } from './ManagedNativeRun.js';
export { ManagedNativeTelemetry, type ManagedNativePhase, type ManagedNativePhaseEvent, type ManagedNativePhaseObserver } from './ManagedNativeTelemetry.js';
export { startManagedAppControl } from './ManagedAppRun.js';
export { withFlutterAndroidApk, type FlutterAndroidBuildOptions, type FlutterAndroidApk } from './FlutterAndroidBuild.js';
export type { DeviceMetadata } from './DeviceMetadata.js';

export type {
  CliFailureEntry,
  CliRunArtifacts,
  CliRunResult,
  CliTestResult,
} from './reporter.js';

export { verifyRecordingReplay, type RecordingReplayOptions, type RecordingReplayResult } from './RecordingReplay.js';

export { artifactsExportCommand, artifactsShowCommand, type ArtifactOptions } from './commands/artifacts.js';
export { artifactReferences, type ArtifactReference } from './ArtifactReferences.js';
export { artifactsReportCommand } from './commands/artifact-report.js';
export { releaseMetadataSchema, releaseReviewSchema, type ReleaseMetadata, type ReleaseReview } from './ReleaseReview.js';

export { collectCatalog, collectedCases, catalogCaseId, type CatalogCase, type CatalogSelection } from './catalog.js';
