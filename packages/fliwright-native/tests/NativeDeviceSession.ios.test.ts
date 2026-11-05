import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNativeDevice } from '../src/NativeDeviceSession.js';
import { DeviceLeaseManager, deviceLeaseKey } from '../src/DeviceLease.js';
import { inspectDeviceLease } from '../src/DeviceRecovery.js';
import { writeFakeXctestTools } from './helpers/fakeXctestTools.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it.each(['retained', 'delegated'] as const)('starts and closes the production XCTest adapter through a %s device owner', async mode => {
  if (process.platform !== 'darwin') return;
  const root = await mkdtemp(join(tmpdir(), 'fliwright-ios-device-owner-')); roots.push(root);
  const deviceId = 'owned-ios-simulator', rootDir = join(root, 'leases');
  const key = deviceLeaseKey('ios', deviceId), journalPath = join(rootDir, `${key}.lock`, 'ios-runner-recovery.json');
  // This actual executable independently reads the write-ahead journal before
  // announcing ready; a mock adapter cannot detect a missing ownership scope.
  const files = await writeFakeXctestTools(root, { deviceId, runnerJournalPath: journalPath });
  const config = { enabled: true, platform: 'ios' as const, deviceId, targetAppId: 'fixture.app',
    ios: { xctestrunPath: files.xctestrunPath },
    tools: { xcodebuild: files.xcodebuild, xcrun: files.xcrun } };
  const discovery = { scan: async () => ({ scannedAt: new Date().toISOString(), diagnostics: [], devices: [
    { id: deviceId, name: 'owned', platform: 'ios' as const, kind: 'simulator' as const, state: 'online' as const },
  ] }) };
  const manager = new DeviceLeaseManager({ rootDir, retryDelayMs: 1 });
  const parent = await openNativeDevice(config, { discovery, leaseManager: manager });
  let child: Awaited<ReturnType<typeof openNativeDevice>> | undefined;
  try {
    if (mode === 'delegated') {
      child = await openNativeDevice(config, { discovery,
        leaseManager: new DeviceLeaseManager({ delegation: await parent.delegate!(), retryDelayMs: 1 }) });
    }
    const owner = child ?? parent;
    const runtime = await owner.createRuntime();
    expect(JSON.parse(await readFile(journalPath, 'utf8'))).toMatchObject({ schemaVersion: 2, phase: 'running', leaseKey: key });
    const inspection = await inspectDeviceLease({ platform: 'ios', deviceId, rootDir });
    expect(inspection).toMatchObject({ owner: 'live', iosRunnerRecord: 'present', hostTool: 'live', operation: 'absent' });
    expect((await runtime.preflightCapabilities())['native.query'].support).toBe('supported');
    await runtime.dispose();
    expect(await readFile(files.shutdowns, 'utf8')).toBe('1');
    await expect(readFile(journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await inspectDeviceLease({ platform: 'ios', deviceId, rootDir })).toMatchObject({ hostTool: 'absent', iosRunnerRecord: 'absent', operation: 'absent' });
    await child?.dispose(); child = undefined;
    await parent.dispose();
    const next = await manager.acquire('ios', deviceId);
    await next.release();
  } finally {
    await child?.dispose().catch(() => {});
    await parent.dispose().catch(() => {});
  }
}, 30000);
