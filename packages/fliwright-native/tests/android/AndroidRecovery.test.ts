import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NativeOperationContext } from '@fliwright/core';
import { DeviceLeaseManager } from '../../src/DeviceLease.js';
import { inspectDeviceLease } from '../../src/DeviceRecovery.js';
import { AndroidDeviceBinding } from '../../src/android/AndroidDeviceBinding.js';
import { AndroidAppJournal } from '../../src/android/AndroidAppJournal.js';
import { AndroidPermissionJournal } from '../../src/android/AndroidPermissionJournal.js';
import { restoreAndroidRecovery } from '../../src/android/AndroidRecovery.js';
import { androidDeviceIdentity } from '../helpers/androidDeviceIdentity.js';
import { nativeModuleCompiler } from '../helpers/compileNativeModule.js';
import type { ToolExecutor } from '../../src/ToolExecutor.js';

// These integration tests perform real durable writes and fsync on each recovery boundary.
vi.setConfig({ testTimeout: 15000 });

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  await Promise.all(children.splice(0).map(async child => {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await new Promise(resolve => child.once('close', resolve)); }
  }));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
const context = (): NativeOperationContext => ({ requestId: randomUUID(), deadline: Date.now() + 10000, signal: AbortSignal.timeout(10000) });
async function fixture(installedBySession = false) {
  const rootDir = await mkdtemp(join(tmpdir(), 'android-restore-')); roots.push(rootDir);
  const input = { platform: 'android' as const, deviceId: 'avd:dedicated-test', rootDir };
  const manager = new DeviceLeaseManager({ rootDir }), lease = await manager.acquire('android', input.deviceId);
  const device = androidDeviceIdentity('emulator-owned'), binding = lease.recoveryBinding!;
  await new AndroidDeviceBinding({ path: lease.deviceRecoveryPath!, deviceId: 'emulator-owned', avdName: 'dedicated-test', binding,
    executor: device.executor, assertOwned: () => lease.assertOwned!() }).verify(context());
  const app = { appId: 'example.app', activity: 'example.app.MainActivity', sha256: 'b'.repeat(64), uid: 10123,
    installedBySession, minSdk: 24, targetSdk: 35, permissions: ['android.permission.CAMERA'] };
  await new AndroidAppJournal({ path: lease.recoveryPath!, deviceId: 'emulator-owned', recoveryBinding: binding })
    .checkpoint({ ...app, operation: 'running', forward: { hostPort: 3456, devicePort: 4567 } }, context());
  const baseline = [{ permission: 'camera' as const, granted: false, userSet: true, userFixed: true, flags: ['USER_SET', 'USER_FIXED'] }];
  const desired = [{ permission: 'camera' as const, granted: true, userSet: false, userFixed: false, flags: [] }];
  await new AndroidPermissionJournal({ path: lease.permissionRecoveryPath!, deviceId: 'emulator-owned', appId: app.appId,
    recoveryBinding: binding, appIdentity: () => app, assertOwned: () => lease.assertOwned!() })
    .checkpoint({ uid: app.uid, baseline, desired, declaration: [{ permission: 'camera', state: 'granted' }],
      status: 'verified', step: 'readback', observed: desired, restored: false }, context());
  await lease.quarantine('test');
  const ownerPath = join(rootDir, `${lease.key}.lock`, 'owner.json'), owner = JSON.parse(await readFile(ownerPath, 'utf8'));
  await writeFile(ownerPath, JSON.stringify({ ...owner, pid: 2147483000 }));
  const original = Object.fromEntries(await Promise.all(['app-recovery.json', 'permission-recovery.json', 'device-recovery.json', 'owner.json']
    .map(async name => [name, await readFile(join(rootDir, `${lease.key}.lock`, name))])));
  const dirty = await readFile(join(rootDir, `${lease.key}.dirty`));
  const state = { installed: true, sha256: app.sha256, uid: app.uid, stopped: false, running: true,
    granted: true, flags: [] as string[], appOp: 'No operations.', forward: 'emulator-owned tcp:3456 tcp:4567',
    users: 'Users:\n UserInfo{0:Owner:13} running', ignoreMutation: false };
  const calls: string[][] = [];
  const executor: ToolExecutor = async (tool, args, ctx) => {
    calls.push([...args]);
    expect(args.slice(0, 2)).toEqual(['-s', 'emulator-owned']);
    if (args[2] === 'get-serialno' || args[2] === 'emu' || args[3]?.startsWith('getprop') || args[3]?.startsWith('cat /proc/')) return device.executor(tool, args, ctx);
    if (args[2] === 'forward' && args[3] === '--list') return Buffer.from(state.forward + '\nother-device tcp:7788 tcp:9900\n');
    if (args[2] === 'forward' && args[3] === '--remove') { if (!state.ignoreMutation) state.forward = ''; return Buffer.alloc(0); }
    if (args[2] === 'uninstall') { if (!state.ignoreMutation) state.installed = false; return Buffer.from('Success'); }
    const command = args[3];
    if (command === 'am get-current-user') return Buffer.from('0');
    if (command === 'pm list users') return Buffer.from(state.users);
    if (command.startsWith('pm list packages ')) return Buffer.from(state.installed ? 'package:example.app' : '');
    if (command.startsWith('pm path ')) return Buffer.from(state.installed ? 'package:/data/app/owned/base.apk' : '');
    if (command.startsWith('sha256sum ')) return Buffer.from(state.sha256 + '  /data/app/owned/base.apk');
    if (command.startsWith('dumpsys package ')) return Buffer.from(`Packages:\n Package [example.app] (123):\n  userId=${state.uid}\n  versionCode=1 minSdk=24 targetSdk=35\n  User 0: installed=true hidden=false stopped=${state.stopped}\n    runtime permissions:\n      android.permission.CAMERA: granted=${state.granted}, flags=[${state.flags.join('|')}]\n`);
    if (command === 'ps -A -o UID,PID,NAME') return Buffer.from('UID PID NAME\n0 1 init\n' + (state.running ? `${state.uid} 42 custom.app.process\n` : ''));
    if (command.startsWith('cmd appops get ')) return Buffer.from(state.appOp);
    if (command.startsWith('am force-stop ')) { if (!state.ignoreMutation) { state.stopped = true; state.running = false; } return Buffer.alloc(0); }
    if (command.startsWith('pm ')) {
      if (!state.ignoreMutation) {
        if (command.startsWith('pm grant ')) state.granted = true;
        else if (command.startsWith('pm revoke ')) state.granted = false;
        else if (command.startsWith('pm clear-permission-flags ')) state.flags = state.flags.filter(flag => !['USER_SET', 'USER_FIXED'].includes(flag));
        else if (command.startsWith('pm set-permission-flags ')) state.flags = [...state.flags,
          ...(command.includes('user-set') ? ['USER_SET'] : []), ...(command.includes('user-fixed') ? ['USER_FIXED'] : [])];
        else throw new Error(`Unexpected command ${command}`);
      }
      return Buffer.alloc(0);
    }
    throw new Error(`Unexpected command ${args.join(' ')}`);
  };
  const restore = async (options: { executor?: ToolExecutor; onBoundary?(name: string): Promise<void>; signal?: AbortSignal } = {}) =>
    restoreAndroidRecovery(input, { serial: 'emulator-owned', fingerprint: (await inspectDeviceLease(input)).fingerprint, executor, ...options });
  return { input, manager, lease, device, app, state, calls, executor, original, dirty, restore };
}
function mutations(calls: string[][]) { return calls.filter(args => args[2] === 'uninstall' || args[2] === 'forward' && args[3] === '--remove'
  || /^(?:am force-stop|pm (?:grant|revoke|clear-permission-flags|set-permission-flags)) /.test(args[3] ?? '')); }

