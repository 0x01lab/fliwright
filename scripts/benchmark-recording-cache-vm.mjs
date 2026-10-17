#!/usr/bin/env node
/** Real Flutter recorder soak. Bridge-dispatched input does not prove native input support. */
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { FliwrightDriver, copyRecordingArtifacts } = await import(resolve(root, 'packages/fliwright-core/dist/index.js'));
const argument = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const durationMs = Number(argument('duration-ms', '600000'));
const actions = Number(argument('actions', '1000'));
assert.ok(Number.isSafeInteger(durationMs) && durationMs > 0);
assert.ok(Number.isSafeInteger(actions) && actions > 0);
const output = resolve(argument('output', '/tmp/fliwright-recording-cache-vm'));
const endpoint = process.env.FLIWRIGHT_VM_SERVICE_URL ?? process.env.FLIWRIGHT_VM_URL;
assert.ok(endpoint, 'Provide FLIWRIGHT_VM_SERVICE_URL through the environment.');
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'running',
  scope: 'Real Flutter VM, bridge-dispatched pointer events and actual PNG capture. Native mouse/keyboard/IME is a separate gate.',
  platform: `${process.platform}/${process.arch}`, nodeVersion: process.version,
  flutterVersion: argument('flutter-version', 'unspecified'), durationMs, requestedActions: actions,
  memorySamples: [], checks: {}, releaseGateComplete: false };
