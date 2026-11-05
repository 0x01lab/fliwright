import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { NativeOperationContext } from '@fliwright/core';
import { DeviceLeaseManager } from '../src/DeviceLease.js';
import { inspectDeviceLease } from '../src/DeviceRecovery.js';
import { AndroidDeviceBinding } from '../src/android/AndroidDeviceBinding.js';
import { AndroidAppJournal } from '../src/android/AndroidAppJournal.js';
import { AndroidPermissionJournal } from '../src/android/AndroidPermissionJournal.js';
import { restoreAndroidAppWith } from '../src/android/AndroidRecoveryApi.js';
import { androidDeviceIdentity } from './helpers/androidDeviceIdentity.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const serial = 'emulator-5554';
const identity = { platform: 'android' as const, deviceId: 'avd:dedicated-test' };
const context = (): NativeOperationContext => ({ requestId: randomUUID(), deadline: Date.now() + 10000, signal: AbortSignal.timeout(10000) });

async function candidate() {
  const rootDir = await mkdtemp(join(tmpdir(), 'android-recovery-api-')); roots.push(rootDir);
  const input = { ...identity, rootDir }, manager = new DeviceLeaseManager({ rootDir });
  const lease = await manager.acquire('android', identity.deviceId), device = androidDeviceIdentity(serial);
  const binding = lease.recoveryBinding!;
  await new AndroidDeviceBinding({ path: lease.deviceRecoveryPath!, deviceId: serial, avdName: 'dedicated-test', binding,
    executor: device.executor, assertOwned: () => lease.assertOwned!() }).verify(context());
  const app = { appId: 'example.app', activity: 'example.app.MainActivity', sha256: 'b'.repeat(64), uid: 10123,
    installedBySession: false, minSdk: 24, targetSdk: 35, permissions: ['android.permission.CAMERA'] };
  await new AndroidAppJournal({ path: lease.recoveryPath!, deviceId: serial, recoveryBinding: binding })
    .checkpoint({ ...app, operation: 'stopped' }, context());
  const baseline = [{ permission: 'camera' as const, granted: false, userSet: false, userFixed: false, flags: [] as string[] }];
  await new AndroidPermissionJournal({ path: lease.permissionRecoveryPath!, deviceId: serial, appId: app.appId,
    recoveryBinding: binding, appIdentity: () => app, assertOwned: () => lease.assertOwned!() })
    .checkpoint({ uid: app.uid, baseline, desired: baseline, declaration: [], status: 'verified', step: 'readback', observed: baseline, restored: true }, context());
  await lease.quarantine('test');
  const ownerPath = join(rootDir, `${lease.key}.lock`, 'owner.json'), owner = JSON.parse(await readFile(ownerPath, 'utf8'));
  await writeFile(ownerPath, JSON.stringify({ ...owner, pid: 2147483000 }));
  return { input, lease, fingerprint: (await inspectDeviceLease(input)).fingerprint };
}

function discovery(devices: Array<{ id: string; avdName?: string; state: 'online' | 'offline'; platform: 'android'; kind: 'simulator' | 'physical' }>) {
  return { scan: vi.fn(async () => ({ scannedAt: new Date().toISOString(), diagnostics: [], devices })) };
}

it('restores only the unique online AVD whose discovered serial matches the bound device record', async () => {
  const f = await candidate(), restore = vi.fn(async () => ({ status: 'retired' as const, transactionId: 'tx', archiveDirectory: '/private/archive' }));
  const devices = discovery([{ id: serial, avdName: 'dedicated-test', state: 'online', platform: 'android', kind: 'simulator' }]);
  const result = await restoreAndroidAppWith({ deviceId: identity.deviceId, fingerprint: f.fingerprint, rootDir: f.input.rootDir }, {}, {
    discovery: devices, restore: restore as unknown as typeof import('../src/android/AndroidRecovery.js').restoreAndroidRecovery,
  });
  expect(result).toEqual({ status: 'restored', transactionId: 'tx', resourceScope: 'android-app-permission-forward' });
  expect(restore).toHaveBeenCalledExactlyOnceWith({ ...f.input }, expect.objectContaining({ serial, fingerprint: f.fingerprint }));
  expect(devices.scan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ platforms: ['android'], signal: expect.any(AbortSignal) }));
});

it.each([
  ['duplicate AVDs', [
    { id: serial, avdName: 'dedicated-test', state: 'online' as const, platform: 'android' as const, kind: 'simulator' as const },
    { id: 'emulator-5556', avdName: 'dedicated-test', state: 'online' as const, platform: 'android' as const, kind: 'simulator' as const },
  ]],
  ['serial mismatch', [{ id: 'emulator-5556', avdName: 'dedicated-test', state: 'online' as const, platform: 'android' as const, kind: 'simulator' as const }]],
  ['physical device', [{ id: serial, avdName: 'dedicated-test', state: 'online' as const, platform: 'android' as const, kind: 'physical' as const }]],
  ['offline AVD', [{ id: serial, avdName: 'dedicated-test', state: 'offline' as const, platform: 'android' as const, kind: 'simulator' as const }]],
] as const)('rejects %s before dispatching restoration', async (_label, rows) => {
  const f = await candidate(), restore = vi.fn();
  await expect(restoreAndroidAppWith({ deviceId: identity.deviceId, fingerprint: f.fingerprint, rootDir: f.input.rootDir }, {}, {
    discovery: discovery([...rows]), restore: restore as unknown as typeof import('../src/android/AndroidRecovery.js').restoreAndroidRecovery,
  })).rejects.toMatchObject({ code: 'device_mismatch' });
  expect(restore).not.toHaveBeenCalled();
});

it('rejects stale fingerprints before device discovery', async () => {
  const f = await candidate(), devices = discovery([]);
  await expect(restoreAndroidAppWith({ deviceId: identity.deviceId, fingerprint: 'a'.repeat(64), rootDir: f.input.rootDir }, {}, { discovery: devices }))
    .rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(devices.scan).not.toHaveBeenCalled();
});

it('rejects an incomplete ADB inventory even when a matching row was returned', async () => {
  const f = await candidate(), restore = vi.fn();
  const devices = { scan: vi.fn(async () => ({ scannedAt: new Date().toISOString(),
    diagnostics: [{ source: 'adb' as const, code: 'command-failed' as const, message: 'incomplete inventory' }],
    devices: [{ id: serial, avdName: 'dedicated-test', name: 'test', state: 'online' as const,
      platform: 'android' as const, kind: 'simulator' as const }] })) };
  await expect(restoreAndroidAppWith({ deviceId: identity.deviceId, fingerprint: f.fingerprint, rootDir: f.input.rootDir }, {}, {
    discovery: devices, restore: restore as unknown as typeof import('../src/android/AndroidRecovery.js').restoreAndroidRecovery,
  })).rejects.toMatchObject({ code: 'device_mismatch' });
  expect(restore).not.toHaveBeenCalled();
});
