import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { copyRecordingArtifacts, fingerprintScenario, parseTimelineData, ScenarioResolver } from '@fliwright/core';
import type { RecordingCaptureResult, RunManifest, RunSessionResult } from '@fliwright/core';
import { resolveProjectConfig } from './config.js';
import { runCommand } from './commands/run.js';

export interface RecordingReplayOptions {
  code: string;
  mode?: 'script' | 'test';
  scenario: string;
  scenarioFingerprint?: string;
  cwd: string;
  vmUrl: string;
  directory?: string;
  signal?: AbortSignal;
  capture?: RecordingCaptureResult;
}

export interface RecordingReplayResult {
  passed: boolean;
  verifiedRunId?: string;
  replayRunId?: string;
  replayPath?: string;
  manifestPath?: string;
  contentFingerprint?: string;
  scenarioFingerprint?: string;
  issues: string[];
}

/** Replay the unchanged candidate once, preserving source and failed run evidence. */
export async function verifyRecordingReplay(input: RecordingReplayOptions): Promise<RecordingReplayResult> {
  const config = await resolveProjectConfig(input.cwd);
  const directory = input.directory ?? resolve(input.cwd, config.paths.recordings, `replay-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const replayPath = resolve(directory, 'replay.test.ts');
  await writeFile(replayPath, input.code, 'utf8');
  if (input.capture) {
    const { artifactDirectory, ...capture } = input.capture;
    await copyRecordingArtifacts(capture.recording, artifactDirectory, directory);
    await writeFile(join(directory, 'capture.json'), `${JSON.stringify({
      ...capture, selectors: [...capture.selectors],
    }, null, 2)}\n`, 'utf8');
  }
  let replayRunId: string | undefined;
  let manifestPath: string | undefined;
  const issues: string[] = [];
  try {
    const expectedScenario = fingerprintScenario(new ScenarioResolver(config.scenarios ?? {}).resolve(input.scenario));
    if (!input.scenarioFingerprint || input.scenarioFingerprint !== expectedScenario) {
      throw new Error('Recording scenario changed before replay.');
    }
    const run = await runCommand({ cwd: input.cwd, vmUrl: input.vmUrl,
      testPattern: replayPath, print: false, signal: input.signal,
      recordingReplay: true,
    }, { resolveVmUrl: async () => input.vmUrl });
    replayRunId = run.artifacts?.runId;
    manifestPath = run.artifacts?.manifestPath;
    if (!run.passed || run.totalTests !== 1 || run.passedTests !== 1 || !run.artifacts?.manifestPath) {
      throw new Error(`Recording replay failed (${run.status ?? 'failed'}); expected one passing test.`);
    }
    manifestPath = run.artifacts.manifestPath;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RunManifest;
    if (manifest.tests.length !== 1 || manifest.status !== 'passed') throw new Error('Recording replay has no single passing attempt.');
    const test = manifest.tests[0];
    if (test.attempts.length !== 1) throw new Error('Recording replay requires a passing first attempt without retries.');
    const resultPath = join(dirname(manifestPath), test.attempts[0].resultPath);
    const result = JSON.parse(await readFile(resultPath, 'utf8')) as RunSessionResult;
    if (result.runId !== replayRunId || result.testId !== test.testId || result.attemptId !== test.attempts[0].attemptId
      || result.attemptOutcome !== 'passed' || result.testOutcome !== 'passed' || result.expectedFailure) {
      throw new Error('Recording replay attempt identity or outcome does not match.');
    }
    const timeline = parseTimelineData(await readFile(join(dirname(resultPath), 'timeline.json'), 'utf8'));
    if ((input.mode ?? 'test') === 'test' && !timeline?.nodes.some((node) => node.kind === 'assertion' && node.status === 'passed')) {
      throw new Error('Recording replay executed no confirmed assertions.');
    }
    if (!timeline?.nodes.some((node) => node.status === 'passed'
      && node.metadata?.scenarioName === input.scenario
      && node.metadata?.scenarioFingerprint === expectedScenario)) {
      throw new Error('Recording replay did not apply the bound scenario.');
    }
    const after = await resolveProjectConfig(input.cwd);
    if (fingerprintScenario(new ScenarioResolver(after.scenarios ?? {}).resolve(input.scenario)) !== expectedScenario
      || digest(await readFile(replayPath, 'utf8')) !== digest(input.code)) {
      throw new Error('Recording content or scenario changed during replay.');
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  const result: RecordingReplayResult = { passed: issues.length === 0 && !!replayRunId,
    replayRunId, replayPath, manifestPath, issues,
    contentFingerprint: digest(input.code), scenarioFingerprint: input.scenarioFingerprint,
    ...(issues.length === 0 && replayRunId ? { verifiedRunId: replayRunId } : {}),
  };
  await writeFile(join(directory, 'verification.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

function digest(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
