import { afterEach, expect, it } from 'vitest';
import { copyFile, link, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NativeOperationContext } from '@fliwright/core';
import { DeviceLeaseManager } from '../../src/DeviceLease.js';
import { claimDeviceRecovery, inspectDeviceLease } from '../../src/DeviceRecovery.js';
import { AndroidDeviceBinding, isAndroidDeviceRecord } from '../../src/android/AndroidDeviceBinding.js';
import { androidDeviceIdentity } from '../helpers/androidDeviceIdentity.js';
import { nativeModuleCompiler } from '../helpers/compileNativeModule.js';

const roots: string[] = [], children: ChildProcess[] = [];
afterEach(async () => {
  await Promise.all(children.splice(0).map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = new Promise(resolve => child.once('close', resolve)); child.kill('SIGKILL'); await closed;
  }));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
const context = (): NativeOperationContext => ({ requestId: 'device-binding', deadline: Date.now() + 5000, signal: AbortSignal.timeout(5000) });
async function fixture() {
  const rootDir = await mkdtemp(join(tmpdir(), 'android-device-binding-')); roots.push(rootDir);
  const lease = await new DeviceLeaseManager({ rootDir }).acquire('android', 'avd:dedicated-test');
  const platform = androidDeviceIdentity('emulator-owned'), path = lease.deviceRecoveryPath!;
  const options = { path, deviceId: 'emulator-owned', avdName: 'dedicated-test', binding: lease.recoveryBinding!,
    executor: platform.executor, assertOwned: () => lease.assertOwned!() };
  const binding = new AndroidDeviceBinding(options);
  return { rootDir, lease, platform, path, options, binding };
}

it('publishes only private digests and removes the record after a fresh matching observation', async () => {
  const f = await fixture(); await f.binding.verify(context());
  const record = await readFile(f.path, 'utf8');
  expect(isAndroidDeviceRecord(JSON.parse(record))).toBe(true);
  expect(record).not.toMatch(/emulator-owned|dedicated-test|11111111|test-keys/);
  if (process.platform !== 'win32') expect((await stat(f.path)).mode & 0o777).toBe(0o600);
  const before = f.platform.calls.length;
  await f.binding.complete(context());
  expect(f.platform.calls.length).toBeGreaterThan(before);
  await f.lease.release(); expect(await readdir(f.rootDir)).toEqual([]);
});

it.each(['serial', 'avdName', 'bootId', 'fingerprint', 'sdk'] as const)('fences a changed %s and cannot resume after the old value returns', async field => {
  const f = await fixture(); await f.binding.verify(context());
  const bytes = await readFile(f.path, 'utf8'), previous = f.platform.state[field];
  f.platform.state[field] = field === 'bootId' ? '22222222-2222-4222-8222-222222222222' : field === 'sdk' ? '36' : 'changed';
  await expect(f.binding.verify(context())).rejects.toMatchObject({ code: 'device_mismatch' });
  expect(f.binding.outcomeUnknown).toBe(true);
  f.platform.state[field] = previous;
  await expect(f.binding.verify(context())).rejects.toMatchObject({ code: 'cleanup_failed' });
  await expect(f.binding.complete(context())).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readFile(f.path, 'utf8')).toBe(bytes);
});

it.each(['copy', 'hardlink', 'symlink', 'directory-copy'] as const)('retains %s replacement evidence and refuses verification or deletion', async kind => {
  const f = await fixture(); await f.binding.verify(context());
  const bytes = await readFile(f.path, 'utf8'), other = join(f.rootDir, 'original');
  if (kind === 'copy') { await copyFile(f.path, other); await rename(other, f.path); }
  if (kind === 'hardlink') await link(f.path, other);
  if (kind === 'symlink') { await rename(f.path, other); await symlink(other, f.path); }
  if (kind === 'directory-copy') {
    const directory = join(f.rootDir, `${f.lease.key}.lock`);
    await rename(directory, other); await mkdir(directory);
    await copyFile(join(other, 'device-recovery.json'), f.path);
    await copyFile(join(other, 'owner.json'), join(directory, 'owner.json'));
  }
  await expect(f.binding.verify(context())).rejects.toMatchObject({ code: 'cleanup_failed' });
  await expect(f.binding.complete(context())).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readFile(f.path, 'utf8')).toBe(bytes);
});

it('rejects an initial AVD mismatch before publishing any device evidence', async () => {
  const f = await fixture(); f.platform.state.avdName = 'other-device';
  await expect(f.binding.verify(context())).rejects.toMatchObject({ code: 'device_mismatch' });
  await expect(readFile(f.path)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.lease.release();
});

it('binds a physical Android serial without issuing Emulator-only identity commands', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'android-physical-binding-')); roots.push(rootDir);
  const lease = await new DeviceLeaseManager({ rootDir }).acquire('android', 'usb-device');
  const platform = androidDeviceIdentity('usb-device');
  const binding = new AndroidDeviceBinding({ path: lease.deviceRecoveryPath!, deviceId: 'usb-device',
    binding: lease.recoveryBinding!, executor: platform.executor, assertOwned: () => lease.assertOwned!() });
  await binding.verify(context());
  expect(platform.calls.some(args => args.slice(2, 4).join(' ') === 'emu avd')).toBe(false);
  await binding.complete(context());
  await lease.release();
  expect(await readdir(rootDir)).toEqual([]);
});

