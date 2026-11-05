import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { copyFile, link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NativeOperationContext } from '@fliwright/core';
import type { ToolExecutor } from '../../src/ToolExecutor.js';
import { AndroidManagedApp } from '../../src/android/AndroidManagedApp.js';
import { openNativeDevice } from '../../src/NativeDeviceSession.js';
import { androidDeviceIdentity } from '../helpers/androidDeviceIdentity.js';
import { DeviceLeaseManager } from '../../src/DeviceLease.js';

const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const context = (): NativeOperationContext => ({ requestId: 'test', deadline: Date.now() + 2000, signal: AbortSignal.timeout(2000) });
const manifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="example.app">
  <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36"/>
  <uses-permission android:name="android.permission.CAMERA"/>
  <application android:debuggable="true"><activity android:name=".MainActivity" android:exported="true">
    <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>
  </activity></application></manifest>`;

async function fixture(existing = false) {
  const root = await mkdtemp(join(tmpdir(), 'android-managed-app-')); roots.push(root);
  const apkPath = join(root, 'app with spaces.apk');
  let recoveryPath = join(root, 'recovery.json');
  let deviceRecoveryPath: string | undefined;
  const bytes = Buffer.from('deterministic signed APK fixture'); await writeFile(apkPath, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const state = { installed: existing, sha256, uid: '10123', running: false, stopped: true, manifest,
    installResult: 'Success\n', failInstall: false, split: false, forward: false, oldLogs: false, granted: false, otherUser: false,
    forwardOwner: 'emulator-owned', logOverride: '' };
  const commands: string[][] = [];
  const executor: ToolExecutor = vi.fn(async (program, args, request) => {
    request.signal.throwIfAborted();
    if (program === 'owned-apkanalyzer') {
      expect(args.slice(0, 2)).toEqual(['manifest', 'print']);
      expect(await readFile(args[2])).toEqual(bytes);
      return Buffer.from(state.manifest);
    }
    expect(program).toBe('owned-adb'); expect(args.slice(0, 2)).toEqual(['-s', 'emulator-owned']);
    const command = args.slice(2); commands.push(command);
    if (command[0] === 'install') {
      if (deviceRecoveryPath) expect(JSON.parse(await readFile(deviceRecoveryPath, 'utf8'))).toMatchObject({ version: 1 });
      const journal = JSON.parse(await readFile(recoveryPath, 'utf8'));
      expect(journal).toMatchObject({ operation: 'install', installedBySession: true, sha256 });
      expect(command).not.toContain('-r'); expect(command).not.toContain('-g');
      expect(await readFile(command.at(-1)!)).toEqual(bytes);
      state.installed = true;
      if (state.failInstall) throw new Error('lost install reply');
      return Buffer.from(state.installResult);
    }
    if (command[0] === 'uninstall') { state.installed = false; return Buffer.from('Success\n'); }
    if (command[0] === 'forward') {
      if (command[1] === '--list') return Buffer.from(state.forward ? `${state.forwardOwner} tcp:45678 tcp:34567\n` : '');
      if (command[1] === '--remove') { state.forward = false; return Buffer.alloc(0); }
      state.forward = true; return Buffer.from('45678\n');
    }
    const shell = command[1];
    if (shell === 'am get-current-user') return Buffer.from('0\n');
    if (shell === 'pm list users') return Buffer.from(`Users:\n UserInfo{0:Owner:13} running\n${state.otherUser ? ' UserInfo{10:Work:30} running\n' : ''}`);
    if (shell.startsWith('pm list packages')) return Buffer.from(state.installed ? 'package:example.app\n' : '');
    if (shell.startsWith('pm path')) return Buffer.from(`package:/data/app/owned/base.apk\n${state.split ? 'package:/data/app/owned/split.apk\n' : ''}`);
    if (shell.startsWith('sha256sum')) return Buffer.from(`${state.sha256}  /data/app/owned/base.apk\n`);
    if (shell.startsWith('dumpsys package')) return Buffer.from(`Package [example.app] (test):\n userId=${state.uid}\n targetSdk=36\n User 0: installed=true stopped=${state.stopped}\n runtime permissions:\n android.permission.CAMERA: granted=${state.granted}, flags=[]\n`);
    if (shell === 'ps -A -o UID,PID,NAME') return Buffer.from(`UID PID NAME\n0 1 init\n${state.running ? `${state.uid} 123 example.app\n` : ''}`);
    if (shell.startsWith('am force-stop ')) { state.running = false; state.stopped = true; return Buffer.alloc(0); }
    if (shell.startsWith('cmd appops get')) return Buffer.from('No operations.');
    if (shell.startsWith('pm grant ')) { state.granted = true; return Buffer.alloc(0); }
    if (shell.startsWith('pm revoke ')) { state.granted = false; return Buffer.alloc(0); }
    if (shell.startsWith('pm clear-permission-flags ')) return Buffer.alloc(0);
    if (shell.startsWith('am start ')) { state.running = true; state.stopped = false; return Buffer.from('Starting: Intent { cmp=example.app/.MainActivity }\n'); }
    if (shell.startsWith('logcat') && shell.includes('-t 1')) return Buffer.from('1700000000.100000  50  50 I other : previous\n');
    if (shell.startsWith('logcat')) return Buffer.from(state.logOverride || (state.oldLogs
      ? '1700000000.000001 123 123 I flutter : The Dart VM service is listening on http://127.0.0.1:34567/old-auth=/\n'
      : '1700000000.200000 123 123 I flutter : The Dart VM service is listening on http://127.0.0.1:34567/secret-auth=/\n'));
    throw new Error(`Unexpected tool command ${command}`);
  });
  const app = new AndroidManagedApp({ deviceId: 'emulator-owned', appId: 'example.app', adbPath: 'owned-adb', recoveryPath, executor });
  const input = { apkPath, apkAnalyzerPath: 'owned-apkanalyzer' };
  const leaseManager = new DeviceLeaseManager({ rootDir: join(root, 'leases'), retryDelayMs: 1 });
  const config = { enabled: true, platform: 'android' as const, deviceId: 'emulator-owned', targetAppId: 'example.app', tools: { adb: 'owned-adb' } };
  const owner = (cleanupTimeoutMs = 15000, signal?: AbortSignal) => openNativeDevice({ ...config, cleanupTimeoutMs }, { signal, discovery: { scan: async () => ({ scannedAt: new Date().toISOString(), diagnostics: [], devices: [
    { id: config.deviceId, name: 'owned', avdName: 'dedicated-test', platform: 'android' as const, kind: 'simulator' as const, state: 'online' as const },
  ] }) }, leaseManager: { acquire: async (...args) => {
    const lease = await leaseManager.acquire(...args);
    recoveryPath = lease.recoveryPath!;
    deviceRecoveryPath = lease.deviceRecoveryPath;
    return lease;
  } },
    appExecutor: executor, permissionExecutor: executor, deviceExecutor: androidDeviceIdentity(config.deviceId).executor });
  return { app, input, state, commands, executor, get recoveryPath() { return recoveryPath; }, sha256, owner, config, leaseManager };
}

describe('owned Android installed app lifecycle', () => {
  it.each(['before-launch', 'endpoint-discovery', 'cleanup'] as const)('refuses duplicate process IDs during %s without later writes', async phase => {
    const f = await fixture(phase !== 'cleanup');
    await f.app.install(f.input, context());
    if (phase === 'cleanup') await f.app.launch(context());
    const execute = f.executor.getMockImplementation()!;
    f.executor.mockImplementation(async (program, args, request) => {
      if (args[3] === 'ps -A -o UID,PID,NAME' && (phase !== 'endpoint-discovery' || f.state.running)) {
        return Buffer.from(`UID PID NAME\n0 1 init\n1000 7 system.server\n2000 7 other.process\n${f.state.running ? '10123 123 example.app\n' : ''}`);
      }
      return execute(program, args, request);
    });
    const before = f.commands.length;
    if (phase === 'cleanup') {
      // Dispose must refuse to remove an installed app until stopped/UID exit is proven.
      f.state.running = false; f.state.stopped = true;
      await expect(f.app.dispose(context())).rejects.toMatchObject({ code: 'protocol_mismatch' });
    } else await expect(f.app.launch(context())).rejects.toMatchObject({ code: 'protocol_mismatch' });
    const later = f.commands.slice(before);
    expect(later.some(args => args[0] === 'uninstall' || args[0] === 'forward' && args[1] !== '--list')).toBe(false);
    expect(later.filter(args => args[1]?.startsWith('am start '))).toHaveLength(phase === 'endpoint-discovery' ? 1 : 0);
    expect(f.app.outcomeUnknown).toBe(phase === 'endpoint-discovery');
    expect(f.state.installed).toBe(true);
  });

  it('quarantines the retained owner when final force-stop cannot verify UID exit and preserves installation and permissions', async () => {
    const f = await fixture(), owner = await f.owner();
    await owner.installApp!(f.input, { mode: 'managed-start' });
    await owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' });
    await owner.launchApp!({ mode: 'managed-start' });
    const execute = f.executor.getMockImplementation()!;
    f.executor.mockImplementation(async (program, args, request) => args[3] === 'ps -A -o UID,PID,NAME'
      ? Buffer.from('UID PID NAME\n0 1 init\n1000 7 system.server\n2000 7 other.process\n') : execute(program, args, request));
    const before = f.commands.length;
    await expect(owner.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(f.commands.slice(before).some(args => args[0] === 'uninstall' || /^pm (?:grant|revoke|clear-permission-flags|set-permission-flags) /.test(args[1] ?? ''))).toBe(false);
    expect(f.state).toMatchObject({ installed: true, granted: true });
    await expect(readFile(f.recoveryPath)).resolves.toBeDefined();
    await expect(f.leaseManager.acquire('android', 'avd:dedicated-test')).rejects.toMatchObject({ code: 'cleanup_failed' });
  });

  it.each([false, true])('removes only its completed recovery record before releasing the actual lease (existing=%s)', async existing => {
    const f = await fixture(existing), owner = await f.owner();
    await owner.installApp!(f.input, { mode: 'managed-start' });
    await owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' });
    await owner.launchApp!({ mode: 'managed-start' });
    await owner.quiesce();
    expect(f.state).toMatchObject({ installed: existing, stopped: true, running: false, granted: false, forward: false });
    await expect(readFile(f.recoveryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(f.leaseManager.rootDir)).toHaveLength(1);
    await owner.dispose();
    expect(await readdir(f.leaseManager.rootDir)).toEqual([]);
    const next = await f.leaseManager.acquire('android', 'avd:dedicated-test'); await next.release();
  });

  it.each([false, true])('keeps terminal evidence until the owner explicitly completes all cleanup (existing=%s)', async existing => {
    const f = await fixture(existing);
    await f.app.install(f.input, context());
    await expect(f.app.complete(context())).rejects.toMatchObject({ code: 'cleanup_failed' });
    await f.app.dispose(context());
    expect(JSON.parse(await readFile(f.recoveryPath, 'utf8'))).toMatchObject({ operation: existing ? 'stopped' : 'removed' });
    const before = f.commands.length;
    await f.app.complete(context());
    await expect(readFile(f.recoveryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await f.app.complete(context());
    expect(f.commands).toHaveLength(before);
  });

  it.each(['copy', 'changed', 'hardlink', 'symlink'] as const)('retains a %s replacement record and refuses further platform writes', async kind => {
    const f = await fixture(true);
    await f.app.install(f.input, context());
    const original = await readFile(f.recoveryPath, 'utf8'), other = `${f.recoveryPath}.other`;
    if (kind === 'copy') { await copyFile(f.recoveryPath, other); await rename(other, f.recoveryPath); }
    if (kind === 'changed') await writeFile(f.recoveryPath, '{}');
    if (kind === 'hardlink') await link(f.recoveryPath, other);
    if (kind === 'symlink') { await rename(f.recoveryPath, other); await symlink(other, f.recoveryPath); }
    const before = f.commands.length;
    await expect(f.app.launch(context())).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(f.commands.slice(before).some(args => args[1]?.startsWith('am start ') || args[0] === 'forward')).toBe(false);
    await expect(f.app.dispose(context())).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(await readFile(f.recoveryPath, 'utf8')).toBe(kind === 'changed' ? '{}' : original);
  });

  it('does not delete a byte-identical replacement of its terminal record', async () => {
    const f = await fixture(); await f.app.install(f.input, context()); await f.app.dispose(context());
    const original = await readFile(f.recoveryPath, 'utf8'), copy = `${f.recoveryPath}.copy`;
    await copyFile(f.recoveryPath, copy); await rename(copy, f.recoveryPath);
    await expect(f.app.complete(context())).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(await readFile(f.recoveryPath, 'utf8')).toBe(original);
  });

  it('retains its terminal record when completion is cancelled', async () => {
    const f = await fixture(); await f.app.install(f.input, context()); await f.app.dispose(context());
    const original = await readFile(f.recoveryPath, 'utf8');
    await expect(f.app.complete({ ...context(), signal: AbortSignal.abort() })).rejects.toBeDefined();
    expect(await readFile(f.recoveryPath, 'utf8')).toBe(original);
  });

  it('does not overwrite a recovery record created between preflight and the first installation checkpoint', async () => {
    const f = await fixture(), execute = vi.mocked(f.executor).getMockImplementation()!;
    vi.mocked(f.executor).mockImplementation(async (program, args, request) => {
      const result = await execute(program, args, request);
      if (args[3] === 'pm list users') await writeFile(f.recoveryPath, '{"original":"retain"}', { flag: 'wx' });
      return result;
    });
    await expect(f.app.install(f.input, context())).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(await readFile(f.recoveryPath, 'utf8')).toBe('{"original":"retain"}');
    expect(f.commands.some(args => args[0] === 'install')).toBe(false);
  });

  it('retains the app record and quarantines the actual lease if permission-journal completion fails after removal', async () => {
    const f = await fixture(), owner = await f.owner();
    await owner.installApp!(f.input, { mode: 'managed-start' });
    await owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' });
    const execute = vi.mocked(f.executor).getMockImplementation()!;
    vi.mocked(f.executor).mockImplementation(async (program, args, request) => {
      const result = await execute(program, args, request);
      if (args[2] === 'uninstall') {
        const permissionPath = join(f.recoveryPath, '..', 'permission-recovery.json');
        await rm(permissionPath); await mkdir(permissionPath);
      }
      return result;
    });
    await expect(owner.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(f.state).toMatchObject({ granted: false, installed: false, running: false });
    expect(JSON.parse(await readFile(f.recoveryPath, 'utf8'))).toMatchObject({ operation: 'removed' });
    expect((await readdir(f.leaseManager.rootDir)).filter(name => name.endsWith('.dirty'))).toHaveLength(1);
    await expect(f.leaseManager.acquire('android', 'avd:dedicated-test')).rejects.toMatchObject({ code: 'cleanup_failed' });
  });

  it('fences managed stop and restoration before writing if its installation record was replaced', async () => {
    const f = await fixture(true), owner = await f.owner();
    await owner.installApp!(f.input, { mode: 'managed-start' });
    await owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' });
    await owner.launchApp!({ mode: 'managed-start' });
    const original = await readFile(f.recoveryPath, 'utf8'), copy = `${f.recoveryPath}.copy`;
    await copyFile(f.recoveryPath, copy); await rename(copy, f.recoveryPath);
    const before = f.commands.length;
    await expect(owner.stopApp!({ mode: 'managed-start' })).rejects.toMatchObject({ code: 'cleanup_failed' });
    await expect(owner.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(f.commands.slice(before)).toEqual([]);
    expect(f.state).toMatchObject({ installed: true, running: true, forward: true, granted: true });
    expect(await readFile(f.recoveryPath, 'utf8')).toBe(original);
  });

  it('installs once without launching and records ownership before writing, then removes only its new installation', async () => {
    const f = await fixture();
    const installed = await f.app.install(f.input, context());
    expect(installed).toMatchObject({ appId: 'example.app', activity: 'example.app.MainActivity', uid: 10123, sha256: f.sha256, installedBySession: true });
    expect(f.commands.filter(args => args[0] === 'install')).toHaveLength(1);
    expect(f.commands.some(args => args[1]?.startsWith('am start '))).toBe(false);
    await f.app.dispose(context());
    expect(f.state.installed).toBe(false);
    expect(f.commands.filter(args => args[0] === 'uninstall')).toHaveLength(1);
  });

  it('keeps a matching existing app and its data without reinstalling or uninstalling', async () => {
    const f = await fixture(true);
    expect(await f.app.install(f.input, context())).toMatchObject({ installedBySession: false });
    await f.app.dispose(context());
    expect(f.commands.filter(args => ['install', 'uninstall'].includes(args[0]))).toEqual([]);
    expect(f.state.installed).toBe(true);
  });

  it('rejects different installed bytes and split APKs before any device write', async () => {
    for (const reason of ['hash', 'split']) {
      const f = await fixture(true);
      if (reason === 'hash') f.state.sha256 = '0'.repeat(64); else f.state.split = true;
      await expect(f.app.install(f.input, context())).rejects.toMatchObject({ code: 'precondition_failed' });
      expect(f.commands.filter(args => ['install', 'uninstall'].includes(args[0]))).toEqual([]);
      expect(f.app.outcomeUnknown).toBe(false);
    }
  });

  it('does not retry or blindly uninstall after a lost or failed install acknowledgement', async () => {
    for (const reason of ['lost', 'failure']) {
      const f = await fixture();
      if (reason === 'lost') f.state.failInstall = true; else f.state.installResult = 'Failure [INSTALL_FAILED]\n';
      await expect(f.app.install(f.input, context())).rejects.toBeDefined();
      expect(f.app.outcomeUnknown).toBe(true);
      await expect(f.app.install(f.input, context())).rejects.toMatchObject({ code: 'cleanup_failed' });
      await expect(f.app.dispose(context())).rejects.toMatchObject({ code: 'cleanup_failed' });
      expect(f.commands.filter(args => args[0] === 'install')).toHaveLength(1);
      expect(f.commands.filter(args => args[0] === 'uninstall')).toEqual([]);
    }
  });

  it('validates package, debug mode, runtime SDK, process and a unique launcher before device mutation', async () => {
    for (const invalid of [manifest.replace('example.app', 'other.app'), manifest.replace('debuggable="true"', 'debuggable="false"'),
      manifest.replace('targetSdkVersion="36"', 'targetSdkVersion="22"'), manifest.replace('<application ', '<application android:process="foreign" '),
      manifest.replace('</application>', '<activity-alias android:name=".Alias" android:targetActivity=".MainActivity"/></application>'),
      '<!DOCTYPE manifest [<!ENTITY x SYSTEM "file:///private">]>' + manifest]) {
      const f = await fixture(); f.state.manifest = invalid;
      await expect(f.app.install(f.input, context())).rejects.toBeDefined();
      expect(f.commands).toEqual([]);
    }
  });

  it('launches the verified installed app repeatedly with fresh generations and only removes its own forwarding', async () => {
    const f = await fixture(true); await f.app.install(f.input, context());
    const first = await f.app.launch(context());
    expect(first).toMatchObject({ pid: 123, url: 'ws://127.0.0.1:45678/secret-auth=/ws' });
    expect(f.commands.findIndex(args => args[1]?.includes('-t 1'))).toBeLessThan(f.commands.findIndex(args => args[1]?.startsWith('am start ')));
    expect(await readFile(f.recoveryPath, 'utf8')).not.toContain('secret-auth');
    await expect(f.app.launch(context())).rejects.toMatchObject({ code: 'precondition_failed' });
    f.state.running = false; f.state.stopped = true;
    await f.app.confirmStopped(context());
    const next = await f.app.launch(context()); expect(next.generation).not.toBe(first.generation);
    f.state.running = false; f.state.stopped = true;
    await f.app.confirmStopped(context()); await f.app.dispose(context());
    expect(f.commands.filter(args => args[0] === 'install')).toEqual([]);
    expect(f.commands.filter(args => args[0] === 'forward' && args[1] === '--remove')).toEqual([
      ['forward', '--remove', 'tcp:45678'], ['forward', '--remove', 'tcp:45678'],
    ]);
  });

  it('journals the verified host and device ports before a post-forward app exit', async () => {
    const f = await fixture(true); await f.app.install(f.input, context());
    const execute = vi.mocked(f.executor).getMockImplementation()!;
    vi.mocked(f.executor).mockImplementation(async (program, args, request) => {
      const result = await execute(program, args, request);
      if (args[2] === 'forward' && args[3] === 'tcp:0') {
        f.state.running = false;
        f.state.stopped = true;
      }
      return result;
    });
    await expect(f.app.launch(context())).rejects.toMatchObject({ code: 'device_mismatch' });
    expect(JSON.parse(await readFile(f.recoveryPath, 'utf8'))).toMatchObject({
      operation: 'forward', forward: { hostPort: 45678, devicePort: 34567 },
    });
    expect(f.app.outcomeUnknown).toBe(true);
  });

  it('rejects stale PID logs rather than attaching to an earlier VM', async () => {
    const f = await fixture(true); await f.app.install(f.input, context()); f.state.oldLogs = true;
    const controller = new AbortController();
    const execute = vi.mocked(f.executor).getMockImplementation()!;
    vi.mocked(f.executor).mockImplementation(async (program, args, request) => {
      const result = await execute(program, args, request);
      // Cancel only after stale logs reach the parser, not during filesystem setup.
      if (args[3]?.startsWith('logcat') && !args[3].includes('-t 1')) setImmediate(() => controller.abort());
      return result;
    });
    await expect(f.app.launch({ requestId: 'old-logs', deadline: Date.now() + 2000, signal: controller.signal })).rejects.toBeDefined();
    expect(f.app.outcomeUnknown).toBe(true);
    expect(f.commands.filter(args => args[0] === 'forward')).toEqual([]);
    expect(f.commands.filter(args => args[1]?.startsWith('am start '))).toHaveLength(1);
  });

  it('refuses cleanup when the app is running or installation identity changed', async () => {
    for (const reason of ['running', 'uid', 'bytes', 'other-user']) {
      const f = await fixture(); await f.app.install(f.input, context());
      if (reason === 'running') { f.state.running = true; f.state.stopped = false; }
      if (reason === 'uid') f.state.uid = '10124';
      if (reason === 'bytes') f.state.sha256 = '0'.repeat(64);
      if (reason === 'other-user') f.state.otherUser = true;
      await expect(f.app.dispose(context())).rejects.toBeDefined();
      expect(f.commands.filter(args => args[0] === 'uninstall')).toEqual([]);
    }
  });

  it('refuses a new install on a device with other users before dispatching package writes', async () => {
    const f = await fixture(); f.state.otherUser = true;
    await expect(f.app.install(f.input, context())).rejects.toMatchObject({ code: 'unsupported_capability' });
    expect(f.commands.filter(args => args[0] === 'install')).toEqual([]);
    expect(f.app.outcomeUnknown).toBe(false);
  });

  it('integrates installation, permission preparation, launch, final stop, restore and removal under the retained owner', async () => {
    const f = await fixture(); const owner = await f.owner();
    await owner.installApp!(f.input, { mode: 'managed-start' });
    await owner.stopApp!({ mode: 'managed-start' });
    await owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' });
    expect(await owner.launchApp!({ mode: 'managed-start' })).toMatchObject({ pid: 123 });
    expect(f.state.granted).toBe(true);
    await owner.stopApp!({ mode: 'managed-start' });
    await owner.dispose();
    expect(f.state.granted).toBe(false); expect(f.state.installed).toBe(false); expect(f.state.forward).toBe(false);
    const revoke = f.commands.findIndex(args => args[1]?.startsWith('pm revoke '));
    expect(revoke).toBeGreaterThan(f.commands.findIndex(args => args[1]?.startsWith('am force-stop ')));
    expect(revoke).toBeLessThan(f.commands.findIndex(args => args[0] === 'uninstall'));
    const next = await f.leaseManager.acquire('android', 'avd:dedicated-test'); await next.release();
  });

  it('quiesces a running installation after cancellation before restoration while retaining exclusion through reset', async () => {
    const f = await fixture(); const cancelled = new AbortController(); const owner = await f.owner(15000, cancelled.signal);
    await owner.installApp!(f.input, { mode: 'managed-start' });
    await owner.stopApp!({ mode: 'managed-start' });
    await owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' });
    await owner.launchApp!({ mode: 'managed-start' });
    cancelled.abort();
    const before = f.commands.length;
    await owner.quiesce();
    expect(f.state).toMatchObject({ running: false, granted: false, installed: false, forward: false });
    const cleanup = f.commands.slice(before);
    expect(cleanup.findIndex(args => args[1]?.startsWith('am force-stop '))).toBeLessThan(cleanup.findIndex(args => args[1]?.startsWith('pm revoke ')));
    await expect(owner.createRuntime()).rejects.toMatchObject({ code: 'cancelled' });
    await expect(f.leaseManager.acquire('android', 'avd:dedicated-test', { signal: AbortSignal.timeout(20) })).rejects.toMatchObject({ code: 'cancelled' });
    await owner.quiesce();
    await owner.dispose();
    expect(f.commands.slice(before)).toEqual(cleanup);
    const next = await f.leaseManager.acquire('android', 'avd:dedicated-test'); await next.release();
  });

  it('disposal stops a running verified installation without a separate caller stop', async () => {
    const f = await fixture(true); const owner = await f.owner();
    await owner.installApp!(f.input, { mode: 'managed-start' });
    await owner.launchApp!({ mode: 'managed-start' });
    await owner.dispose();
    expect(f.state).toMatchObject({ running: false, installed: true, forward: false });
    expect(f.commands.filter(args => args[1]?.startsWith('am force-stop '))).toHaveLength(1);
    expect(f.commands.filter(args => args[0] === 'uninstall')).toEqual([]);
  });

  it('quarantines a lost install acknowledgement and refuses subsequent launch or lease reuse', async () => {
    const f = await fixture(); const owner = await f.owner(); f.state.failInstall = true;
    await expect(owner.installApp!(f.input, { mode: 'managed-start' })).rejects.toThrow('lost install reply');
    await expect(owner.launchApp!({ mode: 'managed-start' })).rejects.toMatchObject({ code: 'cleanup_failed' });
    await expect(owner.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
    await expect(f.leaseManager.acquire('android', 'avd:dedicated-test')).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(f.commands.filter(args => args[0] === 'uninstall')).toEqual([]);
  });

  it('rejects attach installation and a changed artifact before permission restoration can mutate a replacement', async () => {
    const f = await fixture(true); const owner = await f.owner();
    await expect(owner.installApp!(f.input, { mode: 'attach' as never })).rejects.toMatchObject({ code: 'precondition_failed' });
    expect(f.commands).toEqual([]);
    await owner.installApp!(f.input, { mode: 'managed-start' });
    await owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' });
    f.state.sha256 = '0'.repeat(64);
    await expect(owner.stopApp!({ mode: 'managed-start' })).rejects.toMatchObject({ code: 'precondition_failed' });
    await expect(owner.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(f.commands.some(args => args[1]?.startsWith('pm revoke '))).toBe(false);
    expect(f.commands.some(args => args[1]?.startsWith('am force-stop '))).toBe(false);
  });

  it('releases ownership after an invalid local artifact without quarantining a device that was never touched', async () => {
    const f = await fixture(); const owner = await f.owner(); f.state.manifest = manifest.replace('debuggable="true"', 'debuggable="false"');
    await expect(owner.installApp!(f.input, { mode: 'managed-start' })).rejects.toMatchObject({ code: 'precondition_failed' });
    expect(f.commands).toEqual([]);
    await owner.dispose();
    const next = await f.leaseManager.acquire('android', 'avd:dedicated-test'); await next.release();
  });

  it('retains the real operation lock after cancelled unresponsive installation and fences Adapter creation', async () => {
    const f = await fixture(); const owner = await f.owner(30);
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = vi.mocked(f.executor).getMockImplementation()!;
    vi.mocked(f.executor).mockImplementation(async (program, args, request) => {
      if (args[2] === 'install') { entered(); await gate; return Buffer.from('Success\n'); }
      return original(program, args, request);
    });
    const abort = new AbortController();
    const installing = owner.installApp!(f.input, { mode: 'managed-start', signal: abort.signal });
    const rejected = expect(installing).rejects.toMatchObject({ code: 'cancelled' });
    try {
      await ready;
      await expect(owner.createRuntime()).rejects.toMatchObject({ code: 'precondition_failed' });
      abort.abort(); await rejected;
      await expect(owner.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
      await expect(f.leaseManager.acquire('android', 'avd:dedicated-test')).rejects.toMatchObject({ code: 'cleanup_failed' });
      expect(JSON.parse(await readFile(f.recoveryPath, 'utf8'))).toMatchObject({ operation: 'install' });
    } finally { release(); }
  });

  it('refuses an unauthenticated or external VM endpoint without forwarding or exposing its value', async () => {
    for (const uri of ['http://127.0.0.1:34567/', 'http://external.example:34567/secret-auth=/']) {
      const f = await fixture(true); await f.app.install(f.input, context());
      f.state.logOverride = `1700000000.200000 123 123 I flutter : The Dart VM service is listening on ${uri}\n`;
      const failure = await f.app.launch(context()).catch(error => error);
      expect(failure).toMatchObject({ code: 'protocol_mismatch' });
      expect(failure.message).not.toContain(uri);
      expect(f.commands.filter(args => args[0] === 'forward')).toEqual([]);
    }
  });

  it('does not delete a forwarding port whose mapping was replaced by another device', async () => {
    const f = await fixture(true); await f.app.install(f.input, context()); await f.app.launch(context());
    f.state.running = false; f.state.stopped = true; f.state.forwardOwner = 'other-device';
    await expect(f.app.confirmStopped(context())).rejects.toMatchObject({ code: 'device_mismatch' });
    expect(f.commands.filter(args => args[0] === 'forward' && args[1] === '--remove')).toEqual([]);
  });
});