function crashExecutorFixture() {
  const state = { stopped: false, running: true, granted: true, flags: [] as string[], forwardPresent: true, installed: true,
    forcedStops: 0, revokes: 0, forwardRemovals: 0, uninstalls: 0 };
  const calls: string[][] = [];
  const executor = async (_tool: string, args: readonly string[]) => {
    calls.push([...args]);
    if (args[0] !== '-s' || args[1] !== 'emulator-owned') throw new Error('Unexpected device target.');
    if (args[2] === 'get-serialno') return Buffer.from('emulator-owned\n');
    if (args[2] === 'emu' && args[3] === 'avd' && args[4] === 'name') return Buffer.from('dedicated-test\nOK\n');
    if (args[2] === 'forward' && args[3] === '--list') return Buffer.from(state.forwardPresent ? 'emulator-owned tcp:3456 tcp:4567\n' : '');
    if (args[2] === 'forward' && args[3] === '--remove') { state.forwardPresent = false; state.forwardRemovals++; return Buffer.alloc(0); }
    if (args[2] === 'uninstall') { state.installed = false; state.uninstalls++; return Buffer.from('Success'); }
    if (args[2] === 'shell' && args[3] === 'cat /proc/sys/kernel/random/boot_id') return Buffer.from('11111111-1111-4111-8111-111111111111\n');
    if (args[2] === 'shell' && args[3] === 'getprop ro.build.fingerprint') return Buffer.from('test/android/device:35/build/version:userdebug/test-keys\n');
    if (args[2] === 'shell' && args[3] === 'getprop ro.build.version.sdk') return Buffer.from('35\n');
    if (args[2] === 'forward' && args[3] === '--list') return Buffer.from('emulator-owned tcp:3456 tcp:4567\n');
    if (args[2] === 'shell') {
      const command = args[3];
      if (command === 'am get-current-user') return Buffer.from('0');
      if (command === 'pm list users') return Buffer.from('Users:\n UserInfo{0:Owner:13} running');
      if (command.startsWith('pm list packages ')) return Buffer.from(state.installed ? 'package:example.app' : '');
      if (command.startsWith('pm path ')) return Buffer.from(state.installed ? 'package:/data/app/owned/base.apk' : '');
      if (command.startsWith('sha256sum ')) return Buffer.from('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  /data/app/owned/base.apk');
      if (command.startsWith('dumpsys package ')) return Buffer.from(`Packages:\n Package [example.app] (123):\n  userId=10123\n  versionCode=1 minSdk=24 targetSdk=35\n  User 0: installed=true hidden=false stopped=${state.stopped}\n    runtime permissions:\n      android.permission.CAMERA: granted=${state.granted}, flags=[${state.flags.join('|')}]\n`);
      if (command === 'ps -A -o UID,PID,NAME') return Buffer.from(`UID PID NAME\n0 1 init\n${state.running ? '10123 42 custom.app.process\n' : ''}`);
      if (command.startsWith('cmd appops get ')) return Buffer.from('No operations.');
      if (command.startsWith('am force-stop ')) { state.stopped = true; state.running = false; state.forcedStops++; return Buffer.alloc(0); }
      if (command.startsWith('pm revoke ')) { state.granted = false; state.revokes++; return Buffer.alloc(0); }
      if (command.startsWith('pm clear-permission-flags ')) { state.flags = state.flags.filter(flag => !['USER_SET', 'USER_FIXED'].includes(flag)); return Buffer.alloc(0); }
      if (command.startsWith('pm set-permission-flags ')) { state.flags = [...new Set([...state.flags, ...(command.includes('user-set') ? ['USER_SET'] : []), ...(command.includes('user-fixed') ? ['USER_FIXED'] : [])])]; return Buffer.alloc(0); }
    }
    throw new Error(`Unexpected command ${args.join(' ')}`);
  };
  return { state, calls, executor };
}

