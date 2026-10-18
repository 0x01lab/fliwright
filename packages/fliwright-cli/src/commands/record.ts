import { resolveVmUrl } from '../vm-discovery.js';
import { resolveProjectConfig } from '../config.js';
import { verifyRecordingReplay } from '../RecordingReplay.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { copyRecordingArtifacts, applyDartVerification, parseDartVerificationEvidence, fingerprintScenario, generateRecordingAutomation, buildFlowFromRecording, captureRecording, openRecordingCapture, ScenarioResolver, EndpointLeaseManager } from '@fliwright/core';
import type { CodegenOptions, DartVerificationEvidence, FliwrightFlowDocument, FliwrightPathsConfig, RecordedOperation, RecordingFrame } from '@fliwright/core';
import type { RecordingCaptureResource, RecordingReadinessResult, RecordingResult, RecordingCheckpointCandidate } from '@fliwright/core';
import type { RecordingManifest, GenerateRecordingAutomationOptions, ResolvedSelector } from '@fliwright/core';

export interface RecordOptions {
  durationMs?: number;
  print?: boolean;
  vmUrl?: string;
  output?: string;
  flowOutput?: string;
  lang?: 'ts' | 'dart';
  dartAppEntrypoint?: string;
  testName?: string;
  resetToHomeBeforeEach?: boolean;
  homeRoute?: string;
  cwd?: string;
  mode?: 'script' | 'test';
  scenario?: string;
  assertions?: string;
  verify?: boolean;
  signal?: AbortSignal;
  dartVerification?: DartVerificationEvidence;
  dartVerificationFile?: string;
}

export interface RecordResult {
  code: string;
  operations: RecordedOperation[];
  flow: FliwrightFlowDocument;
  readiness: RecordingReadinessResult;
  recordingPath?: string;
  blockers: string[];
  recording: RecordingResult;
  checkpoints: RecordingCheckpointCandidate[];
}

export interface RecordDeps {
  resolveVmUrl?: (options: { cliFlag?: string; configUrl?: string; cwd?: string; verify?: boolean }) => Promise<string | null>;
  openCapture?: (vmUrl: string) => Promise<RecordingCaptureResource>;
  /** An adapter stop source; the signal removes its listeners after capture. */
  waitForStop?: (signal: AbortSignal) => Promise<void>;
  /** Optional explicit replay hook supplied by CLI/IDE integrations. */
  verifyRecording?: (input: {
    code: string;
    scenario: string;
    scenarioFingerprint?: string;
    operations: readonly RecordedOperation[];
  }) => Promise<{ passed: boolean; verifiedRunId?: string; issues?: string[] }>;
}

