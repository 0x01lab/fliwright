#!/usr/bin/env node

// Run against recording_fixture_main.dart after building core. This exercises
// real logical actions and evidence writes, separately from Vitest persistence
// and from native pointer/keyboard recording acceptance.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import { platform, release, arch } from 'node:os';
import {
  FliwrightDriver, Page, RunSession, TimelineRecorder, TimelineArtifactStore,
  createExpect, projectRunTrace,
} from '../packages/fliwright-core/dist/index.js';

const args = process.argv.slice(2);
const value = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const positiveInteger = (name, fallback) => {
  const parsed = Number(value(name, fallback));
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`--${name} must be a positive integer.`);
  return parsed;
};
const actions = positiveInteger('actions', 10);
const repetitions = positiveInteger('repetitions', 3);
const output = resolve(value('output', '/tmp/fliwright-real-vm-recording-benchmark'));
const endpoint = process.env.FLIWRIGHT_VM_SERVICE_URL ?? process.env.FLIWRIGHT_VM_URL;
if (!endpoint) throw new Error('Set FLIWRIGHT_VM_SERVICE_URL to the controlled recording fixture VM.');

const modes = ['off', 'standard', 'full'];
const samples = Object.fromEntries(modes.map((mode) => [mode, []]));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  evidence: 'real-flutter-vm-core-benchmark',
  platform: { platform: platform(), release: release(), arch: arch() },
  flutterVersion: value('flutter-version', 'not supplied'),
  endpointClass: 'Dart VM Service',
  actions, repetitions, modes: {},
  scope: 'Real VM logical actions and capture/write timings through core RunSession. Excludes Vitest progress/journal persistence, native input recording, cache bounds and ten-minute recording stability.',
  status: 'running',
};
const driver = new FliwrightDriver();
await mkdir(output, { recursive: true });
try {
  await driver.connect(endpoint);
  report.dartSdk = driver.sdkVersion;
  report.viewport = await driver.page.viewport();
  const initialText = (await driver.page.getByKey('counter_value').resolve()).text;
  const match = /^Count: (\d+)$/.exec(initialText ?? '');
  if (!match) throw new Error('Open the controlled recording fixture home page before benchmarking.');
  let count = Number(match[1]);
  for (let repetition = 0; repetition < repetitions; repetition++) {
    // Rotate order to avoid assigning every cold or warm run to one mode.
    const order = [...modes.slice(repetition % modes.length), ...modes.slice(0, repetition % modes.length)];
    for (const mode of order) {
      const runId = `${mode}-${repetition}`;
      const recorder = new TimelineRecorder({ runId, testName: 'real VM increment' });
      const store = new TimelineArtifactStore({ runId, attemptDir: join(output, mode, String(repetition)) });
      let captureMs = 0;
      const session = new RunSession({
        runId, testId: mode, testName: 'real VM increment', recorder, recordingMode: mode,
        captureEvidence: async (request) => {
          const started = performance.now();
          try {
            const id = `${request.operationId ?? 'test'}-${request.reason}`;
            const artifact = request.kind === 'screenshot'
              ? await store.writeScreenshot(id, await driver.page.screenshot())
              : await store.writeSnapshot(id, await driver.page.snapshot());
            return { status: 'captured', artifactPaths: [artifact.path] };
          } finally {
            captureMs += performance.now() - started;
          }
        },
      });
      const page = new Page((method, params) => driver.sendRequest(method, params), {
        recorder, runSession: session, artifactStore: store,
      });
      const batchStarted = performance.now();
      for (let index = 0; index < actions; index++) {
        captureMs = 0;
        const started = performance.now();
        await page.getByKey('counter_increment').click();
        const totalMs = performance.now() - started;
        samples[mode].push({ totalMs, captureMs, operationMs: totalMs - captureMs });
        if ((index + 1) % 100 === 0) console.log(`${mode} batch ${repetition + 1}: ${index + 1}/${actions}`);
      }
      const batchActionMs = performance.now() - batchStarted;
      count += actions;
      await createExpect(driver.page.getByKey('counter_value')).toHaveText(`Count: ${count}`, { timeout: 3000 });
      const result = await session.finish({ status: 'passed', evidenceStatus: mode === 'off' ? 'disabled' : 'complete' });
      if (result.operations.length !== (mode === 'off' ? 0 : actions)) throw new Error(`${mode}: operation count mismatch.`);
      if (result.evidence.length !== (mode === 'off' ? 0 : mode === 'full' ? actions * 3 : actions)
        || result.evidence.some((item) => item.result.status !== 'captured')) {
        throw new Error(`${mode}: incomplete action evidence.`);
      }
      const timeline = recorder.complete('passed');
      await mkdir(store.runDir, { recursive: true });
      await writeFile(join(store.runDir, 'result.json'), JSON.stringify(result, null, 2));
      if (mode !== 'off') {
        await store.writeTimeline(timeline);
        await writeFile(join(store.runDir, 'trace.json'), JSON.stringify(projectRunTrace(result, timeline), null, 2));
      }
      let evidenceBytes = 0;
      // Read only after measurement; validation IO is not capture overhead.
      for (const item of result.evidence) {
        for (const path of item.result.artifactPaths ?? []) evidenceBytes += (await readFile(join(store.runDir, path))).length;
      }
      report.modes[mode] ??= { evidenceBytes: 0, evidenceCount: 0, batches: [] };
      report.modes[mode].evidenceBytes += evidenceBytes;
      report.modes[mode].evidenceCount += result.evidence.length;
      report.modes[mode].batches.push({ repetition: repetition + 1, batchActionMs, verifiedCounter: count });
      console.log(`${mode} batch ${repetition + 1}: verified ${actions} actions and ${result.evidence.length} evidence items`);
    }
  }
  report.comparison = {
    standardCaptureP95Ms: summarize(samples.standard.map((sample) => sample.captureMs)).p95,
    targetMs: 300,
    targetObserved: summarize(samples.standard.map((sample) => sample.captureMs)).p95 <= 300,
    releaseGateComplete: false,
  };
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error.message).split(endpoint).join('<redacted-vm-endpoint>')
    .replace(/(?:https?|wss?):\/\/[^\s)]+/g, '<redacted-url>');
  process.exitCode = 1;
} finally {
  for (const mode of modes) {
    report.modes[mode] ??= { evidenceBytes: 0, evidenceCount: 0, batches: [] };
    report.modes[mode].samples = samples[mode];
    for (const key of ['totalMs', 'captureMs', 'operationMs']) {
      report.modes[mode][key] = summarize(samples[mode].map((sample) => sample[key]));
    }
  }
  try {
    await driver.dispose();
  } finally {
    await writeFile(join(output, 'benchmark.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify({ status: report.status, comparison: report.comparison, output }));
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (quantile) => sorted[Math.ceil(sorted.length * quantile) - 1] ?? 0;
  return {
    count: sorted.length,
    total: sorted.reduce((sum, item) => sum + item, 0),
    p95: percentile(0.95), p99: percentile(0.99),
  };
}