it.each([false, true])('restores captured flags, owned forwarding and installation ownership (%s) before archiving original bytes', async installed => {
  const f = await fixture(installed), result = await f.restore();
  expect(result.status).toBe('retired');
  expect(f.state).toMatchObject({ installed: !installed, running: false, stopped: true, granted: false, flags: ['USER_SET', 'USER_FIXED'], forward: '' });
  for (const [name, bytes] of Object.entries(f.original)) expect(await readFile(join(result.archiveDirectory, 'original.lock', name))).toEqual(bytes);
  expect(await readFile(join(result.archiveDirectory, 'original.dirty'))).toEqual(f.dirty);
  expect(f.calls.some(args => args.includes('--remove-all'))).toBe(false);
  expect(await inspectDeviceLease(f.input)).toMatchObject({ state: 'available' });
  const next = await f.manager.acquire('android', f.input.deviceId); await next.release();
}, 15000);

it.each(['boot', 'avd', 'apk', 'uid', 'flags', 'sensitive-flags', 'app-op', 'users', 'forward'] as const)('refuses changed %s before any mutation', async kind => {
  const f = await fixture();
  if (kind === 'boot') f.device.state.bootId = randomUUID();
  if (kind === 'avd') f.device.state.avdName = 'other';
  if (kind === 'apk') f.state.sha256 = 'c'.repeat(64);
  if (kind === 'uid') f.state.uid++;
  if (kind === 'flags') f.state.flags = ['SYSTEM_FIXED'];
  if (kind === 'sensitive-flags') f.state.flags = ['USER_SENSITIVE_WHEN_GRANTED'];
  if (kind === 'app-op') f.state.appOp = 'CAMERA: ignore';
  if (kind === 'users') f.state.users += '\n UserInfo{10:Work:10}';
  if (kind === 'forward') f.state.forward = 'other-device tcp:3456 tcp:4567';
  await expect(f.restore()).rejects.toThrow();
  expect(mutations(f.calls)).toEqual([]);
  expect(await readFile(f.lease.permissionRecoveryPath!)).toEqual(f.original['permission-recovery.json']);
  await expect(f.manager.acquire('android', f.input.deviceId)).rejects.toMatchObject({ code: 'device_busy' });
});

it('reconciles an applied write after a lost reply without repeating it', async () => {
  const f = await fixture(); let lost = false;
  await expect(f.restore({ executor: async (tool, args, ctx) => {
    const result = await f.executor(tool, args, ctx);
    if (!lost && args[3]?.startsWith('pm revoke ')) { lost = true; throw new Error('reply lost'); }
    return result;
  } })).rejects.toThrow('reply lost');
  expect(f.state.granted).toBe(false);
  await f.restore();
  expect(f.calls.filter(args => args[3]?.startsWith('pm revoke '))).toHaveLength(1);
});

