import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile, symlink, mkdir, rename, cp, link, lstat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceLeaseManager } from '../src/DeviceLease.js';
import { inspectDeviceLease, inspectIosRunnerRecovery, claimDeviceRecovery } from '../src/DeviceRecovery.js';
import { nativeModuleCompiler } from './helpers/compileNativeModule.js';
import { IosRunnerJournal } from '../src/ios/IosRunnerJournal.js';

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  await Promise.all(children.splice(0).map(async child => { child.kill('SIGKILL'); if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('close', resolve)); }));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const rootDir = await mkdtemp(join(tmpdir(), 'native-recovery-')); roots.push(rootDir);
  const manager = new DeviceLeaseManager({ rootDir, retryDelayMs: 1 });
  const input = { platform: 'ios' as const, deviceId: 'DEDICATED', rootDir };
  return { rootDir, manager, input };
}

async function abandonedIosRunner() {
  const f = await fixture(), lease = await f.manager.acquire('ios', f.input.deviceId);
  const journal = new IosRunnerJournal({ path: lease.iosRunnerRecoveryPath!, deviceId: f.input.deviceId,
    binding: lease.recoveryBinding!, assertOwned: () => lease.assertOwned!() });
  const context = { requestId: randomUUID(), deadline: Date.now() + 5000, signal: AbortSignal.timeout(5000) };
  await journal.begin(randomUUID(), '2026-11-04T02:00:00.000Z', { sessionId: randomUUID(), recoveryKey: 'c'.repeat(64) }, context);
  await journal.bind(456, 3456, context);
  const ownerPath = join(f.rootDir, lease.key + '.lock', 'owner.json');
  const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
  await writeFile(ownerPath, JSON.stringify({ ...owner, pid: 2147483000 }));
  return { ...f, lease };
}

async function moduleUrls() {
  const root = await mkdtemp(join(tmpdir(), 'recovery-production-modules-')); roots.push(root);
  const compile = nativeModuleCompiler(root);
  return { lease: await compile('DeviceLease'), recovery: await compile('DeviceRecovery') };
}
async function childReady(source: string) {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', source], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  children.push(child);
  let errors = '';
  child.stderr!.on('data', chunk => { errors += chunk; });
  const closed = new Promise<void>((resolve) => { child.once('close', () => resolve()); });
  const ready = new Promise<unknown>((resolve, reject) => {
    child.once('message', resolve); child.once('error', reject);
    void closed.then(() => reject(new Error(`Child exited before readiness: ${errors}`)));
  });
  const message = await ready;
  return { child, message, async kill() { child.kill('SIGKILL'); await closed; } };
}

it('inspects absent lease storage without creating directories or calling platform tools', async () => {
  const f = await fixture();
  const report = await inspectDeviceLease({ ...f.input, rootDir: join(f.rootDir, 'absent') });
  expect(report).toMatchObject({ schemaVersion: 1, state: 'available', owner: 'absent', quarantine: 'absent', recovery: 'absent' });
  expect(await readdir(f.rootDir)).toEqual([]);
});

it('reports quarantine without exposing owner credentials or arbitrary saved error text', async () => {
  const f = await fixture(), lease = await f.manager.acquire('ios', f.input.deviceId);
  const credential = (JSON.parse(await readFile(join(f.rootDir, `${lease.key}.lock`, 'owner.json'), 'utf8')) as { token: string }).token;
  await lease.quarantine('ws://localhost/private-token/ws /private/host'); await lease.release();
  const report = await inspectDeviceLease(f.input);
  expect(report).toMatchObject({ state: 'quarantined', owner: 'absent', quarantine: 'present' });
  expect(report.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(report)).not.toMatch(/private-token|private\/host/);
  expect(JSON.stringify(report)).not.toContain(credential);
  expect(await inspectDeviceLease({ ...f.input, deviceId: f.input.deviceId.toLowerCase() })).toEqual(report);
});

