import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { inspectAndroidApp } from '../../src/android/AndroidAppObservation.js';
import type { ToolExecutor } from '../../src/ToolExecutor.js';
import { openNativeDevice } from '../../src/NativeDeviceSession.js';
import { DeviceLeaseManager } from '../../src/DeviceLease.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function fixture() {
  const state = { hash: 'b'.repeat(64), uid: 10123, pid: 42, paths: 'package:/data/app/owned/base.apk', user: '0', flags: '', appOp: 'No operations.' };
  const calls: string[] = [];
  const executor = vi.fn<ToolExecutor>(async (_program, args) => {
    const command = args[3]; calls.push(command);
    if (command === 'am get-current-user') return Buffer.from(state.user);
    if (command.startsWith('pm path ')) return Buffer.from(state.paths);
    if (command.startsWith('sha256sum ')) return Buffer.from(`${state.hash}  /data/app/owned/base.apk\n`);
    if (command.startsWith('dumpsys package ')) return Buffer.from(`Package [example.app] (test):\n userId=${state.uid}\n targetSdk=35\n User 0: installed=true stopped=false\n runtime permissions:\n android.permission.CAMERA: granted=false, flags=[${state.flags}]\n`);
    if (command === 'ps -A -o UID,PID,NAME') return Buffer.from(`UID PID NAME\n0 1 init\n${state.uid} ${state.pid} example.app\n`);
    if (command.startsWith('cmd appops get ')) return Buffer.from(state.appOp);
    throw Error(`Unexpected write: ${command}`);
  });
  const options = { deviceId: 'owned', appId: 'example.app', adbPath: 'owned-adb', executor };
  const context = { requestId: 'observe', deadline: Date.now() + 5000, signal: new AbortController().signal };
  return { state, calls, executor, options, context };
}

it('independently reads installed bytes, isolated UID, current main PID and permissions without writes', async () => {
  const f = fixture();
  const result = await inspectAndroidApp(f.options, ['camera'], f.context);
  expect(result).toEqual({ platform: 'android', deviceKey: createHash('sha256').update('android\0owned').digest('hex'),
    appId: 'example.app', apkSha256: f.state.hash, uid: 10123, pid: 42,
    permissions: [{ permission: 'camera', granted: false, userSet: false, userFixed: false, flags: [] }] });
  expect(f.executor.mock.calls.every(([program, args]) => program === 'owned-adb' && args.slice(0, 3).join(' ') === '-s owned shell')).toBe(true);
  expect(f.calls.filter(command => command.startsWith('sha256sum'))).toHaveLength(2);
  expect(JSON.stringify(result)).not.toMatch(/owned|\/data\/app/);
});

it.each(['hash', 'uid', 'pid'] as const)('refuses %s replacement during the permission read', async field => {
  const f = fixture(), execute = f.executor.getMockImplementation()!;
  f.executor.mockImplementation(async (...args) => {
    const output = await execute(...args);
    if (args[1][3].startsWith('cmd appops get ')) {
      if (field === 'hash') f.state.hash = 'c'.repeat(64); else f.state[field]++;
    }
    return output;
  });
  await expect(inspectAndroidApp(f.options, ['camera'], f.context)).rejects.toThrow(/changed|match/);
});

it.each(['split', 'secondary-user', 'shared-uid', 'invalid-pid', 'fixed-flags', 'custom-appop'])('fails closed on %s', async kind => {
  const f = fixture();
  if (kind === 'split') f.state.paths += '\npackage:/data/app/owned/split.apk';
  if (kind === 'secondary-user') f.state.user = '10';
  if (kind === 'shared-uid') f.state.uid = 1000;
  if (kind === 'invalid-pid') f.state.pid = 1;
  if (kind === 'fixed-flags') f.state.flags = 'SYSTEM_FIXED';
  if (kind === 'custom-appop') f.state.appOp = 'CAMERA: ignore';
  await expect(inspectAndroidApp(f.options, ['camera'], f.context)).rejects.toThrow();
});

it('observes an empty permission declaration and rejects duplicates before platform work', async () => {
  const f = fixture();
  await expect(inspectAndroidApp(f.options, ['camera', 'camera'], f.context)).rejects.toThrow();
  expect(f.calls).toEqual([]);
  expect((await inspectAndroidApp(f.options, [], f.context)).permissions).toEqual([]);
});

it('does not continue or return observation after cancellation during a read', async () => {
  const f = fixture(), abort = new AbortController(), execute = f.executor.getMockImplementation()!;
  f.executor.mockImplementation(async (...args) => { const result = await execute(...args); abort.abort(); return result; });
  await expect(inspectAndroidApp(f.options, [], { ...f.context, signal: abort.signal })).rejects.toThrow();
  expect(f.calls).toHaveLength(1);
});

it.each([false, true])('observes through a delegated owner with an active Adapter and final ownership fence (%s)', async fenced => {
  const f = fixture(), root = await mkdtemp(join(tmpdir(), 'android-app-read-'));
  const config = { enabled: true, platform: 'android' as const, deviceId: 'owned', targetAppId: 'example.app', tools: { adb: 'owned-adb' } };
  const discovery = { scan: async () => ({ scannedAt: new Date().toISOString(), diagnostics: [], devices: [
    { id: 'owned', name: 'owned', platform: 'android' as const, kind: 'simulator' as const, state: 'online' as const },
  ] }) };
  const manager = new DeviceLeaseManager({ rootDir: root, retryDelayMs: 1 });
  const parent = await manager.acquire('android', 'owned'), delegation = await parent.delegate!();
  let hashes = 0, fenceNext = false;
  const execute = f.executor.getMockImplementation()!;
  f.executor.mockImplementation(async (...args) => {
    const output = await execute(...args);
    if (args[1][3].startsWith('sha256sum')) hashes++;
    if (fenced && hashes === 2 && args[1][3] === 'ps -A -o UID,PID,NAME') {
      await writeFile(join(delegation.rootDir, `${delegation.key}.lock`, 'owner.json'), JSON.stringify({ token: 'replacement', pid: process.pid }));
      fenceNext = true;
    }
    return output;
  });
  const child = await openNativeDevice(config, { discovery, appExecutor: f.executor,
    leaseManager: new DeviceLeaseManager({ delegation, retryDelayMs: 1 }),
    createAdapter: async () => ({ identity: { platform: 'android', deviceId: 'owned', appId: 'example.app', backend: 'adb', generation: 'adapter' },
      capabilities: async () => ({}), snapshot: vi.fn(), execute: vi.fn(), screenshot: vi.fn(), dispose: async () => {} }),
  });
  try {
    await child.createRuntime();
    const reading = child.inspectAppState!(['camera']);
    if (fenced) { await expect(reading).rejects.toThrow(); expect(fenceNext).toBe(true); }
    else {
      expect(await reading).toMatchObject({ apkSha256: f.state.hash, pid: 42 });
      await expect(manager.acquire('android', 'owned', { signal: AbortSignal.timeout(20) })).rejects.toThrow();
    }
  } finally {
    const before = f.calls.length;
    await Promise.allSettled([child.dispose()]);
    expect(f.calls.slice(before)).toEqual([]); // Readback never adopts a permission or installation cleanup baseline.
    await Promise.allSettled([parent.release()]);
    await rm(root, { recursive: true, force: true });
  }
});
