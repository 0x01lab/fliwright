#!/usr/bin/env node
// Runs the actual shipped testServe and TypeScript session, retaining the normal device lease.
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceLeaseManager } from '../dist/DeviceLease.js';
import { inspectDeviceLease } from '../dist/DeviceRecovery.js';
import { prepareIosRunner } from '../dist/ios/PrepareIosRunner.js';
import { startXctestSession } from '../dist/ios/XctestRunner.js';
import { readSimulatorRunnerPids } from '../dist/ios/IosSimulatorIdentity.js';

const deviceId = process.argv[2];
if (process.platform !== 'darwin' || process.argv.length !== 3
  || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(deviceId ?? '')) {
  throw new Error('Usage on macOS: node scripts/verify-ios-production-session.mjs <dedicated-booted-Simulator-UDID>');
}
const product = await prepareIosRunner();
const lease = await new DeviceLeaseManager().acquire('ios', deviceId, { signal: AbortSignal.timeout(5000) });
const artifactRoot = await mkdtemp(join(tmpdir(), 'fliwright-ios-production-'));
const config = { platform: 'ios', deviceId, targetAppId: 'com.apple.springboard', enabled: true, backend: 'xctest',
  cleanupTimeoutMs: 15_000, ios: { xctestrunPath: product.xctestrunPath, startupTimeoutMs: 120_000 } };
const context = () => ({ requestId: randomUUID(), deadline: Date.now() + 10_000, signal: AbortSignal.timeout(10_000) });
const attempts = [];
let session, failure;
try {
  for (let index = 0; index < 2; index++) {
    const started = Date.now();
    session = await lease.runExclusive(() => startXctestSession(config, undefined, action => lease.runOwnedTool(action), {
      path: lease.iosRunnerRecoveryPath, binding: lease.recoveryBinding, assertOwned: () => lease.assertOwned(),
    }));
    const record = JSON.parse(await readFile(lease.iosRunnerRecoveryPath, 'utf8'));
    if (record.schemaVersion !== 2 || record.phase !== 'running' || !record.recoveryPort || !record.recoveryKey) {
      throw new Error('Production Runner recovery checkpoint is incomplete');
    }
    const startupMs = Date.now() - started;
    const png = await lease.runExclusive(() => session.screenshot(context()));
    await writeFile(join(artifactRoot, 'screen-' + index + '.png'), png, { mode: 0o600 });
    const cleanupStarted = Date.now();
    await lease.runExclusive(() => session.dispose());
    session = undefined;
    const inspection = await inspectDeviceLease({ platform: 'ios', deviceId });
    if (inspection.iosRunnerRecord !== 'absent' || inspection.hostTool !== 'absent' || inspection.operation !== 'absent'
      || inspection.issues.length || (await readSimulatorRunnerPids(config, context())).length) {
      throw new Error('Production Runner cleanup was not independently confirmed');
    }
    attempts.push({ generation: record.generation, startupMs, cleanupMs: Date.now() - cleanupStarted,
      screenshotBytes: png.length, recoverySchema: record.schemaVersion, authenticated: true, runnerAbsent: true });
  }
} catch (error) { failure = error; }
finally {
  if (session) {
    try { await lease.runExclusive(() => session.dispose()); }
    catch { await lease.quarantine('Production Runner experiment cleanup was not confirmed').catch(() => {}); }
  }
  try { await lease.release(); } catch (error) { failure ??= error; }
}
const report = { status: failure ? 'failed' : 'passed', productionSessionIntegrated: true, attempts,
  xcode: product.xcode, sdkBuild: product.sdkBuild };
await writeFile(join(artifactRoot, 'result.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
process.stdout.write(JSON.stringify({ ...report, artifactRoot }) + '\n');
if (failure) {
  process.stderr.write('Production XCTest session verification failed; preserve its recovery evidence.\n');
  process.exitCode = 1;
}