it('inspects owner-bound iOS Runner evidence and refuses release while platform identity is unresolved', async () => {
  const f = await fixture(), lease = await f.manager.acquire('ios', f.input.deviceId);
  const path = lease.iosRunnerRecoveryPath!, binding = lease.recoveryBinding!;
  const deviceKey = createHash('sha256').update(`ios\0${f.input.deviceId.toLowerCase()}`).digest('hex');
  await writeFile(path, JSON.stringify({ schemaVersion: 2, journalId: randomUUID(), ...binding, deviceKey,
    sessionId: randomUUID(), recoveryKey: 'c'.repeat(64), recoveryPort: 3456,
    generation: randomUUID(), simulatorBootedAt: '2026-11-04T02:00:00.000Z',
    bundleId: 'dev.fliwright.NativeRunner.xctrunner', phase: 'running', runnerPid: 456 }));
  const report = await inspectDeviceLease(f.input);
  expect(report).toMatchObject({ iosRunnerRecord: 'present', issues: ['unresolved-ios-runner'] });
  await expect(lease.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readFile(path, 'utf8')).toContain('456');
});

const runnerLine = (pid: number) => String(pid) + ' 0 UIKitApplication:dev.fliwright.NativeRunner.xctrunner[AB12][rb-legacy]' + String.fromCharCode(10);
it.each([
  { bootedAt: '2026-11-04T02:00:00Z', runner: runnerLine(456), status: 'runner-matches-record', sameBoot: true },
  { bootedAt: '2026-11-04T02:00:00Z', runner: runnerLine(987), status: 'runner-mismatch', sameBoot: true },
  { bootedAt: '2026-11-04T03:00:00Z', runner: runnerLine(456), status: 'runner-mismatch', sameBoot: false },
  { bootedAt: '2026-11-04T03:00:00Z', runner: '', status: 'runner-absent', sameBoot: false },
])('reconciles the exact Runner PID and Simulator boot generation without changing evidence', async scenario => {
  const f = await fixture(), lease = await f.manager.acquire('ios', f.input.deviceId);
  const path = lease.iosRunnerRecoveryPath!, binding = lease.recoveryBinding!;
  const deviceKey = createHash('sha256').update('ios' + String.fromCharCode(0) + f.input.deviceId.toLowerCase()).digest('hex');
  await writeFile(path, JSON.stringify({ schemaVersion: 2, journalId: randomUUID(), ...binding, deviceKey,
    sessionId: randomUUID(), recoveryKey: 'c'.repeat(64), recoveryPort: 3456,
    generation: randomUUID(), simulatorBootedAt: '2026-11-04T02:00:00.000Z',
    bundleId: 'dev.fliwright.NativeRunner.xctrunner', phase: 'running', runnerPid: 456 }));
  await lease.quarantine('cleanup unconfirmed');
  await expect(lease.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
  const ownerPath = join(f.rootDir, `${lease.key}.lock`, 'owner.json');
  const owner = JSON.parse(await readFile(ownerPath, 'utf8')) as { pid: number };
  await writeFile(ownerPath, JSON.stringify({ ...owner, pid: 2147483000 }));
  const originalRunner = await readFile(path, 'utf8'), originalDirty = await readFile(join(f.rootDir, `${lease.key}.dirty`), 'utf8');
  expect(JSON.parse(originalRunner)).toMatchObject({ leaseKey: lease.key, ownerGeneration: createHash('sha256').update((JSON.parse(await readFile(ownerPath, 'utf8')) as { token: string }).token).digest('hex'), deviceKey });
  expect(await inspectDeviceLease(f.input)).toMatchObject({ owner: 'exited', delegate: 'absent', operation: 'absent', hostTool: 'absent',
    recovery: 'absent', issues: ['unresolved-ios-runner'] });
  const executor = async (_bin: string, args: readonly string[]) => args.includes('-j')
    ? Buffer.from(JSON.stringify({ devices: { runtime: [{ udid: f.input.deviceId, state: 'Booted', lastBootedAt: scenario.bootedAt }] } }))
    : Buffer.from('PID Status Label' + String.fromCharCode(10) + scenario.runner);
  const result = await inspectIosRunnerRecovery(f.input, { executor });
  expect(result).toEqual({ status: scenario.status, recordedBootGenerationMatches: scenario.sameBoot });
  expect(await readFile(path, 'utf8')).toBe(originalRunner);
  expect(await readFile(join(f.rootDir, `${lease.key}.dirty`), 'utf8')).toBe(originalDirty);
});

it.each(['boot-change', 'cancellation', 'claim-created', 'journal-copy'] as const)('rejects inconsistent online Runner readback: %s', async change => {
  const f = await abandonedIosRunner(), controller = new AbortController();
  const original = await readFile(f.lease.iosRunnerRecoveryPath!, 'utf8');
  let reads = 0;
  await expect(inspectIosRunnerRecovery(f.input, { signal: controller.signal, executor: async (_bin, args) => {
    if (args.includes('-j')) {
      reads += 1;
      return Buffer.from(JSON.stringify({ devices: { runtime: [{ udid: f.input.deviceId, state: 'Booted',
        lastBootedAt: reads > 1 && change === 'boot-change' ? '2026-11-04T03:00:00Z' : '2026-11-04T02:00:00Z' }] } }));
    }
    if (change === 'cancellation') controller.abort();
    if (change === 'claim-created') {
      const path = join(f.rootDir, f.lease.key + '.recovery');
      await mkdir(path);
      await writeFile(join(path, 'owner.json'), JSON.stringify({ token: randomUUID(), pid: 2147483000, createdAt: new Date().toISOString() }));
    }
    if (change === 'journal-copy') {
      const copy = f.lease.iosRunnerRecoveryPath! + '.copy';
      await writeFile(copy, original);
      await rename(copy, f.lease.iosRunnerRecoveryPath!);
    }
    return Buffer.from('PID Status Label');
  } })).rejects.toMatchObject({ code: change === 'cancellation' ? 'cancelled' : 'cleanup_failed' });
  expect(await readFile(f.lease.iosRunnerRecoveryPath!, 'utf8')).toBe(original);
});

it('rejects malformed iOS Runner resource evidence instead of treating it as recovered', async () => {
  const f = await fixture(), lease = await f.manager.acquire('ios', f.input.deviceId);
  await writeFile(lease.iosRunnerRecoveryPath!, JSON.stringify({ schemaVersion: 1, bundleId: 'dev.fliwright.NativeRunner.xctrunner',
    phase: 'running', runnerPid: 456 }));
  expect(await inspectDeviceLease(f.input)).toMatchObject({ iosRunnerRecord: 'present', issues: ['invalid-ios-runner-record'] });
});

it('refuses recovery of a live owner and preserves all original records', async () => {
  const f = await fixture(), lease = await f.manager.acquire('ios', f.input.deviceId);
  await lease.quarantine('cleanup unconfirmed');
  const report = await inspectDeviceLease(f.input);
  const dirty = await readFile(join(f.rootDir, `${lease.key}.dirty`), 'utf8');
  await expect(claimDeviceRecovery(f.input, { fingerprint: report.fingerprint })).rejects.toMatchObject({ code: 'device_busy' });
  expect(await readFile(join(f.rootDir, `${lease.key}.dirty`), 'utf8')).toBe(dirty);
  await lease.release();
});

it('reserves dirty-without-lock recovery across managers and releases only its own claim', async () => {
  const f = await fixture(), lease = await f.manager.acquire('ios', f.input.deviceId);
  await lease.quarantine('cleanup unconfirmed'); await lease.release();
  const dirtyPath = join(f.rootDir, `${lease.key}.dirty`), original = await readFile(dirtyPath, 'utf8');
  const report = await inspectDeviceLease(f.input);
  const claim = await claimDeviceRecovery(f.input, { fingerprint: report.fingerprint });
  expect(await inspectDeviceLease(f.input)).toMatchObject({ state: 'recovering', recovery: 'live' });
  await expect(f.manager.acquire('ios', f.input.deviceId)).rejects.toMatchObject({ code: 'device_busy' });
  const current = await inspectDeviceLease(f.input);
  await expect(claimDeviceRecovery(f.input, { fingerprint: current.fingerprint })).rejects.toMatchObject({ code: 'device_busy' });
  await claim.assertOwned();
  await Promise.all([claim.release(), claim.release()]);
  expect(await readFile(dirtyPath, 'utf8')).toBe(original);
  await expect(f.manager.acquire('ios', f.input.deviceId)).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readdir(f.rootDir)).toEqual([`${lease.key}.dirty`]);
});

