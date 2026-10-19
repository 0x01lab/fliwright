export {
  parseVitestOutput,
  runCommand,
  runVitest,
  finalizeRunArtifacts,
  RunFinalizationError,
  type RunOptions,
  type RunDeps,
} from './commands/run.js';

export type {
  CliFailureEntry,
  CliRunArtifacts,
  CliRunResult,
  CliTestResult,
} from './reporter.js';

export { verifyRecordingReplay, type RecordingReplayOptions, type RecordingReplayResult } from './RecordingReplay.js';

export { artifactsExportCommand, artifactsShowCommand, type ArtifactOptions } from './commands/artifacts.js';
export { artifactReferences, type ArtifactReference } from './ArtifactReferences.js';
