#!/usr/bin/env node
// A dedicated disposable Simulator is required. This deliberately retains crashed-owner recovery evidence.
import { fork } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeviceLeaseManager } from '../dist/DeviceLease.js';
import { inspectDeviceLease, inspectIosRunnerRecovery } from '../dist/DeviceRecovery.js';
import { prepareIosRunner } from '../dist/ios/PrepareIosRunner.js';
import { startXctestSession } from '../dist/ios/XctestRunner.js';

const deviceId = process.argv[2];
if (process.platform !== 'darwin' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(deviceId ?? '')
  || process.argv.length !== 3) throw new Error('Usage on macOS: node scripts/verify-ios-owner-crash.mjs <disposable-booted-Simulator-UDID>');

if (process.env.FLIWRIGHT_OWNER_CRASH_CHILD === '1') {
  const lease = await new DeviceLeaseManager().acquire('ios', deviceId, { signal: AbortSignal.timeout(5000) });
  const product = await prepareIosRunner();
  await lease.runExclusive(() => startXctestSession({ platform: 'ios', deviceId, targetAppId: 'com.apple.springboard',
    enabled: true, backend: 'xctest', ios: { xctestrunPath: product.xctestrunPath } }, undefined,
    action => lease.runOwnedTool(action), { path: lease.iosRunnerRecoveryPath, binding: lease.recoveryBinding, assertOwned: () => lease.assertOwned() }));
  // Only the controlled parent receives the readiness event. No credentials cross IPC.
  process.send({ ready: true });
  setInterval(() => {}, 1000);
} else {
  const product = await prepareIosRunner();
  const artifactRoot = await mkdtemp(join(tmpdir(), 'fliwright-ios-owner-crash-'));
  const child = fork(fileURLToPath(import.meta.url), [deviceId], {
    env: { ...process.env, FLIWRIGHT_OWNER_CRASH_CHILD: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let original, originalPath, failure, killed = false, report, platformReadback;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Production owner did not become ready')), 120_000);
      child.once('error', reject);
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Production owner exited before readiness')); });
      child.once('message', message => { clearTimeout(timer); message?.ready ? resolve() : reject(new Error('Invalid owner readiness')); });
    });
    const inventory = await inspectDeviceLease({ platform: 'ios', deviceId });
    if (inventory.owner !== 'live' || inventory.hostTool !== 'live' || inventory.iosRunnerRecord !== 'present'
      || inventory.issues.join(',') !== 'unresolved-ios-runner') throw new Error('Expected a complete live production owner');
    originalPath = join(new DeviceLeaseManager().rootDir, inventory.deviceKey + '.lock', 'ios-runner-recovery.json');
    original = await readFile(originalPath);
    const record = JSON.parse(original);
    if (record.schemaVersion !== 2 || record.phase !== 'running') throw new Error('Runner recovery checkpoint missing');
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGKILL'); killed = true; await exited;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      report = await inspectDeviceLease({ platform: 'ios', deviceId });
      if (report.owner === 'exited' && report.hostTool === 'exited') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (report?.owner !== 'exited' || report?.hostTool !== 'exited') throw new Error('Owned host process group did not converge');
    platformReadback = await inspectIosRunnerRecovery({ platform: 'ios', deviceId });
    if (platformReadback.status !== 'runner-absent' || !platformReadback.recordedBootGenerationMatches) {
      throw new Error('Production Runner did not independently exit after owner loss');
    }
    if (!(await readFile(originalPath)).equals(original)) throw new Error('Original Runner recovery evidence changed');
    let acquisitionRejected = false;
    try {
      const lease = await new DeviceLeaseManager().acquire('ios', deviceId, { signal: AbortSignal.timeout(150) });
      await lease.release();
    } catch { acquisitionRejected = true; }
    if (!acquisitionRejected) throw new Error('Abandoned Runner evidence allowed device reuse');
    report = { owner: report.owner, hostTool: report.hostTool, iosRunnerRecord: report.iosRunnerRecord,
      issues: report.issues, originalEvidenceUnchanged: true, acquisitionRejected };
  } catch (error) { failure = error; }
  finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
    }
  }
  const summary = { status: failure ? 'failed' : 'passed', productionOwnerKilled: killed, report, platformReadback,
    evidenceRetained: true, recoveryTransactionImplemented: false, xcode: product.xcode, sdkBuild: product.sdkBuild };
  await writeFile(join(artifactRoot, 'result.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
  process.stdout.write(JSON.stringify({ ...summary, artifactRoot }) + '\n');
  if (failure) { process.stderr.write('Owner-crash experiment failed; retained evidence must be inspected.\n'); process.exitCode = 1; }
}