it('rejects an outdated inspection and malformed or linked recovery evidence without mutation', async () => {
  for (const kind of ['changed', 'invalid', 'symlink'] as const) {
    const f = await fixture(), lease = await f.manager.acquire('ios', f.input.deviceId);
    await lease.quarantine('cleanup unconfirmed'); await lease.release();
    const report = await inspectDeviceLease(f.input), dirty = join(f.rootDir, `${lease.key}.dirty`);
    if (kind === 'changed') await writeFile(dirty, JSON.stringify({ createdAt: new Date().toISOString(), reason: 'permission-cleanup-unconfirmed' }));
    if (kind === 'invalid') await writeFile(dirty, '{broken private-token');
    if (kind === 'symlink') { await rm(dirty); await symlink('missing-evidence', dirty); }
    const before = await readdir(f.rootDir);
    await expect(claimDeviceRecovery(f.input, { fingerprint: report.fingerprint })).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(await readdir(f.rootDir)).toEqual(before);
  }
});

it.each(['record', 'dangling-link'] as const)('refuses to discard managed app %s evidence even without an earlier dirty marker', async kind => {
  const f = await fixture(), lease = await f.manager.acquire('ios', f.input.deviceId);
  const bytes = '{"operation":"install","appId":"example.app"}';
  if (kind === 'record') await writeFile(lease.recoveryPath!, bytes);
  else await symlink('missing-original-evidence', lease.recoveryPath!);
  await expect(lease.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
  if (kind === 'record') expect(await readFile(lease.recoveryPath!, 'utf8')).toBe(bytes);
  else expect((await lstat(lease.recoveryPath!)).isSymbolicLink()).toBe(true);
  await expect(f.manager.acquire('ios', f.input.deviceId)).rejects.toMatchObject({ code: 'cleanup_failed' });
});

it('claims an actually exited owner while retaining its app and permission recovery bytes', async () => {
  const f = await fixture(), urls = await moduleUrls(), input = { ...f.input, platform: 'android' as const };
  const child = await childReady(`
    import {createHash} from 'node:crypto';
    import {DeviceLeaseManager} from ${JSON.stringify(urls.lease)};
    import {writeFile} from 'node:fs/promises';
    const lease=await new DeviceLeaseManager({rootDir:${JSON.stringify(f.rootDir)}}).acquire('android','DEDICATED');
    const binding=lease.recoveryBinding, deviceKey=createHash('sha256').update('android\\0DEDICATED').digest('hex'), sha256='b'.repeat(64);
    await writeFile(lease.recoveryPath,JSON.stringify({version:3,journalId:'00000000-0000-4000-8000-000000000001',deviceKey,...binding,
      operation:'running',appId:'owned.app',activity:'owned.app.Main',sha256,uid:10123,installedBySession:false,minSdk:23,targetSdk:35,permissions:[],forward:{hostPort:45678,devicePort:34567}}));
    await writeFile(lease.permissionRecoveryPath,JSON.stringify({version:2,journalId:'00000000-0000-4000-8000-000000000002',deviceKey,...binding,
      appSha256:sha256,appInstalledBySession:false,appId:'owned.app',user:0,appOpPolicy:'default-package',uid:10123,
      baseline:[],declaration:[],desired:[],status:'pending',step:'baseline',restored:false}));
    process.send({key:lease.key}); await new Promise(resolve=>process.stdin.once('data',resolve));
  `);
  const key = (child.message as { key: string }).key;
  await child.kill();
  const appPath = join(f.rootDir, `${key}.lock`, 'app-recovery.json'), permissionPath = join(f.rootDir, `${key}.lock`, 'permission-recovery.json');
  const app = await readFile(appPath, 'utf8'), permission = await readFile(permissionPath, 'utf8');
  const report = await inspectDeviceLease(input);
  expect(report).toMatchObject({ state: 'recovery-required', owner: 'exited', appRecord: 'present', permissionRecord: 'present' });
  const claim = await claimDeviceRecovery(input, { fingerprint: report.fingerprint });
  await claim.runExclusive(async signal => { signal.throwIfAborted(); });
  await claim.release();
  expect(await readFile(appPath, 'utf8')).toBe(app);
  expect(await readFile(permissionPath, 'utf8')).toBe(permission);
  await expect(f.manager.acquire('android', 'DEDICATED')).rejects.toMatchObject({ code: 'cleanup_failed' });
});

it.each(['package', 'uid', 'apk-digest', 'install-ownership', 'device-digest', 'missing-install-binding', 'missing-app-record'] as const)(
  'rejects owner-bound Android journals with a mismatched %s', async mismatch => {
  const f = await fixture(), urls = await moduleUrls(), input = { ...f.input, platform: 'android' as const };
  const child = await childReady(`
    import {createHash} from 'node:crypto';
    import {DeviceLeaseManager} from ${JSON.stringify(urls.lease)};
    import {rm,writeFile} from 'node:fs/promises';
    const lease=await new DeviceLeaseManager({rootDir:${JSON.stringify(f.rootDir)}}).acquire('android','DEDICATED');
    const binding=lease.recoveryBinding, deviceKey=createHash('sha256').update('android\\0DEDICATED').digest('hex'), sha256='b'.repeat(64);
    await writeFile(lease.recoveryPath,JSON.stringify({version:3,journalId:'00000000-0000-4000-8000-000000000001',deviceKey,...binding,
      operation:'running',appId:'owned.app',activity:'owned.app.Main',sha256,uid:10123,installedBySession:false,minSdk:23,targetSdk:35,permissions:[],forward:{hostPort:45678,devicePort:34567}}));
    const permission={version:2,journalId:'00000000-0000-4000-8000-000000000002',deviceKey,...binding,
      appSha256:sha256,appInstalledBySession:false,appId:'owned.app',user:0,appOpPolicy:'default-package',uid:10123,
      baseline:[],declaration:[],desired:[],status:'pending',step:'baseline',restored:false};
    if(${JSON.stringify(mismatch)}==='package') permission.appId='other.app';
    if(${JSON.stringify(mismatch)}==='uid') permission.uid=10124;
    if(${JSON.stringify(mismatch)}==='apk-digest') permission.appSha256='c'.repeat(64);
    if(${JSON.stringify(mismatch)}==='install-ownership') permission.appInstalledBySession=true;
    if(${JSON.stringify(mismatch)}==='device-digest') permission.deviceKey='c'.repeat(64);
    if(${JSON.stringify(mismatch)}==='missing-install-binding') {permission.appSha256=null;permission.appInstalledBySession=null;}
    await writeFile(lease.permissionRecoveryPath,JSON.stringify(permission));
    if(${JSON.stringify(mismatch)}==='missing-app-record') await rm(lease.recoveryPath);
    process.send({key:lease.key}); await new Promise(resolve=>process.stdin.once('data',resolve));
  `);
  await child.kill();
  const report = await inspectDeviceLease(input);
  expect(report).toMatchObject({ appRecord: mismatch === 'missing-app-record' ? 'absent' : 'present', permissionRecord: 'present' });
  expect(report.issues).toContain(mismatch.startsWith('missing-') ? 'incomplete-android-installation' : 'inconsistent-android-records');
  await expect(claimDeviceRecovery(input, { fingerprint: report.fingerprint })).rejects.toMatchObject({ code: 'cleanup_failed' });
  });

it('identifies legacy app and permission journals that lack a shared owner generation', async () => {
  const f = await fixture(), urls = await moduleUrls(), input = { ...f.input, platform: 'android' as const };
  const child = await childReady(`
    import {createHash} from 'node:crypto';
    import {DeviceLeaseManager} from ${JSON.stringify(urls.lease)};
    import {writeFile} from 'node:fs/promises';
    const lease=await new DeviceLeaseManager({rootDir:${JSON.stringify(f.rootDir)}}).acquire('android','DEDICATED');
    const deviceKey=createHash('sha256').update('android\\0DEDICATED').digest('hex');
    await writeFile(lease.recoveryPath,JSON.stringify({version:2,journalId:'00000000-0000-4000-8000-000000000001',deviceKey,operation:'installed',appId:'owned.app',
      activity:'owned.app.Main',sha256:'b'.repeat(64),uid:10123,installedBySession:false,minSdk:23,targetSdk:35,permissions:[]}));
    await writeFile(lease.permissionRecoveryPath,JSON.stringify({version:1,journalId:'00000000-0000-4000-8000-000000000002',deviceKey,appId:'owned.app',
      user:0,appOpPolicy:'default-package',uid:10123,baseline:[],declaration:[],desired:[],status:'pending',step:'baseline',restored:false}));
    process.send({key:lease.key}); await new Promise(resolve=>process.stdin.once('data',resolve));
  `);
  const key = (child.message as { key: string }).key;
  await child.kill();
  const appPath = join(f.rootDir, `${key}.lock`, 'app-recovery.json');
  const permissionPath = join(f.rootDir, `${key}.lock`, 'permission-recovery.json');
  const appBytes = await readFile(appPath, 'utf8'), permissionBytes = await readFile(permissionPath, 'utf8');
  const report = await inspectDeviceLease(input);
  expect(report).toMatchObject({ appRecord: 'present', permissionRecord: 'present', issues: ['unbound-app-record', 'unbound-permission-record'] });
  await expect(claimDeviceRecovery(input, { fingerprint: report.fingerprint })).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readFile(appPath, 'utf8')).toBe(appBytes);
  expect(await readFile(permissionPath, 'utf8')).toBe(permissionBytes);
});

