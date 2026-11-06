import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeSession } from '../src/NativeSession.js';
import { DeviceLeaseManager, deviceLeaseKey } from '../src/DeviceLease.js';
import type { NativeSessionAdapter } from '@fliwright/core';
import { androidDeviceIdentity } from './helpers/androidDeviceIdentity.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const rootDir = await mkdtemp(join(tmpdir(), 'native-session-'));
  roots.push(rootDir);
  const leaseManager = new DeviceLeaseManager({ rootDir, retryDelayMs: 2 });
  const scan = vi.fn(async () => ({ scannedAt: new Date().toISOString(), diagnostics: [], devices: [
    { id: 'emulator-5580', name: 'Test', platform: 'android' as const, kind: 'simulator' as const, state: 'online' as const, avdName: 'dedicated-test' },
  ] }));
  const dispose = vi.fn(async () => {});
  const adapter: NativeSessionAdapter = {
    identity: { deviceId: 'emulator-5580', appId: 'example.app', platform: 'android', backend: 'test', generation: 'one' },
    capabilities: async () => ({}), snapshot: vi.fn(), execute: vi.fn(), screenshot: vi.fn(), dispose,
  };
  const options = { discovery: { scan }, leaseManager, createAdapter: vi.fn(async () => adapter) };
  const config = { enabled: true, platform: 'android' as const, deviceId: 'emulator-5580', targetAppId: 'example.app' };
  return { config, options, dispose };
}
describe('owned native sessions', () => {
  it('validates configuration before discovery or device ownership', async () => {
    const { config, options } = await setup();
    await expect(createNativeSession({ ...config, cleanupTimeoutMs: -1 }, options)).rejects.toMatchObject({ code: 'precondition_failed' });
    expect(options.discovery.scan).not.toHaveBeenCalled();
    expect(options.createAdapter).not.toHaveBeenCalled();
  });

  it('checks missing iOS products before acquiring a device lease', async () => {
    const { options } = await setup();
    options.discovery.scan.mockResolvedValue({ devices: [{ id: 'ios-test', platform: 'ios', kind: 'simulator', state: 'online' }], diagnostics: [] } as never);
    const acquire = vi.spyOn(options.leaseManager, 'acquire');
    await expect(createNativeSession({ enabled: true, platform: 'ios', deviceId: 'ios-test', targetAppId: 'example.app',
      ios: { xctestrunPath: '/missing/runner.xctestrun' } }, { ...options, createAdapter: undefined })).rejects.toMatchObject({ code: 'precondition_failed' });
    expect(acquire).not.toHaveBeenCalled();
  });
  it('requires an explicit online device and never silently picks another one', async () => {
    const { config, options } = await setup();
    await expect(createNativeSession({ ...config, deviceId: 'wrong' }, options)).rejects.toMatchObject({ code: 'device_mismatch' });
    expect(options.createAdapter).not.toHaveBeenCalled();
  });
  it('holds the physical device lease through runtime disposal', async () => {
    const { config, options, dispose } = await setup();
    const runtime = await createNativeSession(config, options);
    await expect(createNativeSession(config, { ...options, signal: AbortSignal.timeout(10) })).rejects.toMatchObject({ code: 'cancelled' });
    await runtime.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    const next = await createNativeSession(config, options);
    await next.dispose();
  });

  it('binds ordinary native actions to the captured Android boot and fences a reboot before the next action', async () => {
    const { config, options } = await setup(), identity = androidDeviceIdentity(config.deviceId);
    const snapshot = vi.fn(async () => ({ id: 'snapshot', identity: adapter.identity, capturedAt: new Date().toISOString(),
      screen: { width: 100, height: 200, scale: 1, orientation: 'portrait' as const }, nodes: [] }));
    const adapter: NativeSessionAdapter = { identity: { deviceId: config.deviceId, appId: config.targetAppId, platform: 'android', backend: 'test', generation: 'one' },
      capabilities: vi.fn(async () => ({ 'native.query': { support: 'supported' as const, ready: true, backend: 'test' } })),
      snapshot, execute: vi.fn(), screenshot: vi.fn(), dispose: vi.fn(async () => {}) };
    const runtime = await createNativeSession(config, { ...options, deviceExecutor: identity.executor,
      createAdapter: vi.fn(async () => adapter) });
    await runtime.native.snapshot();
    expect(snapshot).toHaveBeenCalledOnce();
    const recordPath = join(options.leaseManager.rootDir, `${deviceLeaseKey('android', 'avd:dedicated-test')}.lock`, 'device-recovery.json');
    const original = await import('node:fs/promises').then(fs => fs.readFile(recordPath, 'utf8'));
    identity.state.bootId = '22222222-2222-4222-8222-222222222222';
    await expect(runtime.native.snapshot()).rejects.toMatchObject({ code: 'device_mismatch' });
    expect(snapshot).toHaveBeenCalledOnce();
    await expect(runtime.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(await import('node:fs/promises').then(fs => fs.readFile(recordPath, 'utf8'))).toBe(original);
  });

  it('completes an ordinary Android binding only after confirmed Adapter shutdown', async () => {
    const { config, options } = await setup(), identity = androidDeviceIdentity(config.deviceId);
    const adapter: NativeSessionAdapter = { identity: { deviceId: config.deviceId, appId: config.targetAppId,
      platform: 'android', backend: 'test', generation: 'one' },
      capabilities: vi.fn(async () => ({ 'native.query': { support: 'supported' as const, ready: true, backend: 'test' } })),
      snapshot: vi.fn(async () => ({ id: 'snapshot', identity: { deviceId: config.deviceId, appId: config.targetAppId,
        platform: 'android' as const, backend: 'test', generation: 'one' }, capturedAt: new Date().toISOString(),
        screen: { width: 100, height: 200, scale: 1, orientation: 'portrait' as const }, nodes: [] })),
      execute: vi.fn(), screenshot: vi.fn(), dispose: vi.fn(async () => {}) };
    const runtime = await createNativeSession(config, { ...options, deviceExecutor: identity.executor,
      createAdapter: vi.fn(async () => adapter) });
    await runtime.native.snapshot();
    await runtime.dispose();
    expect(adapter.dispose).toHaveBeenCalledOnce();
    expect(await import('node:fs/promises').then(fs => fs.readdir(options.leaseManager.rootDir))).toEqual([]);
  });

  it('binds an ordinary physical Android session to its serial without Emulator identity commands', async () => {
    const { config, options } = await setup();
    config.deviceId = 'usb-device';
    options.discovery.scan.mockResolvedValue({ scannedAt: new Date().toISOString(), diagnostics: [], devices: [
      { id: config.deviceId, name: 'USB device', platform: 'android', kind: 'physical', state: 'online' },
    ] });
    const identity = androidDeviceIdentity(config.deviceId);
    const adapter: NativeSessionAdapter = { identity: { deviceId: config.deviceId, appId: config.targetAppId,
      platform: 'android', backend: 'test', generation: 'one' },
      capabilities: vi.fn(async () => ({ 'native.query': { support: 'supported' as const, ready: true, backend: 'test' } })),
      snapshot: vi.fn(async () => ({ id: 'snapshot', identity: { deviceId: config.deviceId, appId: config.targetAppId,
        platform: 'android' as const, backend: 'test', generation: 'one' }, capturedAt: new Date().toISOString(),
        screen: { width: 100, height: 200, scale: 1, orientation: 'portrait' as const }, nodes: [] })),
      execute: vi.fn(), screenshot: vi.fn(), dispose: vi.fn(async () => {}) };
    const runtime = await createNativeSession(config, { ...options, deviceExecutor: identity.executor,
      createAdapter: vi.fn(async () => adapter) });
    await runtime.native.snapshot();
    expect(adapter.snapshot).toHaveBeenCalledOnce();
    expect(identity.calls.some(args => args.slice(2, 4).join(' ') === 'emu avd')).toBe(false);
    const path = join(options.leaseManager.rootDir, `${deviceLeaseKey('android', config.deviceId)}.lock`, 'device-recovery.json');
    expect(JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(path, 'utf8')))).toMatchObject({
      leaseKey: deviceLeaseKey('android', config.deviceId),
    });
    await runtime.dispose();
    expect(await import('node:fs/promises').then(fs => fs.readdir(options.leaseManager.rootDir))).toEqual([]);
  });

  it('verifies a delegated Android session against the parent record without exposing its path', async () => {
    const rootDir = await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), 'native-session-delegate-'))); roots.push(rootDir);
    const manager = new DeviceLeaseManager({ rootDir, retryDelayMs: 1 }), identity = androidDeviceIdentity('emulator-5580');
    const parent = await manager.acquire('android', 'avd:dedicated-test');
    const context = { requestId: 'parent-capture', deadline: Date.now() + 5000, signal: AbortSignal.timeout(5000) };
    await parent.verifyAndroidDevice!({ deviceId: 'emulator-5580', avdName: 'dedicated-test', executor: identity.executor }, context);
    const grant = await parent.delegate!();
    const child = await new DeviceLeaseManager({ delegation: grant, retryDelayMs: 1 }).acquire('android', 'avd:dedicated-test');
    expect(child.deviceRecoveryPath).toBeUndefined();
    expect(child.recoveryBinding).toBeUndefined();
    await child.verifyAndroidDevice!({ deviceId: 'emulator-5580', avdName: 'dedicated-test', executor: identity.executor }, context);
    identity.state.bootId = '33333333-3333-4333-8333-333333333333';
    await expect(child.verifyAndroidDevice!({ deviceId: 'emulator-5580', avdName: 'dedicated-test', executor: identity.executor }, context))
      .rejects.toMatchObject({ code: 'device_mismatch' });
    await child.release();
    await expect(parent.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
  });
  it('quarantines the device if adapter cleanup fails', async () => {
    const { config, options, dispose } = await setup();
    const runtime = await createNativeSession(config, options);
    dispose.mockRejectedValue(new Error('runner still running'));
    await expect(runtime.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
    await expect(createNativeSession(config, options)).rejects.toMatchObject({ code: 'cleanup_failed' });
  });
  it('rejects an adapter that belongs to a different device and cleans it up', async () => {
    const { config, options, dispose } = await setup();
    await expect(createNativeSession({ ...config, targetAppId: 'different.app' }, options)).rejects.toMatchObject({ code: 'device_mismatch' });
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it('does no discovery or platform work when disabled', async () => {
    const { config, options } = await setup();
    await expect(createNativeSession({ ...config, enabled: false }, options)).rejects.toMatchObject({ code: 'precondition_failed' });
    expect(options.discovery.scan).not.toHaveBeenCalled();
    expect(options.createAdapter).not.toHaveBeenCalled();
  });

  it('preserves initialization failure when Adapter cleanup and lease release also fail', async () => {
    const { config, options, dispose } = await setup();
    const cleanup = new Error('runner still running'), release = new Error('cannot release lease');
    dispose.mockRejectedValue(cleanup);
    const failure = await createNativeSession({ ...config, targetAppId: 'different.app' }, { ...options,
      leaseManager: { acquire: async () => ({ key: 'test', quarantine: async () => {}, release: async () => { throw release; } }) },
    }).catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors[0]).toMatchObject({ code: 'device_mismatch' });
    expect(failure.errors[1]).toMatchObject({ code: 'cleanup_failed' });
    expect(failure.errors[1].cause).toBeInstanceOf(AggregateError);
    expect(failure.errors[1].cause.errors).toEqual([cleanup, release]);
  });

  it('does not start a delegated Adapter while the supervisor holds platform preparation exclusion', async () => {
    const { config, options } = await setup();
    const parent = await options.leaseManager.acquire('android', 'avd:dedicated-test');
    const delegation = await parent.delegate!();
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const preparing = parent.runExclusive!(async () => { entered(); await gate; });
    await ready;
    const opening = createNativeSession(config, { ...options,
      leaseManager: new DeviceLeaseManager({ delegation, retryDelayMs: 1 }) });
    let runtime: Awaited<typeof opening> | undefined;
    try {
      // Wait until the child has claimed ownership; Adapter construction must still be blocked.
      const { access } = await import('node:fs/promises');
      await vi.waitFor(async () => { await access(join(delegation.rootDir, `${delegation.key}.lock`, 'delegate.lock', 'owner.json')); });
      expect(options.createAdapter).not.toHaveBeenCalled();
      finish(); await preparing;
      runtime = await opening;
      expect(options.createAdapter).toHaveBeenCalledOnce();
    } finally {
      finish(); await preparing;
      runtime ??= await opening;
      await runtime.dispose(); await parent.release();
    }
  });
});