it('retains a pending write which did not take effect and never repeats it on explicit resume', async () => {
  const f = await fixture();
  await expect(f.restore({ executor: async (tool, args, ctx) => {
    if (args[3]?.startsWith('pm revoke ')) throw new Error('unknown dispatch');
    return f.executor(tool, args, ctx);
  } })).rejects.toThrow();
  const before = mutations(f.calls).length;
  await expect(f.restore()).rejects.toMatchObject({ code: 'action_outcome_unknown' });
  expect(mutations(f.calls)).toHaveLength(before);
  expect(await readdir(f.input.rootDir)).toContain(`${f.lease.key}.recovery`);
});

it.each([
  { stopped: false, running: true },
  { stopped: true, running: true },
  { stopped: false, running: false },
])('does not restore permissions when app stop proof changes before dispatch (%j)', async changed => {
  const f = await fixture(true);
  await expect(f.restore({ onBoundary: async name => {
    if (name === 'permission.camera.grant.pending') Object.assign(f.state, changed);
  } })).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(mutations(f.calls).map(args => args[3])).toEqual(["am force-stop --user 0 'example.app'"]);
  expect(f.state).toMatchObject({ installed: true, granted: true, flags: [], forward: 'emulator-owned tcp:3456 tcp:4567' });
  expect(await readFile(f.lease.permissionRecoveryPath!)).toEqual(f.original['permission-recovery.json']);
  await expect(f.manager.acquire('android', f.input.deviceId)).rejects.toMatchObject({ code: 'device_busy' });
});

it('rechecks app stop proof at the platform write boundary after its earlier readback', async () => {
  const f = await fixture(true);
  let armed = false, probes = 0;
  await expect(f.restore({
    onBoundary: async name => { if (name === 'permission.camera.grant.pending') armed = true; },
    executor: async (tool, args, ctx) => {
      // The first two device probes enclose the outer observation; the third
      // starts the platform mutation after that observation has completed.
      if (armed && args[2] === 'get-serialno' && ++probes === 3) {
        f.state.stopped = false; f.state.running = true;
      }
      return f.executor(tool, args, ctx);
    },
  })).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(probes).toBeGreaterThanOrEqual(3);
  expect(mutations(f.calls).map(args => args[3])).toEqual(["am force-stop --user 0 'example.app'"]);
  expect(f.state.granted).toBe(true);
});

it('does not replay stop or continue permission restoration when the app restarts before explicit resume', async () => {
  const f = await fixture(true);
  await expect(f.restore({ onBoundary: async name => {
    if (name === 'permission.camera.grant.verified') throw new Error('interrupt after verified grant');
  } })).rejects.toThrow('interrupt after verified grant');
  const before = f.calls.length;
  f.state.running = true; f.state.stopped = false;
  await expect(f.restore()).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(mutations(f.calls.slice(before))).toEqual([]);
  expect(f.state).toMatchObject({ installed: true, granted: false, flags: [], forward: 'emulator-owned tcp:3456 tcp:4567' });
  expect(await readFile(f.lease.permissionRecoveryPath!)).toEqual(f.original['permission-recovery.json']);
  await expect(f.manager.acquire('android', f.input.deviceId)).rejects.toMatchObject({ code: 'device_busy' });
});

it.each(['forward.remove.pending', 'app.uninstall.pending'])('refuses %s when the app restarts after earlier permission restoration', async boundary => {
  const f = await fixture(true);
  let before: number | undefined;
  await expect(f.restore({ onBoundary: async name => {
    if (name === boundary) {
      before = f.calls.length; f.state.stopped = false; f.state.running = true;
    }
  } })).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(before).toBeDefined();
  expect(mutations(f.calls.slice(before))).toEqual([]);
  expect(f.state.installed).toBe(true);
  expect(await readFile(f.lease.recoveryPath!)).toEqual(f.original['app-recovery.json']);
});

it('retains an unknown permission write when its readback sees an app restart and never advances or replays it', async () => {
  const f = await fixture(true);
  await expect(f.restore({ executor: async (tool, args, ctx) => {
    const result = await f.executor(tool, args, ctx);
    if (args[3]?.startsWith('pm revoke ')) { f.state.stopped = false; f.state.running = true; }
    return result;
  } })).rejects.toMatchObject({ code: 'action_outcome_unknown' });
  const writes = mutations(f.calls);
  expect(writes).toHaveLength(2);
  expect(writes[0][3]).toMatch(/^am force-stop /);
  expect(writes[1][3]).toMatch(/^pm revoke /);
  expect(f.state).toMatchObject({ installed: true, granted: false, flags: [], forward: 'emulator-owned tcp:3456 tcp:4567' });
  const before = f.calls.length;
  await expect(f.restore()).rejects.toMatchObject({ code: 'action_outcome_unknown' });
  expect(mutations(f.calls.slice(before))).toEqual([]);
});