it.each([false, true])('excludes recovery while a real delegate outlives its parent (active operation: %s)', async operation => {
  const f = await fixture(), urls = await moduleUrls();
  const parent = await childReady(`
    import {DeviceLeaseManager} from ${JSON.stringify(urls.lease)};
    const lease=await new DeviceLeaseManager({rootDir:${JSON.stringify(f.rootDir)}}).acquire('ios','DEDICATED');
    process.send(await lease.delegate()); await new Promise(resolve=>process.stdin.once('data',resolve));
  `);
  const delegate = await childReady(`
    import {DeviceLeaseManager} from ${JSON.stringify(urls.lease)};
    const lease=await new DeviceLeaseManager({delegation:${JSON.stringify(parent.message)}}).acquire('ios','DEDICATED');
    const hold=async()=>{process.send('delegate-active'); await new Promise(resolve=>process.stdin.once('data',resolve));};
    if(${operation}) await lease.runExclusive(hold); else await hold();
  `);
  await parent.kill();
  const report = await inspectDeviceLease(f.input);
  expect(report).toMatchObject({ owner: 'exited', delegate: 'live', operation: operation ? 'live' : 'absent' });
  await expect(claimDeviceRecovery(f.input, { fingerprint: report.fingerprint })).rejects.toMatchObject({ code: 'device_busy' });
  await delegate.kill();
  const after = await inspectDeviceLease(f.input);
  expect(after).toMatchObject({ delegate: 'exited', operation: operation ? 'exited' : 'absent' });
  const claim = await claimDeviceRecovery(f.input, { fingerprint: after.fingerprint });
  await claim.release();
});

