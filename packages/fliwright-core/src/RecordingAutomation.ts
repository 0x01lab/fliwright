import { createHash } from 'node:crypto';
import { CodeGenerator } from './CodeGenerator.js';
import { DartCodeGenerator } from './DartCodeGenerator.js';
import { prepareRecordingCheckpoints } from './RecordingCheckpoints.js';
import type { RecordingCheckpointCandidate } from './RecordingCheckpoints.js';
import type { RecordingCaptureResult } from './RecordingCapture.js';
import { assessRecordingReadiness } from './RecordingReadiness.js';
import type { RecordingReadinessResult } from './RecordingReadiness.js';
import type { RecordingResult } from './RecorderController.js';
import type { CodegenOptions } from './types.js';

export interface GenerateRecordingAutomationOptions extends Omit<CodegenOptions, 'checkpoints'> {
  checkpoints?: unknown;
  scenarioName?: string;
  scenarioFingerprint?: string;
}

export interface RecordingAutomationResult {
  recording: RecordingResult;
  readiness: RecordingReadinessResult;
  checkpoints: RecordingCheckpointCandidate[];
}

/** Generate executable confirmed checkpoints and assess the same output for every entry point. */
export function generateRecordingAutomation(
  capture: RecordingCaptureResult,
  options: GenerateRecordingAutomationOptions,
): RecordingAutomationResult {
  const prepared = prepareRecordingCheckpoints(options.checkpoints, capture.recording.operations.length);
  const mode = options.mode ?? 'script';
  const generationOptions = { ...options, mode, checkpoints: prepared.executable };
  const dart = options.lang === 'dart'
    ? new DartCodeGenerator().generateResult(capture.recording.operations, capture.selectors, generationOptions)
    : undefined;
  const code = dart?.code ?? new CodeGenerator().generate(capture.recording.operations, new Map(capture.selectors), generationOptions);
  const generationIssues = [...prepared.issues, ...(dart?.issues ?? [])];
  const recording = { ...capture.recording, code };
  const readiness = assessRecordingReadiness({
    mode, operations: recording.operations, selectors: capture.selectors, capture: recording,
    language: options.lang ?? 'ts',
    dartAppEntrypoint: options.dartAppEntrypoint,
    assertionCount: dart?.assertionCount ?? prepared.executable.length,
    scenarioName: options.scenarioName,
    scenarioFingerprint: options.scenarioFingerprint,
    contentFingerprint: createHash('sha256').update(code).digest('hex'),
  });
  if (generationIssues.length) {
    readiness.readiness = 'draft';
    readiness.issues.push(...generationIssues);
  }
  return { recording, readiness, checkpoints: prepared.candidates };
}