it('rejects a stale fingerprint and an unknown forward allocation without starting platform work', async () => {
  const f = await fixture(), fingerprint = (await inspectDeviceLease(f.input)).fingerprint;
  const app = JSON.parse(await readFile(f.lease.recoveryPath!, 'utf8')); delete app.forward; app.operation = 'forward';
  await writeFile(f.lease.recoveryPath!, JSON.stringify(app));
  await expect(restoreAndroidRecovery(f.input, { serial: 'emulator-owned', fingerprint, executor: f.executor })).rejects.toThrow();
  await expect(f.restore()).rejects.toThrow();
  expect(f.calls).toEqual([]);
});

it('takes over an actual SIGKILLed Android recovery owner and completes from the durable claim', async () => {
  const f = await fixture(), compiler = nativeModuleCompiler(join(f.input.rootDir, 'compiled'));
  const url = await compiler('android/AndroidRecovery'), fingerprint = (await inspectDeviceLease(f.input)).fingerprint;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {restoreAndroidRecovery} from ${JSON.stringify(url)};
    await restoreAndroidRecovery(${JSON.stringify(f.input)}, { serial:'emulator-owned', fingerprint:${JSON.stringify(fingerprint)},
      executor:async()=>{throw new Error('No platform work is expected before the claim boundary.');},
      onBoundary:async name=>{if(name==='claimed'){process.send('claimed');await new Promise(()=>{});}}
    });
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.push(child);
  let errors = ''; child.stderr!.on('data', data => { errors += data; });
  const closed = new Promise(resolve => child.once('close', resolve));
  await new Promise<void>((resolve, reject) => {
    child.once('message', () => resolve()); child.once('error', reject);
    void closed.then(() => reject(new Error(`Recovery exited before the claimed boundary: ${errors}`)));
  });
  child.kill('SIGKILL'); await closed;
  const report = await inspectDeviceLease(f.input);
  await expect(f.manager.acquire('android', f.input.deviceId)).rejects.toMatchObject({ code: 'device_busy' });
  const result = await f.restore();
  expect(result.status).toBe('retired');
  expect(await readFile(join(result.archiveDirectory, 'original.lock', 'app-recovery.json'))).toEqual(f.original['app-recovery.json']);
  expect(await readFile(join(result.archiveDirectory, 'original.dirty'))).toEqual(f.dirty);
  expect(await inspectDeviceLease(f.input)).toMatchObject({ state: 'available' });
  expect(report.recovery).toBe('exited');
}, 30000);

it('reconciles a permission write after its recovery owner is SIGKILLed before readback without replaying it', async () => {
  const f = await fixture(), compiler = nativeModuleCompiler(join(f.input.rootDir, 'compiled'));
  const url = await compiler('android/AndroidRecovery'), fingerprint = (await inspectDeviceLease(f.input)).fingerprint;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {restoreAndroidRecovery} from ${JSON.stringify(url)};
    const fixture=(${crashExecutorFixture.toString()})();
    await restoreAndroidRecovery(${JSON.stringify(f.input)}, { serial:'emulator-owned', fingerprint:${JSON.stringify(fingerprint)}, executor:fixture.executor,
      onBoundary:async name=>{if(name==='permission.camera.grant.dispatched'){process.send({state:fixture.state,forcedStops:fixture.state.forcedStops,revokes:fixture.state.revokes});await new Promise(()=>{});}}
    });
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.push(child);
  let errors = ''; child.stderr!.on('data', data => { errors += data; });
  const closed = new Promise(resolve => child.once('close', resolve));
  const boundary = await new Promise<{ state: { stopped: boolean; running: boolean; granted: boolean }; forcedStops: number; revokes: number }>((resolve, reject) => {
    child.once('message', resolve); child.once('error', reject);
    void closed.then(() => reject(new Error(`Recovery exited before its permission write: ${errors}`)));
  });
  expect(boundary.forcedStops).toBe(1);
  expect(boundary.revokes).toBe(1);
  f.state.stopped = boundary.state.stopped; f.state.running = boundary.state.running; f.state.granted = boundary.state.granted;
  child.kill('SIGKILL'); await closed;
  const report = await inspectDeviceLease(f.input);
  expect(report.recovery).toBe('exited');
  await expect(f.manager.acquire('android', f.input.deviceId)).rejects.toMatchObject({ code: 'device_busy' });
  const result = await f.restore();
  expect(result.status).toBe('retired');
  expect(f.calls.some(args => args[3]?.startsWith('am force-stop '))).toBe(false);
  expect(f.calls.some(args => args[3]?.startsWith('pm revoke '))).toBe(false);
  expect(f.state).toMatchObject({ stopped: true, running: false, granted: false });
  expect(await readFile(join(result.archiveDirectory, 'original.dirty'))).toEqual(f.dirty);
}, 30000);