it('keeps a crashed recovery reservation and excludes independent processes without auto-adopting it', async () => {
  const f = await fixture(), urls = await moduleUrls(), lease = await f.manager.acquire('ios', 'DEDICATED');
  await lease.quarantine('unconfirmed'); await lease.release();
  const report = await inspectDeviceLease(f.input);
  const child = await childReady(`
    import {claimDeviceRecovery} from ${JSON.stringify(urls.recovery)};
    const claim=await claimDeviceRecovery(${JSON.stringify(f.input)},{fingerprint:${JSON.stringify(report.fingerprint)}});
    process.send('recovery-active'); await new Promise(resolve=>process.stdin.once('data',resolve));
  `);
  await expect(f.manager.acquire('ios', 'DEDICATED')).rejects.toMatchObject({ code: 'device_busy' });
  await child.kill();
  const stale = await inspectDeviceLease(f.input);
  expect(stale).toMatchObject({ recovery: 'exited', state: 'quarantined' });
  await expect(claimDeviceRecovery(f.input, { fingerprint: stale.fingerprint })).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readdir(f.rootDir)).toContain(`${lease.key}.recovery`);
});

it('retains its reservation while cancelled platform work is still unresolved', async () => {
  const f = await fixture(), lease = await f.manager.acquire('ios', 'DEDICATED');
  await lease.quarantine('unconfirmed'); await lease.release();
  const report = await inspectDeviceLease(f.input), controller = new AbortController();
  const claim = await claimDeviceRecovery(f.input, { fingerprint: report.fingerprint, signal: controller.signal });
  let entered!: () => void, finish!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const work = claim.runExclusive(async () => { entered(); await gate; });
  await ready; controller.abort();
  try {
    await expect(work).rejects.toMatchObject({ code: 'cancelled' });
    await expect(claim.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(await inspectDeviceLease(f.input)).toMatchObject({ recovery: 'live' });
    await expect(claim.runExclusive(async () => {})).rejects.toMatchObject({ code: 'device_busy' });
  } finally { finish(); }
  await vi.waitFor(async () => { await claim.release(); });
  expect(await inspectDeviceLease(f.input)).toMatchObject({ recovery: 'absent', state: 'quarantined' });
});

it.each(['evidence', 'claim-copy'] as const)('fences %s replacement and retains the reservation on release', async kind => {
  const f = await fixture(), lease = await f.manager.acquire('ios', 'DEDICATED');
  await lease.quarantine('unconfirmed'); await lease.release();
  const report = await inspectDeviceLease(f.input);
  const claim = await claimDeviceRecovery(f.input, { fingerprint: report.fingerprint });
  const claimPath = join(f.rootDir, `${lease.key}.recovery`);
  if (kind === 'evidence') await writeFile(join(f.rootDir, `${lease.key}.dirty`), '{}');
  else { await rename(claimPath, `${claimPath}.original`); await cp(`${claimPath}.original`, claimPath, { recursive: true }); }
  await expect(claim.assertOwned()).rejects.toMatchObject({ code: 'cleanup_failed' });
  await expect(claim.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readdir(f.rootDir)).toContain(`${lease.key}.recovery`);
});

it('preserves the original recovery error alongside an ownership failure', async () => {
  const f = await fixture(), lease = await f.manager.acquire('ios', 'DEDICATED');
  await lease.quarantine('unconfirmed'); await lease.release();
  const report = await inspectDeviceLease(f.input);
  const claim = await claimDeviceRecovery(f.input, { fingerprint: report.fingerprint });
  const original = new Error('original platform restore failure');
  await expect(claim.runExclusive(async () => {
    await writeFile(join(f.rootDir, `${lease.key}.dirty`), '{}');
    throw original;
  })).rejects.toMatchObject({ name: 'AggregateError', errors: [original, expect.objectContaining({ code: 'cleanup_failed' })] });
  await expect(claim.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
});

it('keeps invalid and absent owner records distinct from a proven process exit', async () => {
  const f = await fixture(), lease = await f.manager.acquire('ios', 'DEDICATED');
  const ownerPath = join(f.rootDir, `${lease.key}.lock`, 'owner.json');
  await writeFile(ownerPath, JSON.stringify({ token: 'private-token', pid: process.pid }));
  const malformed = await inspectDeviceLease(f.input);
  expect(malformed).toMatchObject({ owner: 'invalid', issues: ['invalid-owner'] });
  await expect(claimDeviceRecovery(f.input, { fingerprint: malformed.fingerprint })).rejects.toMatchObject({ code: 'cleanup_failed' });
  await rm(ownerPath);
  const absent = await inspectDeviceLease(f.input);
  expect(absent).toMatchObject({ owner: 'absent', issues: ['invalid-owner'] });
  await expect(claimDeviceRecovery(f.input, { fingerprint: absent.fingerprint })).rejects.toMatchObject({ code: 'cleanup_failed' });
});

it('enforces cancellation before reservation and fences the claim after its total budget', async () => {
  const f = await fixture(), lease = await f.manager.acquire('ios', 'DEDICATED');
  await lease.quarantine('unconfirmed'); await lease.release();
  const report = await inspectDeviceLease(f.input), controller = new AbortController(); controller.abort();
  await expect(claimDeviceRecovery(f.input, { fingerprint: report.fingerprint, signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  expect(await readdir(f.rootDir)).toEqual([`${lease.key}.dirty`]);
  const claim = await claimDeviceRecovery(f.input, { fingerprint: report.fingerprint, timeoutMs: 100 });
  await new Promise<void>(resolve => { if (claim.signal.aborted) resolve(); else claim.signal.addEventListener('abort', () => resolve(), { once: true }); });
  await expect(claim.assertOwned()).rejects.toMatchObject({ code: 'timeout' });
  await claim.release();
  expect(await inspectDeviceLease(f.input)).toMatchObject({ state: 'quarantined', recovery: 'absent' });
});

it.each(['symlink-root', 'symlink-lock', 'linked-record', 'oversize-record', 'unknown-file'] as const)('never reserves %s storage or drops evidence', async kind => {
  const f = await fixture(), lease = await f.manager.acquire('ios', 'DEDICATED');
  await lease.quarantine('unconfirmed'); await lease.release();
  let input = f.input;
  if (kind === 'symlink-root') { await symlink(f.rootDir, join(f.rootDir, 'alias')); input = { ...input, rootDir: join(f.rootDir, 'alias') }; }
  else if (kind === 'symlink-lock') await symlink('missing-owner', join(f.rootDir, `${lease.key}.lock`));
  else {
    const lockPath = join(f.rootDir, `${lease.key}.lock`); await mkdir(lockPath);
    if (kind === 'linked-record') await link(join(f.rootDir, `${lease.key}.dirty`), join(lockPath, 'app-recovery.json'));
    if (kind === 'oversize-record') await writeFile(join(lockPath, 'permission-recovery.json'), 'x'.repeat(32769));
    if (kind === 'unknown-file') await writeFile(join(lockPath, 'unknown-private-token'), 'private-token');
  }
  const before = await readdir(f.rootDir), report = await inspectDeviceLease(input);
  expect(report.issues.length).toBeGreaterThan(0);
  expect(JSON.stringify(report)).not.toContain('private-token');
  await expect(claimDeviceRecovery(input, { fingerprint: report.fingerprint })).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readdir(f.rootDir)).toEqual(before);
});