it('rejects inconsistent boot observations during the initial capture', async () => {
  const f = await fixture();
  const binding = new AndroidDeviceBinding({ ...f.options, executor: async (...args) => {
    const output = await f.platform.executor(...args);
    if (args[1][3] === 'getprop ro.build.fingerprint') f.platform.state.bootId = '22222222-2222-4222-8222-222222222222';
    return output;
  } });
  await expect(binding.verify(context())).rejects.toMatchObject({ code: 'device_mismatch' });
  await expect(readFile(f.path)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.lease.release();
});

it('never adopts an existing record and lease release retains it without an earlier quarantine', async () => {
  const f = await fixture(); await f.binding.verify(context());
  const bytes = await readFile(f.path, 'utf8'), another = new AndroidDeviceBinding(f.options);
  await expect(another.verify(context())).rejects.toBeDefined();
  await expect(f.lease.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readFile(f.path, 'utf8')).toBe(bytes);
  expect(await inspectDeviceLease({ platform: 'android', deviceId: 'avd:dedicated-test', rootDir: f.rootDir }))
    .toMatchObject({ quarantine: 'present', deviceRecord: 'present', issues: [] });
});

it('does not remove evidence when completion is cancelled', async () => {
  const f = await fixture(); await f.binding.verify(context());
  const bytes = await readFile(f.path, 'utf8');
  await expect(f.binding.complete({ ...context(), signal: AbortSignal.abort() })).rejects.toBeDefined();
  expect(await readFile(f.path, 'utf8')).toBe(bytes);
});

it.each(['valid', 'malformed', 'owner', 'avd', 'lease'] as const)('inspects a real crashed owner binding and rejects invalid evidence (%s)', async kind => {
  const rootDir = await mkdtemp(join(tmpdir(), 'device-binding-crash-')); roots.push(rootDir);
  const compile = nativeModuleCompiler(join(rootDir, 'compiled'));
  const bindingUrl = await compile('android/AndroidDeviceBinding'), leaseUrl = await compile('DeviceLease');
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {DeviceLeaseManager} from ${JSON.stringify(leaseUrl)};
    import {AndroidDeviceBinding} from ${JSON.stringify(bindingUrl)};
    const lease=await new DeviceLeaseManager({rootDir:${JSON.stringify(rootDir)}}).acquire('android','avd:dedicated-test');
    const binding=new AndroidDeviceBinding({path:lease.deviceRecoveryPath,deviceId:'emulator-owned',avdName:'dedicated-test',
      binding:lease.recoveryBinding,assertOwned:lease.assertOwned,executor:async(_program,args)=>{
        const command=args.slice(2).join(' ');
        if(command==='get-serialno')return Buffer.from('emulator-owned');
        if(command==='emu avd name')return Buffer.from('dedicated-test\\nOK');
        if(command==='shell cat /proc/sys/kernel/random/boot_id')return Buffer.from('11111111-1111-4111-8111-111111111111');
        if(command==='shell getprop ro.build.fingerprint')return Buffer.from('test/build/fingerprint');
        if(command==='shell getprop ro.build.version.sdk')return Buffer.from('35');
        throw Error('Unexpected identity query');
      }});
    await binding.verify({requestId:'crash',deadline:Date.now()+10000,signal:AbortSignal.timeout(10000)});
    process.send({key:lease.key,path:lease.deviceRecoveryPath});setInterval(()=>{},1000);
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  children.push(child);
  let stderr = ''; child.stderr!.on('data', data => { stderr += data; });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  const ready = await new Promise<{ key: string; path: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`Device binding child did not publish: ${stderr}`)), 5000);
    child.once('message', value => { clearTimeout(timer); resolve(value as { key: string; path: string }); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    void closed.then(() => { clearTimeout(timer); reject(Error(`Child exited before readiness: ${stderr}`)); });
  });
  const original = await readFile(ready.path, 'utf8'); child.kill('SIGKILL'); await closed;
  const input = { platform: 'android' as const, deviceId: 'avd:dedicated-test', rootDir };
  const before = await inspectDeviceLease(input);
  if (kind !== 'valid') {
    const value = JSON.parse(original);
    if (kind === 'owner') value.ownerGeneration = 'b'.repeat(64);
    if (kind === 'avd') value.avdKey = 'b'.repeat(64);
    if (kind === 'lease') value.leaseKey = 'b'.repeat(64);
    const bytes = kind === 'malformed' ? '{"version":1}' : JSON.stringify(value);
    await writeFile(ready.path, bytes);
    const invalid = await inspectDeviceLease(input);
    expect(invalid.fingerprint).not.toBe(before.fingerprint);
    expect(invalid.issues).toContain(kind === 'malformed' ? 'invalid-device-record' : 'inconsistent-device-record');
    await expect(claimDeviceRecovery(input, { fingerprint: invalid.fingerprint })).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(await readFile(ready.path, 'utf8')).toBe(bytes);
    return;
  }
  const report = await inspectDeviceLease(input);
  expect(report).toMatchObject({ owner: 'exited', deviceRecord: 'present', issues: [] });
  const claim = await claimDeviceRecovery(input, { fingerprint: report.fingerprint });
  await claim.release(); expect(await readFile(ready.path, 'utf8')).toBe(original);
});

it('keeps device evidence ownership in the parent and excludes the path and generation from delegation', async () => {
  const f = await fixture();
  const grant = await f.lease.delegate!();
  const child = await new DeviceLeaseManager({ delegation: grant }).acquire('android', 'avd:dedicated-test');
  expect(child.deviceRecoveryPath).toBeUndefined();
  expect(child.recoveryBinding).toBeUndefined();
  expect(Object.keys(grant).sort()).toEqual(['key', 'rootDir', 'token']);
  expect(JSON.stringify(grant)).not.toContain(f.path);
  await child.release(); await f.lease.release();
});