const driver = new FliwrightDriver();
let active = false;
let artifactDirectory;
let lastProgress = 0;
try {
  await mkdir(output, { recursive: true });
  await driver.connect(endpoint);
  report.dartVersion = driver.sdkVersion;
  report.viewport = await driver.page.viewport();
  const initial = Number((await driver.page.getByKey('counter_value').resolve()).text?.match(/^Count: (\d+)$/)?.[1]);
  assert.ok(Number.isSafeInteger(initial), 'Open the recording fixture counter page first.');
  report.initialCounter = initial;
  await driver.recorder.start({ captureScreenshots: true, artifactDirectory: resolve(output, 'capture') });
  active = true;
  const started = performance.now();
  for (let index = 0; index < actions; index++) {
    await driver.page.getByKey('counter_increment').click();
    const elapsedMs = performance.now() - started;
    if (index % 10 === 0 || index === actions - 1) report.memorySamples.push({ elapsedMs,
      actions: index + 1, rawEvents: driver.recorder.getRawEventCount(), ...process.memoryUsage() });
    if (elapsedMs - lastProgress >= 30000) {
      lastProgress = elapsedMs;
      await writeFile(resolve(output, 'progress.json'), JSON.stringify({ elapsedMs, actions: index + 1,
        rawEvents: driver.recorder.getRawEventCount(), memory: process.memoryUsage() }, null, 2));
      process.stdout.write(JSON.stringify({ elapsedMs: Math.round(elapsedMs), actions: index + 1 }) + '\n');
    }
    const remaining = (index + 1) * durationMs / actions - (performance.now() - started);
    if (remaining > 0) await delay(remaining);
  }
  while (performance.now() - started < durationMs) await delay(Math.max(1, durationMs - (performance.now() - started)));
  report.captureDurationMs = performance.now() - started;
  const result = await driver.recorder.stop({ mode: 'script', testName: 'recorder soak' });
  active = false;
  artifactDirectory = driver.recorder.getArtifactDirectory();
  await writeFile(resolve(output, 'recording.json'), JSON.stringify(result, null, 2));
  report.captureStatus = result.status;
  report.captureIssues = result.issues;
  report.eventCache = result.eventCache;
  report.binaryCache = result.binaryCache;
  report.screenshotQueue = result.screenshotQueue;
  assert.equal(result.operations.length, actions);
  assert.equal(result.frames.length, actions);
  assert.equal(result.code.match(/\.click(?:At)?\(/g)?.length, actions);
  report.unresolvedTargets = result.operations.filter((operation) => operation.recordedTarget?.status !== 'resolved').length;
  assert.equal((await driver.page.getByKey('counter_value').resolve()).text, `Count: ${initial + actions}`);
  assert.equal(result.eventCache.archivedEvents, result.eventCache.eventCount);
  assert.ok(result.eventCache.eventCount >= actions * 2);
  assert.ok(result.eventCache.peakBufferedBytes <= result.eventCache.maxBufferedBytes);
  assert.ok(result.eventCache.peakBufferedEvents <= result.eventCache.maxBufferedEvents);
  assert.equal(result.binaryCache.retainedBytes, 0);
  assert.ok(result.binaryCache.peakScreenshotBytes <= result.binaryCache.maxScreenshotBytes);
  assert.ok(result.screenshotQueue.peakPendingTasks <= result.screenshotQueue.maxPendingTasks);
  assert.equal(result.screenshotQueue.pendingTasks, 0);
  assert.ok(!JSON.stringify(result).includes('base64'));
  const portable = resolve(output, 'portable');
  await copyRecordingArtifacts(result, artifactDirectory, portable);
  await writeFile(resolve(portable, 'recording.json'), JSON.stringify(result, null, 2));
  const hidden = `${artifactDirectory}.moved`;
  await rename(artifactDirectory, hidden);
  try {
    const raw = (await readFile(resolve(portable, result.rawEventsFile), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(raw.length, result.eventCache.eventCount);
    assert.equal(raw.filter((event) => event.type === 'pointerEvent' && event.kind === 'down').length, actions);
    assert.equal(raw.filter((event) => event.type === 'pointerEvent' && event.kind === 'up').length, actions);
    assert.deepEqual(raw.map((event) => event.sequence), Array.from({ length: raw.length }, (_, index) => index + 1));
    let bytes = 0;
    for (const frame of result.frames) {
      const image = await readFile(resolve(portable, frame.screenshot.path));
      assert.equal(image.length, frame.screenshot.byteLength);
      assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      bytes += image.length;
    }
    report.portableEvidence = { frames: actions, uniqueReferences: new Set(result.frames.map((frame) => frame.screenshot.path)).size, bytes };
  } finally { await rename(hidden, artifactDirectory); }
  const eventCount = driver.recorder.getRawEventCount();
  const writtenScreenshots = result.binaryCache.writtenScreenshots;
  await driver.page.getByKey('counter_increment').click();
  await delay(600);
  assert.equal(driver.recorder.getRawEventCount(), eventCount);
  assert.equal((await driver.recorder.stop()).binaryCache.writtenScreenshots, writtenScreenshots);
  await driver.dispose();
  await assert.rejects(driver.sendRequest('getVM'), /Not connected/);
  report.eventCache = result.eventCache;
  report.binaryCache = result.binaryCache;
  report.screenshotQueue = result.screenshotQueue;
  report.checks = { businessCounter: true, operationsAndCode: true, archiveOrder: true,
    fixedEventBudget: true, binaryReferencesOnly: true, fixedScreenshotBudget: true,
    fixedPendingWork: true, portableWithoutSource: true, samplerStopped: true, eventsStopped: true, transportClosed: true,
    tenMinuteDuration: report.captureDurationMs >= 600000 };
  report.checks.captureComplete = result.status === 'captured';
  report.checks.durableTargets = report.unresolvedTargets === 0;
  assert.equal(result.status, 'captured', result.issues.join('; '));
  assert.equal(report.unresolvedTargets, 0, 'Target capture must preserve reliable selectors for every action.');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error.stack ?? error).split(endpoint).join('<redacted-vm-endpoint>');
  process.exitCode = 1;
} finally {
  if (active) await driver.recorder.stop().catch(() => {});
  await driver.dispose().catch(() => {});
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify(report, null, 2));
  await rm(resolve(output, 'progress.json'), { force: true });
  process.stdout.write(JSON.stringify({ status: report.status, output, checks: report.checks, error: report.error }) + '\n');
}
