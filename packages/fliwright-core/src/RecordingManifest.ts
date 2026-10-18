import type { RecordingResult } from './RecorderController.js';
import type { RecordingFrame, ResolvedSelector } from './types.js';
import type { FliwrightFlowDocument } from './flow/types.js';
import type { GenerateRecordingAutomationOptions } from './RecordingAutomation.js';
import type { RecordingReadinessResult } from './RecordingReadiness.js';
import type { RecordingCheckpointCandidate } from './RecordingCheckpoints.js';

/** Shared on-disk recording contract consumed by CLI and the editor. */
export interface RecordingManifest {
  schemaVersion: 2;
  id: string;
  createdAt: string;
  updatedAt: string;
  rawEventCount: number;
  operationCount: number;
  mode?: 'script' | 'test';
  testName?: string;
  targetFile?: string;
  generatedCode?: string;
  flow?: FliwrightFlowDocument;
  flowFile?: string;
  recording?: RecordingResult;
  recordedSelectors?: Array<[number, ResolvedSelector]>;
  generationOptions?: GenerateRecordingAutomationOptions;
  readiness?: RecordingReadinessResult;
  checkpoints?: RecordingCheckpointCandidate[];
  frames: RecordingFrame[];
}

/** Reject replaced manifests rather than guessing old binary payload semantics. */
export function parseRecordingManifest(text: string): RecordingManifest {
  const value = JSON.parse(text) as RecordingManifest;
  if (!value || value.schemaVersion !== 2 || typeof value.id !== 'string'
    || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))
    || !Number.isSafeInteger(value.rawEventCount) || value.rawEventCount < 0
    || !Number.isSafeInteger(value.operationCount) || value.operationCount < 0
    || !Array.isArray(value.frames)) {
    throw new Error('Unsupported or invalid recording manifest; expected schemaVersion 2.');
  }
  for (const frame of [...value.frames, ...(value.recording?.frames ?? [])]) {
    const image = frame.screenshot;
    if (image && (typeof image.path !== 'string' || image.format !== 'png'
      || !Number.isSafeInteger(image.byteLength) || image.byteLength < 0 || 'base64' in image)) {
      throw new Error('Invalid recording screenshot reference.');
    }
  }
  return value;
}
