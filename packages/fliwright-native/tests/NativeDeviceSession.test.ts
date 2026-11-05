import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNativeDevice } from '../src/NativeDeviceSession.js';
import { DeviceLeaseManager, deviceLeaseKey } from '../src/DeviceLease.js';
import { inspectDeviceLease } from '../src/DeviceRecovery.js';
import { androidDeviceIdentity } from './helpers/androidDeviceIdentity.js';
import type { NativeSessionAdapter } from '@fliwright/core';
import type { ToolExecutor } from '../src/ToolExecutor.js';
import { verifyNativeAppProcess } from '../src/NativeBinding.js';

vi.mock('../src/NativeBinding.js', () => ({ verifyNativeAppProcess: vi.fn(async () => {}) }));

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'native-owner-')); roots.push(root);
  const leaseManager = new DeviceLeaseManager({ rootDir: root, retryDelayMs: 2 });
  const config = { enabled: true, platform: 'android' as const, deviceId: 'emulator-test', targetAppId: 'example.app' };
  const adapters: NativeSessionAdapter[] = [];
  const discovery = { scan: vi.fn(async () => ({ scannedAt: new Date().toISOString(), diagnostics: [], devices: [
    { id: config.deviceId, name: 'test', avdName: 'dedicated-test', platform: 'android' as const, kind: 'simulator' as const, state: 'online' as const },
  ] })) };
  const createAdapter = vi.fn(async () => {
    const adapter: NativeSessionAdapter = { identity: { platform: 'android', deviceId: config.deviceId, appId: config.targetAppId,
      backend: 'test', generation: String(adapters.length) }, capabilities: async () => ({}),
      snapshot: vi.fn(), execute: vi.fn(), screenshot: vi.fn(), dispose: vi.fn(async () => {}) };
    adapters.push(adapter); return adapter;
  });
  const deviceIdentity = androidDeviceIdentity(config.deviceId);
  return { config, options: { leaseManager, discovery, createAdapter, deviceExecutor: deviceIdentity.executor }, adapters, deviceIdentity };
}