it('reconciles a removed forward after its recovery owner is SIGKILLed before readback without replaying it', async () => {
  const f = await fixture(), compiler = nativeModuleCompiler(join(f.input.rootDir, 'compiled'));
  const url = await compiler('android/AndroidRecovery'), fingerprint = (await inspectDeviceLease(f.input)).fingerprint;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {restoreAndroidRecovery} from ${JSON.stringify(url)};
    const fixture=(${crashExecutorFixture.toString()})();
    await restoreAndroidRecovery(${JSON.stringify(f.input)}, { serial:'emulator-owned', fingerprint:${JSON.stringify(fingerprint)}, executor:fixture.executor,
      onBoundary:async name=>{if(name==='forward.remove.dispatched'){process.send({state:fixture.state});await new Promise(()=>{});}}
    });
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.push(child);
  let errors = ''; child.stderr!.on('data', data => { errors += data; });
  const closed = new Promise(resolve => child.once('close', resolve));
  const boundary = await new Promise<{ state: { stopped: boolean; running: boolean; granted: boolean; flags: string[]; forwardPresent: boolean; forcedStops: number; revokes: number; forwardRemovals: number } }>((resolve, reject) => {
    child.once('message', resolve); child.once('error', reject);
    void closed.then(() => reject(new Error(`Recovery exited before its forward removal: ${errors}`)));
  });
  expect(boundary.state.forwardPresent).toBe(false);
  expect(boundary.state.forwardRemovals).toBe(1);
  f.state.stopped = boundary.state.stopped; f.state.running = boundary.state.running; f.state.granted = boundary.state.granted; f.state.flags = boundary.state.flags;
  f.state.forward = '';
  child.kill('SIGKILL'); await closed;
  const report = await inspectDeviceLease(f.input);
  expect(report.recovery).toBe('exited');
  await expect(f.manager.acquire('android', f.input.deviceId)).rejects.toMatchObject({ code: 'device_busy' });
  const result = await f.restore();
  expect(result.status).toBe('retired');
  expect(f.calls.some(args => args[2] === 'forward' && args[3] === '--remove')).toBe(false);
  expect(f.state.forward).toBe('');
  expect(await readFile(join(result.archiveDirectory, 'original.dirty'))).toEqual(f.dirty);
}, 30000);

it('reconciles an uninstall after its recovery owner is SIGKILLed before readback without replaying it', async () => {
  const f = await fixture(true), compiler = nativeModuleCompiler(join(f.input.rootDir, 'compiled'));
  const url = await compiler('android/AndroidRecovery'), fingerprint = (await inspectDeviceLease(f.input)).fingerprint;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {restoreAndroidRecovery} from ${JSON.stringify(url)};
    const fixture=(${crashExecutorFixture.toString()})();
    await restoreAndroidRecovery(${JSON.stringify(f.input)}, { serial:'emulator-owned', fingerprint:${JSON.stringify(fingerprint)}, executor:fixture.executor,
      onBoundary:async name=>{if(name==='app.uninstall.dispatched'){process.send({state:fixture.state});await new Promise(()=>{});}}
    });
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.push(child);
  let errors = ''; child.stderr!.on('data', data => { errors += data; });
  const closed = new Promise(resolve => child.once('close', resolve));
  const boundary = await new Promise<{ state: { stopped: boolean; running: boolean; granted: boolean; flags: string[]; forwardPresent: boolean;
    installed: boolean; forcedStops: number; revokes: number; forwardRemovals: number; uninstalls: number } }>((resolve, reject) => {
    child.once('message', resolve); child.once('error', reject);
    void closed.then(() => reject(new Error(`Recovery exited before its uninstall: ${errors}`)));
  });
  expect(boundary.state.installed).toBe(false);
  expect(boundary.state.uninstalls).toBe(1);
  f.state.stopped = boundary.state.stopped; f.state.running = boundary.state.running; f.state.granted = boundary.state.granted;
  f.state.flags = boundary.state.flags; f.state.forward = ''; f.state.installed = false;
  child.kill('SIGKILL'); await closed;
  const report = await inspectDeviceLease(f.input);
  expect(report.recovery).toBe('exited');
  await expect(f.manager.acquire('android', f.input.deviceId)).rejects.toMatchObject({ code: 'device_busy' });
  const result = await f.restore();
  expect(result.status).toBe('retired');
  expect(f.calls.some(args => args[2] === 'uninstall')).toBe(false);
  expect(f.state.installed).toBe(false);
  expect(await readFile(join(result.archiveDirectory, 'original.dirty'))).toEqual(f.dirty);
}, 30000);

const archiveCrashBoundaries = ['readback-completed', 'archiving', 'lock-renamed', 'lock-destination-synced', 'lock-synced',
  'dirty-renamed', 'dirty-destination-synced', 'dirty-synced', 'archived'] as const;

