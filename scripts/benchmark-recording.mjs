#!/usr/bin/env node

/**
 * Deterministic core recording benchmark.
 *
 * This measures the TypeScript lifecycle with an in-process evidence source.
 * It deliberately reports synthetic evidence separately from a Flutter-device
 * run; the latter still requires a VM service and a fixed test machine.
 * Run `pnpm build` before invoking this script.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { RecorderController, RunSession } = await import(resolve(root, 'packages/fliwright-core/dist/index.js'));

const options = parseArgs(process.argv.slice(2));
const modes = ['off', 'standard', 'full'];
const lifecycle = {};

for (const mode of modes) {
  lifecycle[mode] = await benchmarkLifecycle(mode, options.actions, options.repetitions);
}

const recorder = await benchmarkRecorder(options.actions);
const standardP95 = lifecycle.standard.p95Ms;
const baselineP95 = lifecycle.off.p95Ms;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  evidence: {
    kind: 'synthetic-core',
    realFlutterVm: false,
    note: 'Replace this report with a fixed-machine Flutter VM run before claiming device performance support.',
  },
  actions: options.actions,
  repetitions: options.repetitions,
  lifecycle,
  comparison: {
    standardP95OverheadMs: round(Math.max(0, standardP95 - baselineP95)),
    standardP95TargetMs: 300,
    targetObserved: standardP95 - baselineP95 <= 300,
    targetValidForRelease: false,
  },
  recorder,
  cacheBudget: {
    rawEvents: {
      archived: recorder.eventCache?.archivedEvents ?? 0,
      observedTotal: recorder.rawEventCount,
      peakBufferedEvents: recorder.eventCache?.peakBufferedEvents ?? 0,
      peakBufferedBytes: recorder.eventCache?.peakBufferedBytes ?? 0,
      maxBufferedEvents: recorder.eventCache?.maxBufferedEvents ?? 0,
      maxBufferedBytes: recorder.eventCache?.maxBufferedBytes ?? 0,
      fixedBudgetVerified: !!recorder.eventCache
        && recorder.eventCache.peakBufferedEvents <= recorder.eventCache.maxBufferedEvents
        && recorder.eventCache.peakBufferedBytes <= recorder.eventCache.maxBufferedBytes
        && recorder.eventCache.archivedEvents === options.actions * 2,
    },
    screenshotPayloads: {
      observedUnique: recorder.uniqueScreenshotPayloads,
      binaryCache: recorder.binaryCache,
      // This small shared-image check does not establish the unique-image scale gate.
      fixedBudgetVerified: false,
    },
    tenMinuteStabilityVerified: false,
  },
  status: 'synthetic-only',
};

await mkdir(dirname(options.output), { recursive: true });
await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ output: options.output, status: report.status, actions: options.actions })}\n`);

async function benchmarkLifecycle(mode, actions, repetitions) {
  const samples = [];
  let evidenceCount = 0;
  for (let repetition = 0; repetition < repetitions; repetition++) {
    const session = new RunSession({
      runId: `benchmark-${mode}-${repetition}`,
      testId: `benchmark-${mode}`,
      testName: `recording ${mode}`,
      recordingMode: mode,
      captureEvidence: async () => {
        evidenceCount++;
        return { status: 'captured', artifactPaths: mode === 'off' ? undefined : [`synthetic/${mode}/${evidenceCount}.png`] };
      },
    });
    for (let index = 0; index < actions; index++) {
      const started = performance.now();
      await session.perform({ kind: 'action', title: `tap ${index}` }, async () => undefined);
      samples.push(performance.now() - started);
    }
    await session.finish({ status: 'passed', evidenceStatus: mode === 'off' ? 'disabled' : 'complete' });
  }
  return summarize(samples, evidenceCount);
}

async function benchmarkRecorder(actions) {
  let sessionId = '';
  let sequence = 0;
  let callback;
  const target = {
    targetId: 'benchmark-target',
    status: 'resolved',
    candidates: [{ query: { match: { key: 'benchmark' } }, stability: 'key', matchCount: 1, matchesTarget: true }],
  };
  const sendRequest = async (method, params = {}) => {
    if (method === 'ext.fliwright.handshake') {
      return { protocolVersion: 2, compatible: true, bridgeCapabilities: {
        recordingProtocolVersion: 2,
        recordingBeforeDispatchTarget: true,
        recordingFocusedInputController: true,
      } };
    }
    if (method === 'streamListen') return {};
    if (method === 'ext.fliwright.startRecording') {
      sessionId = String(params.sessionId);
      sequence = 0;
      return { protocolVersion: 2, recording: true, sessionId };
    }
    if (method === 'ext.fliwright.stopRecording') return { protocolVersion: 2, recording: false, sessionId, lastSequence: sequence };
    if (method === 'ext.fliwright.screenshot') return {
      success: true,
      format: 'png',
      screenshot: 'c3ludGhldGljLXNjcmVlbnNob3Q=',
      width: 320,
      height: 640,
      pixelRatio: 1,
    };
    return {};
  };
  const controller = new RecorderController(sendRequest, (handler) => {
    callback = handler;
    return () => { callback = undefined; };
  });
  const started = performance.now();
  await controller.start({ captureScreenshots: true, filterNoise: false, screenshotSampleIntervalMs: 60_000 });
  for (let index = 0; index < actions; index++) {
    emit('down', index * 2 + 1, index);
    emit('up', index * 2 + 2, index);
  }
  const result = await controller.stop();
  return {
    elapsedMs: round(performance.now() - started),
    status: result.status,
    rawEventCount: controller.getRawEventCount(),
    eventCache: result.eventCache,
    operationCount: result.operations.length,
    frameCount: result.frames.length,
    uniqueScreenshotPayloads: new Set(result.frames.map((frame) => frame.screenshot?.path).filter(Boolean)).size,
    screenshotReferenceCount: result.frames.filter((frame) => frame.screenshot?.path).length,
    screenshotPayloadBytes: result.frames[0]?.screenshot?.byteLength ?? 0,
    binaryCache: result.binaryCache,
    screenshotQueue: result.screenshotQueue,
    issues: result.issues,
  };

  function emit(phase, eventSequence, index) {
    sequence = Math.max(sequence, eventSequence);
    const payload = {
      kind: 'pointer', phase, pointer: 0, x: index % 320, y: index % 640,
      viewportWidth: 320, viewportHeight: 640, pixelRatio: 1,
    };
    callback?.({ kind: 'FliwrightRecording', timestamp: Date.now(), data: {
      version: 2, sessionId, sequence: eventSequence, elapsedUs: eventSequence * 1000,
      frameId: `benchmark-frame-${eventSequence}`, targetId: target.targetId,
      ...(phase === 'down' ? { target } : {}), payload,
    } });
  }
}

function summarize(samples, evidenceCount) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    operationCount: samples.length,
    evidenceCount,
    totalMs: round(samples.reduce((sum, value) => sum + value, 0)),
    meanMs: round(mean(samples)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
  };
}

function parseArgs(argv) {
  const value = (name, fallback) => {
    const prefix = `--${name}=`;
    const argument = argv.find((item) => item.startsWith(prefix));
    return argument ? Number(argument.slice(prefix.length)) : fallback;
  };
  const outputArg = argv.find((item) => item.startsWith('--output='));
  return {
    actions: positiveInteger(value('actions', 1000), 'actions'),
    repetitions: positiveInteger(value('repetitions', 3), 'repetitions'),
    output: resolve(outputArg ? outputArg.slice('--output='.length) : '/tmp/fliwright-recording-benchmark.json'),
  };
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer.`);
  return value;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(sorted, quantile) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