export async function recordCommand(
  options: RecordOptions,
  deps: RecordDeps = {},
): Promise<RecordResult> {
  const cwd = options.cwd ?? process.cwd();
  const dartVerification = options.dartVerificationFile
    ? parseDartVerificationEvidence(JSON.parse(await readFile(resolve(cwd, options.dartVerificationFile), 'utf8')))
    : options.dartVerification;
  const config = await resolveProjectConfig(cwd);
  const resolver = deps.resolveVmUrl ?? resolveVmUrl;
  const vmUrl = await resolver({ cliFlag: options.vmUrl, configUrl: config.vmServiceUrl, cwd, verify: true });

  if (!vmUrl) {
    throw new Error(
      'Could not find a running Flutter VM Service.\n\n' +
      '   Start your Flutter app first: flutter run\n' +
      '   Then re-run: fliwright record\n' +
      '   Or specify: fliwright record --vm-url ws://127.0.0.1:8181/ws',
    );
  }

  const lang = options.lang ?? 'ts';
  const testName = options.testName ?? 'recorded test';
  const mode = options.mode ?? 'script';
  let scenarioFingerprint: string | undefined;
  let scenarioIssue: string | undefined;
  if (options.scenario) {
    try {
      scenarioFingerprint = fingerprintScenario(new ScenarioResolver(config.scenarios ?? {}).resolve(options.scenario));
    } catch {
      scenarioIssue = `unknown deterministic scenario '${options.scenario}'`;
    }
  }
  const generatedTarget = options.output ? resolve(cwd, options.output)
    : defaultGeneratedTarget(cwd, mode, testName, lang, config.paths);

  const log = options.print === false ? () => {} : console.error;
  log('Recording... Press Ctrl+C to stop.');

  const checkpointInput = options.assertions
    ? await readCheckpointFile(resolve(cwd, options.assertions))
    : undefined;
  const codegenOptions: CodegenOptions = {
    lang, testName, mode,
    dartAppEntrypoint: options.dartAppEntrypoint,
    resetToHomeBeforeEach: options.resetToHomeBeforeEach ?? lang === 'ts',
    homeRoute: options.homeRoute,
  };
  const lease = await recordingLeases.acquire(vmUrl, { signal: options.signal });
  const captured = await lease.run(() => captureRecording({
    open: () => (deps.openCapture ?? openRecordingCapture)(vmUrl),
    signal: options.signal,
    durationMs: options.durationMs,
    waitForStop: deps.waitForStop ?? waitForSigint,
    start: {
      captureScreenshots: true,
      filterNoise: true,
      onOperation: (op, index) => {
        // Input contents may be sensitive. Progress only needs the action kind.
        log(`  ${index + 1}. ${op.kind}`);
      },
    },
    generate: codegenOptions,
  })).finally(() => lease.release());
  const generated = generateRecordingAutomation(captured, {
    ...codegenOptions, checkpoints: checkpointInput, scenarioName: options.scenario, scenarioFingerprint,
  });
  const recordingResult = generated.recording;
  const { code: finalCode, operations, frames } = recordingResult;
  const flow = buildFlowFromRecording({
    frames,
    operations,
    testName,
    targetFile: generatedTarget,
  });

  const readiness = generated.readiness;
  let verifiedRunId: string | undefined;
  let replayRunId: string | undefined;
  const blockers = [
    ...readiness.issues,
    ...((mode === 'test' || options.verify) && scenarioIssue ? [scenarioIssue] : []),
  ];
  // Preserve the capture before any subprocess or verifier can fail.
  const persisted = { mode, testName, readiness, operations, frames,
    code: finalCode, flow, result: recordingResult, checkpoints: generated.checkpoints,
    artifactDirectory: captured.artifactDirectory, createdAt: new Date().toISOString(), recordedSelectors: [...captured.selectors],
    generationOptions: { ...codegenOptions, checkpoints: generated.checkpoints, scenarioName: options.scenario, scenarioFingerprint } };
  const recordingPath = await persistRecording(options, persisted, resolve(cwd, config.paths.recordings));
  if (options.verify) {
    if (!options.scenario) {
      blockers.push('verification requires a deterministic scenario');
    } else if (lang === 'dart' && !dartVerification) {
      blockers.push('Dart verification requires its own compilation and Flutter run; provide dartVerification evidence before publishing');
    } else if (lang === 'dart') {
      // Dart evidence comes from its own compiler and Flutter run; never use the TS replay verifier.
    } else if (blockers.length === 0) {
      const verify = deps.verifyRecording ?? ((input) => verifyRecordingReplay({ ...input,
        cwd, vmUrl, mode, directory: recordingPath, signal: options.signal,
        capture: { ...captured, recording: recordingResult },
      }));
      const verification = await verify({
        code: finalCode,
        scenario: options.scenario,
        scenarioFingerprint,
        operations,
      });
      replayRunId = 'replayRunId' in verification ? verification.replayRunId as string | undefined : verification.verifiedRunId;
      if (verification.passed) {
        if (verification.verifiedRunId) verifiedRunId = verification.verifiedRunId;
        else blockers.push('verification did not return a run identity');
      } else {
        blockers.push(...(verification.issues ?? ['recording replay verification failed']));
      }
    }
  }
  let finalReadiness: RecordingReadinessResult = {
    ...readiness,
    readiness: blockers.length > 0 ? 'draft' : verifiedRunId ? 'verified' : readiness.readiness,
    ...(verifiedRunId ? { verifiedRunId } : {}),
    ...(replayRunId ? { replayRunId } : {}),
    issues: blockers,
  };
  if (lang === 'dart' && dartVerification) {
    finalReadiness = applyDartVerification(finalReadiness, dartVerification);
  }
  const finalBlockers = finalReadiness.issues;

  await persistRecording(options, { ...persisted, readiness: finalReadiness }, resolve(cwd, config.paths.recordings), recordingPath);

  const canWriteAutomation = finalReadiness.readiness !== 'draft';
  if (generatedTarget && canWriteAutomation) {
    await mkdir(dirname(generatedTarget), { recursive: true });
    await writeFile(generatedTarget, finalCode, 'utf8');
    log(`\n✅ Automation written to ${generatedTarget}`);
  } else if (generatedTarget && !canWriteAutomation) {
    log(`\n⚠️  Recording was kept as a draft because recording is not ready: ${finalBlockers.join('; ')}`);
  }

  if (options.flowOutput) {
    const flowPath = resolve(cwd, options.flowOutput);
    await mkdir(dirname(flowPath), { recursive: true });
    await writeFile(flowPath, `${JSON.stringify(flow, null, 2)}\n`, 'utf8');
    log(`\n✅ Flow written to ${options.flowOutput}`);
  }

  return {
    code: finalCode,
    operations,
    flow,
    readiness: finalReadiness,
    ...(recordingPath ? { recordingPath } : {}),
    blockers: finalBlockers,
    recording: recordingResult,
    checkpoints: generated.checkpoints,
  };
}