describe('native device ownership across attempts', () => {
  it('persists stable AVD/serial/boot evidence before preparation and fences a reboot without changing app state', async () => {
    const { config, options, deviceIdentity } = await setup(), executor = vi.fn<ToolExecutor>();
    const owner = await openNativeDevice(config, { ...options, permissionExecutor: executor });
    await owner.preparePermissions!([], { mode: 'managed-start' });
    const key = deviceLeaseKey('android', 'avd:dedicated-test');
    const path = join(options.leaseManager.rootDir, `${key}.lock`, 'device-recovery.json');
    const original = await readFile(path, 'utf8');
    expect(JSON.parse(original)).toMatchObject({ version: 1, leaseKey: key });
    expect(original).not.toMatch(/emulator-test|dedicated-test|test-keys|11111111/);
    expect(await inspectDeviceLease({ platform: 'android', deviceId: 'avd:dedicated-test', rootDir: options.leaseManager.rootDir }))
      .toMatchObject({ deviceRecord: 'present', issues: [] });
    deviceIdentity.state.bootId = '22222222-2222-4222-8222-222222222222';
    await expect(owner.stopApp!({ mode: 'managed-start' })).rejects.toMatchObject({ code: 'device_mismatch' });
    expect(executor).not.toHaveBeenCalled();
    await expect(owner.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(await readFile(path, 'utf8')).toBe(original);
    await expect(options.leaseManager.acquire('android', 'avd:dedicated-test')).rejects.toMatchObject({ code: 'cleanup_failed' });
  });

  it('removes only its confirmed device binding after normal cleanup and leaves unused owners lazy', async () => {
    const { config, options, deviceIdentity } = await setup();
    const owner = await openNativeDevice(config, options);
    expect(deviceIdentity.calls).toEqual([]);
    await owner.preparePermissions!([], { mode: 'managed-start' });
    expect(deviceIdentity.calls.length).toBeGreaterThan(0);
    await owner.dispose();
    expect(await readdir(options.leaseManager.rootDir)).toEqual([]);
  });

  it('captures durable device evidence before permission writes and fences reboot between steps', async () => {
    const { config, options, deviceIdentity } = await setup();
    const path = join(options.leaseManager.rootDir, `${deviceLeaseKey('android', 'avd:dedicated-test')}.lock`, 'device-recovery.json');
    const writes: string[] = [];
    let original = '';
    const owner = await openNativeDevice(config, { ...options, permissionExecutor: async (_program, args) => {
      const command = args[3];
      if (command === 'am get-current-user') return Buffer.from('0');
      if (command === 'ps -A -o UID,PID,NAME') return Buffer.from('UID PID NAME\n0 1 init\n');
      if (command.startsWith('dumpsys package')) return Buffer.from('Package [example.app] (test):\n userId=10123\n targetSdk=35\n User 0: installed=true stopped=true\n runtime permissions:\n android.permission.CAMERA: granted=false, flags=[]\n');
      if (command.startsWith('cmd appops get')) return Buffer.from('No operations.');
      writes.push(command);
      original = await readFile(path, 'utf8');
      expect(JSON.parse(original)).toMatchObject({ version: 1, leaseKey: deviceLeaseKey('android', 'avd:dedicated-test') });
      deviceIdentity.state.bootId = '22222222-2222-4222-8222-222222222222';
      return Buffer.alloc(0);
    } });
    await expect(owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' }))
      .rejects.toMatchObject({ code: 'device_mismatch' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^pm grant /);
    await expect(owner.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(await readFile(path, 'utf8')).toBe(original);
  });

  it('keeps device ownership while disposed attempt adapters are replaced', async () => {
    const { config, options, adapters } = await setup();
    const owner = await openNativeDevice(config, options);
    expect(options.createAdapter).not.toHaveBeenCalled();
    const first = await owner.createRuntime();
    await first.dispose();
    await expect(openNativeDevice(config, { ...options, signal: AbortSignal.timeout(10) })).rejects.toMatchObject({ code: 'cancelled' });
    const second = await owner.createRuntime();
    expect(second.adapter.identity.generation).not.toBe(first.adapter.identity.generation);
    await owner.dispose();
    expect(adapters.every(adapter => vi.mocked(adapter.dispose).mock.calls.length === 1)).toBe(true);
    const next = await openNativeDevice(config, options); await next.dispose();
  });

  it('refuses overlapping adapters and creation after ownership closes', async () => {
    const { config, options, adapters } = await setup();
    const owner = await openNativeDevice(config, options);
    await owner.createRuntime();
    await expect(owner.createRuntime()).rejects.toMatchObject({ code: 'precondition_failed' });
    await Promise.all([owner.dispose(), owner.dispose()]);
    await expect(owner.createRuntime()).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('refuses concurrent Adapter creation even while the owner fence is being checked', async () => {
    const { config, options } = await setup();
    const owner = await openNativeDevice(config, options);
    const attempts = await Promise.allSettled([owner.createRuntime(), owner.createRuntime()]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await owner.dispose();
  });

  it('quarantines after failed attempt cleanup and refuses a retry', async () => {
    const { config, options, adapters } = await setup();
    const owner = await openNativeDevice(config, options);
    const runtime = await owner.createRuntime();
    vi.mocked(adapters[0].dispose).mockRejectedValue(new Error('still running'));
    await expect(runtime.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
    await expect(owner.createRuntime()).rejects.toMatchObject({ code: 'cleanup_failed' });
    await expect(owner.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
    await expect(openNativeDevice(config, options)).rejects.toMatchObject({ code: 'cleanup_failed' });
  });

  it('delegates a managed owner to a child without reacquiring the parent lock', async () => {
    const { config, options, adapters } = await setup();
    const parent = await openNativeDevice(config, options);
    const delegation = await parent.delegate!();
    const child = await openNativeDevice(config, { ...options, leaseManager: new DeviceLeaseManager({ delegation }) });
    const runtime = await child.createRuntime();
    expect(runtime.adapter.identity.deviceId).toBe(config.deviceId);
    await expect(runtime.native.snapshot()).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(adapters[0].snapshot).not.toHaveBeenCalled();
    await child.dispose();
    await expect(openNativeDevice(config, { ...options, signal: AbortSignal.timeout(10) })).rejects.toMatchObject({ code: 'cancelled' });
    await parent.dispose();
    const next = await openNativeDevice(config, options); await next.dispose();
  });

  it('stops its owned Adapter when delegated parent ownership is fenced', async () => {
    const { config, options, adapters } = await setup();
    const parent = await openNativeDevice(config, options);
    const delegation = await parent.delegate!();
    const child = await openNativeDevice(config, { ...options, leaseManager: new DeviceLeaseManager({ delegation }) });
    await child.createRuntime();
    await writeFile(join(delegation.rootDir, `${delegation.key}.lock`, 'owner.json'), JSON.stringify({ token: 'fenced', pid: process.pid }));
    await vi.waitFor(() => expect(adapters[0].dispose).toHaveBeenCalledOnce(), { timeout: 1000 });
    await expect(child.dispose()).rejects.toBeDefined();
  });

  it('prepares permissions under the existing owner and restores them before releasing device exclusion', async () => {
    const { config, options } = await setup();
    let granted = false;
    const writes: string[] = [];
    const executor: ToolExecutor = async (program, args) => {
      expect(program).toBe('owned-adb');
      expect(args.slice(0, 3)).toEqual(['-s', config.deviceId, 'shell']);
      const command = args[3];
      if (command === 'am get-current-user') return Buffer.from('0');
      if (command === 'ps -A -o UID,PID,NAME') return Buffer.from('UID PID NAME\n0 1 init\n');
      if (command.startsWith('dumpsys package')) return Buffer.from(`Package [example.app] (test):\n  userId=10123\n  targetSdk=35\n  User 0: installed=true stopped=true\n    runtime permissions:\n      android.permission.CAMERA: granted=${granted}, flags=[]\n`);
      if (command.startsWith('cmd appops get')) return Buffer.from('No operations.');
      writes.push(command);
      if (command.startsWith('pm grant ')) granted = true;
      if (command.startsWith('pm revoke ')) granted = false;
      return Buffer.alloc(0);
    };
    const mutableConfig = { ...config, tools: { adb: 'owned-adb' } };
    const parent = await openNativeDevice(mutableConfig, { ...options, permissionExecutor: executor });
    mutableConfig.deviceId = 'other-device'; mutableConfig.targetAppId = 'other.app'; mutableConfig.tools.adb = 'other-adb';
    const delegation = await parent.delegate!();
    const child = await openNativeDevice(config, { ...options, leaseManager: new DeviceLeaseManager({ delegation }) });
    // The supervisor prepares under its retained ownership; it does not reacquire the child's claim.
    const report = await parent.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' });
    expect(report[0]).toMatchObject({ granted: true });
    expect(granted).toBe(true);
    expect(options.createAdapter).not.toHaveBeenCalled();
    await child.dispose();
    await parent.dispose();
    expect(granted).toBe(false);
    expect(writes.some(command => command.startsWith('pm revoke '))).toBe(true);
    const next = await openNativeDevice(config, options); await next.dispose();
  });

  it('blocks Adapter creation while preparation is in flight and quarantines an unknown permission write', async () => {
    const { config, options } = await setup();
    let entered!: () => void, release!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const paused = new Promise<void>(resolve => { release = resolve; });
    const executor: ToolExecutor = async (_program, args) => {
      const command = args[3];
      if (command === 'am get-current-user') return Buffer.from('0');
      if (command === 'ps -A -o UID,PID,NAME') return Buffer.from('UID PID NAME\n0 1 init\n');
      if (command.startsWith('dumpsys package')) return Buffer.from('Package [example.app] (test):\n userId=10123\n targetSdk=35\n User 0: installed=true stopped=true\n runtime permissions:\n android.permission.CAMERA: granted=false, flags=[]\n');
      if (command.startsWith('cmd appops get')) return Buffer.from('No operations.');
      entered(); await paused; throw Error('ADB response lost');
    };
    const owner = await openNativeDevice(config, { ...options, permissionExecutor: executor });
    const preparation = owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' });
    const rejected = expect(preparation).rejects.toThrow('ADB response lost');
    await enteredPromise;
    await expect(owner.createRuntime()).rejects.toMatchObject({ code: 'precondition_failed' });
    await expect(owner.preparePermissions!([], { mode: 'managed-start' })).rejects.toMatchObject({ code: 'precondition_failed' });
    release(); await rejected;
    await expect(owner.createRuntime()).rejects.toMatchObject({ code: 'cleanup_failed' });
    await expect(owner.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
    await expect(openNativeDevice(config, options)).rejects.toMatchObject({ code: 'cleanup_failed' });
  });

  it('refuses attach preparation and preserves a blocked read until cleanup is confirmed', async () => {
    const { config, options } = await setup();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const executor = vi.fn(async () => { entered(); await gate; return Buffer.from('0'); });
    const owner = await openNativeDevice({ ...config, cleanupTimeoutMs: 20 }, { ...options, permissionExecutor: executor });
    await expect(owner.preparePermissions!([], { mode: 'attach' as never })).rejects.toMatchObject({ code: 'precondition_failed' });
    expect(executor).not.toHaveBeenCalled();
    const abort = new AbortController();
    const pending = owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start', signal: abort.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await ready; abort.abort(); await rejected;
    await expect(owner.createRuntime()).rejects.toMatchObject({ code: 'precondition_failed' });
    await expect(owner.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
    release();
    await expect(openNativeDevice(config, options)).rejects.toMatchObject({ code: 'cleanup_failed' });
  });

  it('prevents delegated Adapter calls from crossing an active supervisor preparation', async () => {
    const { config, options, adapters } = await setup();
    const parent = await options.leaseManager.acquire('android', 'avd:dedicated-test');
    const delegation = await parent.delegate!();
    const child = await openNativeDevice(config, { ...options, leaseManager: new DeviceLeaseManager({ delegation, retryDelayMs: 1 }) });
    const runtime = await child.createRuntime();
    const capabilities = vi.spyOn(adapters[0], 'capabilities');
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const preparing = parent.runExclusive!(async () => { entered(); await gate; });
    try {
      await ready;
      await expect(runtime.device.capabilities({ timeout: 20 })).rejects.toThrow();
      expect(capabilities).not.toHaveBeenCalled();
    } finally { finish(); await preparing; await child.dispose(); await parent.release(); }
  });

  it('includes VM process binding in cross-process exclusion and its total timeout budget', async () => {
    const { config, options } = await setup();
    const parent = await options.leaseManager.acquire('android', 'avd:dedicated-test');
    const delegation = await parent.delegate!();
    const child = await openNativeDevice(config, { ...options, leaseManager: new DeviceLeaseManager({ delegation, retryDelayMs: 1 }) });
    vi.mocked(verifyNativeAppProcess).mockClear();
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const preparing = parent.runExclusive!(async () => { entered(); await gate; });
    try {
      await ready;
      await expect(child.verifyAppProcess(4242, { timeout: 20 })).rejects.toMatchObject({ code: 'cancelled' });
      expect(verifyNativeAppProcess).not.toHaveBeenCalled();
      finish(); await preparing;
      await child.verifyAppProcess(4242);
      expect(verifyNativeAppProcess).toHaveBeenCalledOnce();
    } finally { finish(); await preparing; await child.dispose(); await parent.release(); }
  });

  it('preserves Adapter cleanup, quarantine and device-release failures together', async () => {
    const { config, options, adapters } = await setup();
    const adapterFailure = new Error('adapter still running');
    const quarantineFailure = new Error('cannot persist quarantine');
    const releaseFailure = new Error('cannot release owner');
    const owner = await openNativeDevice(config, { ...options, leaseManager: { acquire: async () => ({ key: 'test',
      quarantine: async () => { throw quarantineFailure; }, release: async () => { throw releaseFailure; } }) } });
    await owner.createRuntime();
    vi.mocked(adapters[0].dispose).mockRejectedValue(adapterFailure);
    const failure = await owner.dispose().catch(error => error);
    expect(failure).toMatchObject({ code: 'cleanup_failed' });
    expect(failure.cause).toBeInstanceOf(AggregateError);
    expect(failure.cause.errors.slice(1)).toEqual([quarantineFailure, releaseFailure]);
    expect(failure.cause.errors[0]).toMatchObject({ code: 'cleanup_failed' });
    expect(failure.cause.errors[0].cause).toBeInstanceOf(AggregateError);
    expect(failure.cause.errors[0].cause.errors).toEqual([adapterFailure, quarantineFailure]);
  });

  it('stops the managed app before permission mutation and lets a launched child independently observe state', async () => {
    const { config, options } = await setup();
    let running = true, stopped = false, granted = false;
    const commands: string[] = [];
    const executor: ToolExecutor = async (_program, args) => {
      const command = args[3]; commands.push(command);
      if (command === 'am get-current-user') return Buffer.from('0');
      if (command === 'ps -A -o UID,PID,NAME') return Buffer.from(`UID PID NAME\n0 1 init\n${running ? '10123 88 custom.app.worker\n' : ''}`);
      if (command.startsWith('dumpsys package')) return Buffer.from(`Package [example.app] (test):\n userId=10123\n targetSdk=35\n User 0: installed=true stopped=${stopped}\n runtime permissions:\n android.permission.CAMERA: granted=${granted}, flags=[]\n`);
      if (command.startsWith('cmd appops get')) return Buffer.from('No operations.');
      if (command.startsWith('am force-stop ')) { running = false; stopped = true; }
      else if (command.startsWith('pm grant ')) granted = true;
      else if (command.startsWith('pm revoke ')) granted = false;
      return Buffer.alloc(0);
    };
    const parent = await openNativeDevice(config, { ...options, permissionExecutor: executor });
    await expect(parent.stopApp!({ mode: 'attach' as never })).rejects.toMatchObject({ code: 'precondition_failed' });
    expect(commands).toHaveLength(0);
    const delegation = await parent.delegate!();
    await parent.stopApp!({ mode: 'managed-start' });
    await parent.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' });
    running = true; stopped = false; // Managed launcher obtained a new app endpoint.
    const child = await openNativeDevice(config, { ...options, permissionExecutor: executor,
      leaseManager: new DeviceLeaseManager({ delegation }) });
    const runtime = await child.createRuntime();
    const before = commands.length;
    expect(await child.inspectPermissions!(['camera'])).toMatchObject([{ permission: 'camera', granted: true }]);
    expect(commands.slice(before).every(command => !command.startsWith('pm ') && !command.startsWith('am force-stop'))).toBe(true);
    await expect(child.stopApp!({ mode: 'managed-start' })).rejects.toMatchObject({ code: 'precondition_failed' });
    await runtime.dispose(); await child.dispose();
    expect(granted).toBe(true); // Observation did not adopt a restoration baseline.
    await parent.stopApp!({ mode: 'managed-start' });
    await parent.dispose();
    expect(granted).toBe(false);
  });

  it('quarantines a cancelled force-stop and retains the underlying operation until it exits', async () => {
    const { config, options } = await setup();
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const commands: string[] = [];
    const owner = await openNativeDevice(config, { ...options, permissionExecutor: async (_program, args) => {
      const command = args[3]; commands.push(command);
      if (command === 'am get-current-user') return Buffer.from('0');
      if (command.startsWith('dumpsys package')) return Buffer.from('Package [example.app] (test):\n userId=10123\n User 0: installed=true stopped=false\n');
      if (command.startsWith('am force-stop')) { entered(); await gate; return Buffer.alloc(0); }
      throw new Error('Unexpected command');
    } });
    const abort = new AbortController();
    const stopping = owner.stopApp!({ mode: 'managed-start', signal: abort.signal });
    const cancelled = expect(stopping).rejects.toMatchObject({ code: 'cancelled' });
    await ready; abort.abort(); await cancelled;
    await expect(owner.createRuntime()).rejects.toMatchObject({ code: 'cleanup_failed' });
    let disposed = false;
    const cleanup = owner.dispose().finally(() => { disposed = true; });
    const failedCleanup = expect(cleanup).rejects.toMatchObject({ code: 'cleanup_failed' });
    try {
      await expect(openNativeDevice(config, options)).rejects.toMatchObject({ code: 'cleanup_failed' });
      expect(disposed).toBe(false);
    } finally { finish(); await failedCleanup; }
    expect(commands.filter(command => command.startsWith('am force-stop'))).toHaveLength(1);
    expect(commands.some(command => command.startsWith('pm '))).toBe(false);
  });

  it('includes the shared operation lock wait in read-only permission observation budget', async () => {
    const { config, options } = await setup();
    const parent = await options.leaseManager.acquire('android', 'avd:dedicated-test');
    const delegation = await parent.delegate!();
    const executor = vi.fn<ToolExecutor>();
    const child = await openNativeDevice(config, { ...options, permissionExecutor: executor,
      leaseManager: new DeviceLeaseManager({ delegation, retryDelayMs: 1 }) });
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const preparing = parent.runExclusive!(async () => { entered(); await gate; });
    try {
      await ready;
      await expect(child.inspectPermissions!(['camera'], { timeout: 20 })).rejects.toMatchObject({ code: 'cancelled' });
      expect(executor).not.toHaveBeenCalled();
    } finally { finish(); await preparing; await child.dispose(); await parent.release(); }
  });

  it('shares one cleanup deadline across Adapter disposal and permission restoration and fences late writes', async () => {
    const { config, options, adapters } = await setup();
    let granted = false, restoring = false;
    let releaseAdapter!: () => void, releaseRead!: () => void, observeRestore!: () => void;
    const adapterGate = new Promise<void>(resolve => { releaseAdapter = resolve; });
    const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
    const restoreEntered = new Promise<void>(resolve => { observeRestore = resolve; });
    const writes: string[] = [];
    let restoreContext: { deadline: number; signal: AbortSignal } | undefined;
    const lease = { key: deviceLeaseKey('android', 'avd:dedicated-test'),
      deviceRecoveryPath: join(options.leaseManager.rootDir, 'device-recovery.json'),
      recoveryBinding: { leaseKey: deviceLeaseKey('android', 'avd:dedicated-test'), ownerGeneration: 'a'.repeat(64) }, permissionRecoveryPath: join(options.leaseManager.rootDir, 'permission-recovery.json'),
      quarantine: vi.fn(async () => {}), release: vi.fn(async () => {}),
      runExclusive: async <T>(action: () => Promise<T>) => action() };
    const executor: ToolExecutor = async (_program, args, context) => {
      const command = args[3];
      if (restoring && !restoreContext) { restoreContext = context; observeRestore(); await readGate; }
      if (command === 'am get-current-user') return Buffer.from('0');
      if (command === 'ps -A -o UID,PID,NAME') return Buffer.from('UID PID NAME\n0 1 init\n');
      if (command.startsWith('dumpsys package')) return Buffer.from(`Package [example.app] (test):\n userId=10123\n targetSdk=35\n User 0: installed=true stopped=true\n runtime permissions:\n android.permission.CAMERA: granted=${granted}, flags=[]\n`);
      if (command.startsWith('cmd appops get')) return Buffer.from('No operations.');
      writes.push(command);
      if (command.startsWith('pm grant ')) granted = true;
      if (command.startsWith('pm revoke ')) granted = false;
      return Buffer.alloc(0);
    };
    const owner = await openNativeDevice({ ...config, cleanupTimeoutMs: 40 }, { ...options,
      leaseManager: { acquire: async () => lease }, permissionExecutor: executor });
    await owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' });
    await owner.createRuntime();
    vi.mocked(adapters[0].dispose).mockImplementation(async () => { await adapterGate; });
    const before = writes.length;
    vi.useFakeTimers();
    try {
      const startedAt = Date.now();
      const cleanup = owner.dispose();
      const failed = expect(cleanup).rejects.toMatchObject({ code: 'cleanup_failed' });
      await vi.advanceTimersByTimeAsync(20);
      restoring = true; releaseAdapter(); await restoreEntered;
      await vi.advanceTimersByTimeAsync(20); await failed;
      expect(restoreContext!.deadline).toBe(startedAt + 40);
      expect(restoreContext!.signal.aborted).toBe(true);
      releaseRead(); await vi.advanceTimersByTimeAsync(0);
      expect(writes.slice(before)).toEqual([]);
      expect(granted).toBe(true); // Unknown cleanup is quarantined, never repaired by late writes.
      expect(lease.quarantine).toHaveBeenCalled();
    } finally { releaseAdapter(); releaseRead(); vi.useRealTimers(); }
  });
});