it.each(archiveCrashBoundaries)('resumes Android recovery after SIGKILL at %s and preserves original evidence', async boundaryName => {
  const f = await fixture(), compiler = nativeModuleCompiler(join(f.input.rootDir, 'compiled'));
  const url = await compiler('android/AndroidRecovery'), fingerprint = (await inspectDeviceLease(f.input)).fingerprint;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {restoreAndroidRecovery} from ${JSON.stringify(url)};
    const fixture=(${crashExecutorFixture.toString()})();
    await restoreAndroidRecovery(${JSON.stringify(f.input)}, { serial:'emulator-owned', fingerprint:${JSON.stringify(fingerprint)}, executor:fixture.executor,
      onBoundary:async name=>{if(name===${JSON.stringify(boundaryName)}){process.send({state:fixture.state});await new Promise(()=>{});}}
    });
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.push(child);
  let errors = ''; child.stderr!.on('data', data => { errors += data; });
  const closed = new Promise(resolve => child.once('close', resolve));
  const message = await new Promise<{ state: { stopped: boolean; running: boolean; granted: boolean; flags: string[];
    forwardPresent: boolean; installed: boolean } }>((resolve, reject) => {
    child.once('message', resolve); child.once('error', reject);
    void closed.then(() => reject(new Error(`Recovery exited before ${boundaryName}: ${errors}`)));
  });
  f.state.stopped = message.state.stopped; f.state.running = message.state.running; f.state.granted = message.state.granted;
  f.state.flags = message.state.flags; f.state.forward = message.state.forwardPresent ? 'emulator-owned tcp:3456 tcp:4567' : '';
  f.state.installed = message.state.installed;
  child.kill('SIGKILL'); await closed;
  const report = await inspectDeviceLease(f.input);
  expect(report.recovery).toBe('exited');
  await expect(f.manager.acquire('android', f.input.deviceId)).rejects.toMatchObject({ code: 'device_busy' });
  const result = await f.restore();
  expect(result.status).toBe('retired');
  for (const [name, bytes] of Object.entries(f.original)) {
    expect(await readFile(join(result.archiveDirectory, 'original.lock', name))).toEqual(bytes);
  }
  expect(await readFile(join(result.archiveDirectory, 'original.dirty'))).toEqual(f.dirty);
  expect(await inspectDeviceLease(f.input)).toMatchObject({ state: 'available' });
  const next = await f.manager.acquire('android', f.input.deviceId); await next.release();
}, 30000);

const verifiedCrashBoundaries = ['app.stop.verified', 'permission.camera.grant.verified', 'permission.camera.clear-flags.verified',
  'permission.camera.set-flags.verified', 'permissions.readback.verified', 'forward.remove.verified', 'app.uninstall.verified'] as const;

it.each(verifiedCrashBoundaries)('continues after a verified Android action at %s when its owner is SIGKILLed', async boundaryName => {
  const f = await fixture(boundaryName === 'app.uninstall.verified'), compiler = nativeModuleCompiler(join(f.input.rootDir, 'compiled'));
  const url = await compiler('android/AndroidRecovery'), fingerprint = (await inspectDeviceLease(f.input)).fingerprint;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {restoreAndroidRecovery} from ${JSON.stringify(url)};
    const fixture=(${crashExecutorFixture.toString()})();
    await restoreAndroidRecovery(${JSON.stringify(f.input)}, { serial:'emulator-owned', fingerprint:${JSON.stringify(fingerprint)}, executor:fixture.executor,
      onBoundary:async name=>{if(name===${JSON.stringify(boundaryName)}){process.send({state:fixture.state});await new Promise(()=>{});}}
    });
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.push(child);
  let errors = ''; child.stderr!.on('data', data => { errors += data; });
  const closed = new Promise(resolve => child.once('close', resolve));
  const message = await new Promise<{ state: { stopped: boolean; running: boolean; granted: boolean; flags: string[];
    forwardPresent: boolean; installed: boolean } }>((resolve, reject) => {
    child.once('message', resolve); child.once('error', reject);
    void closed.then(() => reject(new Error(`Recovery exited before the verified action: ${errors}`)));
  });
  f.state.stopped = message.state.stopped; f.state.running = message.state.running; f.state.granted = message.state.granted;
  f.state.flags = message.state.flags; f.state.forward = message.state.forwardPresent ? 'emulator-owned tcp:3456 tcp:4567' : '';
  f.state.installed = message.state.installed;
  child.kill('SIGKILL'); await closed;
  const result = await f.restore();
  expect(result.status).toBe('retired');
  const repeated = boundaryName === 'app.stop.verified' ? f.calls.some(args => args[3]?.startsWith('am force-stop '))
    : boundaryName === 'permission.camera.grant.verified' ? f.calls.some(args => args[3]?.startsWith('pm revoke '))
      : boundaryName === 'permission.camera.clear-flags.verified' ? f.calls.some(args => args[3]?.startsWith('pm clear-permission-flags '))
        : boundaryName === 'permission.camera.set-flags.verified' ? f.calls.some(args => args[3]?.startsWith('pm set-permission-flags '))
          : boundaryName === 'forward.remove.verified' ? f.calls.some(args => args[2] === 'forward' && args[3] === '--remove')
            : boundaryName === 'app.uninstall.verified' && f.calls.some(args => args[2] === 'uninstall');
  expect(repeated).toBe(false);
  expect(await inspectDeviceLease(f.input)).toMatchObject({ state: 'available' });
}, 30000);