function defaultGeneratedTarget(root: string, mode: 'script' | 'test', testName: string, lang: 'ts' | 'dart', paths: FliwrightPathsConfig): string {
  const directory = mode === 'test' ? paths.tests : paths.scripts;
  const suffix = lang === 'dart' ? '.dart' : mode === 'test' ? '.test.ts' : '.script.ts';
  return resolve(root, directory, `${safeName(testName)}${suffix}`);
}

async function readCheckpointFile(path: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (typeof parsed === 'object' && parsed !== null && 'assertions' in parsed) return parsed.assertions;
  return parsed;
}

async function persistRecording(
  options: RecordOptions,
  input: {
    mode: 'script' | 'test';
    testName: string;
    readiness: RecordingReadinessResult;
    operations: RecordedOperation[];
    frames: RecordingFrame[];
    code: string;
    flow: FliwrightFlowDocument;
    result: RecordingResult;
    checkpoints: RecordingCheckpointCandidate[];
    artifactDirectory?: string;
    createdAt: string;
    recordedSelectors: Array<[number, ResolvedSelector]>;
    generationOptions: GenerateRecordingAutomationOptions;
  },
  recordingsRoot: string,
  existingDirectory?: string,
): Promise<string> {
  const recordingId = `${safeName(input.testName)}-${randomUUID()}`;
  const dir = existingDirectory ?? join(recordingsRoot, recordingId);
  await mkdir(dir, { recursive: true });
  await copyRecordingArtifacts(input.result, input.artifactDirectory, dir);
  await writeFile(`${dir}/recording.json`, JSON.stringify({
    schemaVersion: 2,
    id: basename(dir),
    createdAt: input.createdAt, updatedAt: new Date().toISOString(),
    rawEventCount: input.result.eventCache?.eventCount ?? input.result.receivedSequences.length,
    operationCount: input.operations.length,
    mode: input.mode,
    testName: input.testName,
    readiness: input.readiness,
    frames: input.frames,
    flow: input.flow,
    recording: input.result,
    generatedCode: input.code,
    recordedSelectors: input.recordedSelectors,
    generationOptions: input.generationOptions,
    checkpoints: input.checkpoints,
  } satisfies RecordingManifest, null, 2) + '\n', 'utf8');
  await writeFile(`${dir}/blockers.json`, JSON.stringify(input.readiness.issues, null, 2) + '\n', 'utf8');
  await writeFile(`${dir}/draft.${options.lang === 'dart' ? 'dart' : input.mode === 'test' ? 'test.ts' : 'script.ts'}`, input.code, 'utf8');
  return dir;
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'recording';
}

function waitForSigint(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const cleanup = () => {
      process.removeListener('SIGINT', stop);
      signal.removeEventListener('abort', cleanup);
    };
    const stop = () => {
      cleanup();
      console.error('Stopping recording...');
      resolve();
    };
    if (signal.aborted) return resolve();
    process.once('SIGINT', stop);
    signal.addEventListener('abort', cleanup, { once: true });
  });
}

const recordingLeases = new EndpointLeaseManager();
