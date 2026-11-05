#!/usr/bin/env node
// Explicit development acceptance on a dedicated Simulator. Retains all original evidence privately.
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceLeaseManager } from '../dist/DeviceLease.js';
import { inspectDeviceLease } from '../dist/DeviceRecovery.js';
import { restoreIosRunner } from '../dist/index.js';

const [deviceId, fingerprint] = process.argv.slice(2);
if (process.platform !== 'darwin' || process.argv.length !== 4
  || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(deviceId ?? '') || !/^[a-f0-9]{64}$/.test(fingerprint ?? '')) {
  throw new Error('Usage on macOS: node scripts/verify-ios-runner-recovery.mjs <dedicated-Simulator-UDID> <inspection-fingerprint>');
}
const input = { platform: 'ios', deviceId }, report = await inspectDeviceLease(input);
if (report.fingerprint !== fingerprint || report.owner !== 'exited' || report.hostTool === 'live'
  || report.issues.join(',') !== 'unresolved-ios-runner') throw new Error('The exact isolated crashed-owner inspection is required.');
const root = new DeviceLeaseManager().rootDir, lock = join(root, `${report.deviceKey}.lock`);
const runner = await readFile(join(lock, 'ios-runner-recovery.json'));
let dirty;
try { dirty = await readFile(join(root, `${report.deviceKey}.dirty`)); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const artifactRoot = await mkdtemp(join(tmpdir(), 'fliwright-ios-runner-recovery-'));
let result, failure;
try {
  const restored = await restoreIosRunner({ deviceId, fingerprint }, { timeoutMs: 60_000 });
  const archive = join(root, `${report.deviceKey}.recovery.archive-${restored.transactionId}`);
  if (!(await readFile(join(archive, 'original.lock', 'ios-runner-recovery.json'))).equals(runner)) {
    throw new Error('Original Runner journal bytes were not preserved.');
  }
  if (dirty && !(await readFile(join(archive, 'original.dirty'))).equals(dirty)) throw new Error('Original quarantine bytes changed.');
  const after = await inspectDeviceLease(input);
  if (after.state !== 'available' || after.issues.length) throw new Error('Recovery did not retire exclusion.');
  const lease = await new DeviceLeaseManager().acquire('ios', deviceId, { signal: AbortSignal.timeout(5000) });
  await lease.release();
  result = { recoveryStatus: restored.status, resourceScope: restored.resourceScope, originalEvidencePreserved: true,
    freshLeaseVerified: true, productionAttemptVerified: false };
} catch (error) {
  failure = error;
  // Only stable classifications, never raw private journal or command error details.
  result = { recoveryStatus: 'failed', errorCode: error?.code ?? 'unclassified', evidenceRetained: true };
}
await writeFile(join(artifactRoot, 'result.json'), JSON.stringify({ status: failure ? 'failed' : 'passed', ...result }, null, 2), { mode: 0o600 });
process.stdout.write(JSON.stringify({ status: failure ? 'failed' : 'passed', ...result, artifactRoot }) + '\n');
if (failure) process.exitCode = 1;