it.each(['app.stop.verified', 'permission.camera.grant.verified'])('keeps Android recovery isolated when %s changes before explicit resume', async boundary => {
  const f = await fixture(), compiler = nativeModuleCompiler(join(f.input.rootDir, 'compiled'));
  const url = await compiler('android/AndroidRecovery'), fingerprint = (await inspectDeviceLease(f.input)).fingerprint;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {restoreAndroidRecovery} from ${JSON.stringify(url)};
    const fixture=(${crashExecutorFixture.toString()})();
    await restoreAndroidRecovery(${JSON.stringify(f.input)}, { serial:'emulator-owned', fingerprint:${JSON.stringify(fingerprint)}, executor:fixture.executor,
      onBoundary:async name=>{if(name===${JSON.stringify(boundary)}){process.send({state:fixture.state});await new Promise(()=>{});}}
    });
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.push(child);
  let errors = ''; child.stderr!.on('data', data => { errors += data; });
  const closed = new Promise(resolve => child.once('close', resolve));
  const message = await new Promise<{ state: { granted: boolean; flags: string[] } }>((resolve, reject) => {
    child.once('message', resolve); child.once('error', reject);
    void closed.then(() => reject(new Error(`Recovery exited before the verified action: ${errors}`)));
  });
  child.kill('SIGKILL'); await closed;
  f.state.granted = message.state.granted; f.state.flags = message.state.flags;
  f.state.stopped = false; f.state.running = true;
  await expect(f.restore()).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(mutations(f.calls)).toEqual([]);
  await expect(f.manager.acquire('android', f.input.deviceId)).rejects.toMatchObject({ code: 'device_busy' });
  expect(await readFile(f.lease.permissionRecoveryPath!)).toEqual(f.original['permission-recovery.json']);
}, 30000);

const pendingCrashBoundaries = [
  { boundary: 'app.stop.pending', installedBySession: false },
  { boundary: 'permission.camera.grant.pending', installedBySession: false },
  { boundary: 'permission.camera.set-flags.pending', installedBySession: false },
  { boundary: 'forward.remove.pending', installedBySession: false },
  { boundary: 'app.uninstall.pending', installedBySession: true },
] as const;

it.each(pendingCrashBoundaries)('retains an unknown pending Android write after SIGKILL at $boundary without replay', async ({ boundary, installedBySession }) => {
  const f = await fixture(installedBySession), compiler = nativeModuleCompiler(join(f.input.rootDir, 'compiled'));
  const url = await compiler('android/AndroidRecovery'), fingerprint = (await inspectDeviceLease(f.input)).fingerprint;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {restoreAndroidRecovery} from ${JSON.stringify(url)};
    const fixture=(${crashExecutorFixture.toString()})();
    await restoreAndroidRecovery(${JSON.stringify(f.input)}, { serial:'emulator-owned', fingerprint:${JSON.stringify(fingerprint)}, executor:fixture.executor,
      onBoundary:async name=>{if(name===${JSON.stringify(boundary)}){process.send({state:fixture.state});await new Promise(()=>{});}}
    });
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.push(child);
  let errors = ''; child.stderr!.on('data', data => { errors += data; });
  const closed = new Promise(resolve => child.once('close', resolve));
  const message = await new Promise<{ state: { stopped: boolean; running: boolean; granted: boolean; flags: string[];
    forwardPresent: boolean; installed: boolean } }>((resolve, reject) => {
    child.once('message', resolve); child.once('error', reject);
    void closed.then(() => reject(new Error(`Recovery exited before ${boundary}: ${errors}`)));
  });
  f.state.stopped = message.state.stopped; f.state.running = message.state.running; f.state.granted = message.state.granted;
  f.state.flags = message.state.flags; f.state.forward = message.state.forwardPresent ? 'emulator-owned tcp:3456 tcp:4567' : '';
  f.state.installed = message.state.installed;
  child.kill('SIGKILL'); await closed;
  await expect(f.restore()).rejects.toMatchObject({ code: 'action_outcome_unknown' });
  expect(mutations(f.calls)).toEqual([]);
  await expect(f.manager.acquire('android', f.input.deviceId)).rejects.toMatchObject({ code: 'device_busy' });
  expect(await readFile(f.lease.permissionRecoveryPath!)).toEqual(f.original['permission-recovery.json']);
  expect(await readdir(f.input.rootDir)).toContain(`${f.lease.key}.recovery`);
}, 30000);
