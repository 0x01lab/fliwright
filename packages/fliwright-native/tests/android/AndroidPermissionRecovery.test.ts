import { afterEach, expect, it, vi } from 'vitest';
import { copyFile, link, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openNativeDevice } from '../../src/NativeDeviceSession.js';
import { androidDeviceIdentity } from '../helpers/androidDeviceIdentity.js';
import { DeviceLeaseManager } from '../../src/DeviceLease.js';
import type { ToolExecutor } from '../../src/ToolExecutor.js';
import { spawn } from 'node:child_process';
import { nativeModuleCompiler } from '../helpers/compileNativeModule.js';
import { fingerprintScenario, getAndroidScenarioPermissions, ScenarioResolver } from '@fliwright/core';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'android-permission-recovery-')); roots.push(root);
  const leaseManager = new DeviceLeaseManager({ rootDir: root, retryDelayMs: 1 });
  const states = { camera: { granted: false, flags: ['USER_SET'] }, microphone: { granted: true, flags: [] as string[] } };
  let uid = 10123, fault: string | undefined, running = false;
  let cancelWrite: AbortController | undefined;
  const commands: string[] = [], snapshots: Array<Record<string, unknown>> = [];
  const path = async () => join(root, (await readdir(root)).find(name => name.endsWith('.lock'))!, 'permission-recovery.json');
  const executor: ToolExecutor = async (_program, args) => {
    const command = args[3]; commands.push(command);
    if (command === 'am get-current-user') return Buffer.from('0');
    if (command === 'ps -A -o UID,PID,NAME') return Buffer.from(`UID PID NAME\n0 1 init\n${running ? `${uid} 42 example.app\n` : ''}`);
    if (command.startsWith('pm path ')) return Buffer.from('package:/data/app/owned/base.apk');
    if (command.startsWith('sha256sum ')) return Buffer.from(`${'b'.repeat(64)}  /data/app/owned/base.apk`);
    if (command.startsWith('dumpsys package')) return Buffer.from(`Package [example.app] (test):\n userId=${uid}\n targetSdk=35\n User 0: installed=true stopped=${!running}\n runtime permissions:\n${Object.entries(states).map(([name, state]) => ` android.permission.${name === 'camera' ? 'CAMERA' : 'RECORD_AUDIO'}: granted=${state.granted}, flags=[${state.flags.join('|')}]`).join('\n')}\n`);
    if (command.startsWith('cmd appops get')) {
      if (fault === 'readback-journal' && snapshots.length > 1) { await rm(await path()); await mkdir(await path()); }
      return Buffer.from('No operations.');
    }
    if (command.startsWith('am force-stop')) {
      snapshots.push(JSON.parse(await readFile(await path(), 'utf8')));
      running = false;
      return Buffer.alloc(0);
    }
    if (command.startsWith('pm ')) {
      snapshots.push(JSON.parse(await readFile(await path(), 'utf8')));
      if (fault === 'lost-reply') throw Error('ADB acknowledgement lost');
      const state = command.includes('android.permission.CAMERA') ? states.camera : states.microphone;
      if (command.startsWith('pm grant')) state.granted = true;
      if (command.startsWith('pm revoke')) state.granted = false;
      if (command.startsWith('pm clear-permission-flags')) state.flags = [];
      if (command.startsWith('pm set-permission-flags')) state.flags = [
        ...(command.includes('user-set') ? ['USER_SET'] : []), ...(command.includes('user-fixed') ? ['USER_FIXED'] : []),
      ];
      if (fault === 'after-write-journal') { await rm(await path()); await mkdir(await path()); }
      cancelWrite?.abort();
      return Buffer.alloc(0);
    }
    throw Error('Unexpected platform write');
  };
  const config = { enabled: true, platform: 'android' as const, deviceId: 'fake-owned-device', targetAppId: 'example.app' };
  const discovery = { scan: vi.fn(async () => ({ scannedAt: new Date().toISOString(), diagnostics: [], devices: [
    { id: config.deviceId, name: 'fake', avdName: 'dedicated-test', platform: 'android' as const, kind: 'simulator' as const, state: 'online' as const },
  ] })) };
  const owner = await openNativeDevice(config, { leaseManager, discovery, permissionExecutor: executor, deviceExecutor: androidDeviceIdentity(config.deviceId).executor });
  return { owner, root, path, states, commands, snapshots, config, discovery, executor, leaseManager,
    setFault: (value: string) => { fault = value; }, setUid: (value: number) => { uid = value; },
    cancelOnWrite: (controller: AbortController) => { cancelWrite = controller; }, start: () => { running = true; } };
}

it('persists original flags, full declaration and each pending write before dispatch; replacements keep the original baseline', async () => {
  const f = await fixture();
  try {
    const original = structuredClone(f.states);
    await f.owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' });
    expect(f.snapshots.length).toBeGreaterThanOrEqual(2);
    for (const snapshot of f.snapshots) expect(snapshot).toMatchObject({ version: 2, appId: 'example.app', uid: 10123,
      status: 'pending', baseline: [{ permission: 'camera', granted: false, flags: ['USER_SET'] }],
      declaration: [{ permission: 'camera', state: 'granted' }] });
    expect(JSON.parse(await readFile(await f.path(), 'utf8'))).toMatchObject({ status: 'verified', restored: false });
    await f.owner.preparePermissions!([{ permission: 'microphone', state: 'denied' }], { mode: 'managed-start' });
    const record = JSON.parse(await readFile(await f.path(), 'utf8'));
    expect(record.baseline).toEqual(expect.arrayContaining([
      expect.objectContaining({ permission: 'camera', ...original.camera }), expect.objectContaining({ permission: 'microphone', ...original.microphone }),
    ]));
    expect(record.declaration).toEqual([{ permission: 'microphone', state: 'denied' }]);
    expect(f.states.camera).toEqual(original.camera);
    if (process.platform !== 'win32') expect((await stat(await f.path())).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(record)).not.toMatch(/fake-owned-device|Bearer|auth=|127\.0\.0\.1|apkPath/);
    await f.owner.quiesce();
    expect(f.states).toEqual(original);
    expect((await readdir(f.root)).filter(name => name.endsWith('.lock'))).toHaveLength(1);
    await expect(readFile(await f.path(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await f.owner.dispose(); }
  expect(await readdir(f.root)).toEqual([]);
});

it('retains original baseline and pending intent on a lost reply; disposal and a new owner cannot erase or replay it', async () => {
  const f = await fixture(); f.setFault('lost-reply');
  await expect(f.owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' })).rejects.toThrow();
  const path = await f.path(), record = await readFile(path, 'utf8'), before = f.commands.length;
  expect(JSON.parse(record)).toMatchObject({ status: 'pending', baseline: [{ permission: 'camera', granted: false, flags: ['USER_SET'] }] });
  await expect(f.owner.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readFile(path, 'utf8')).toBe(record);
  expect(f.commands).toHaveLength(before);
  await expect(f.leaseManager.acquire('android', 'avd:dedicated-test')).rejects.toMatchObject({ code: 'cleanup_failed' });
});

it('journals managed stop before dispatch and removes its evidence only after stopped readback and quiescence', async () => {
  const f = await fixture();
  try {
    await f.owner.inspectPermissions!(['camera']);
    await expect(readFile(await f.path(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await f.owner.stopApp!({ mode: 'managed-start' });
    expect(f.snapshots).toMatchObject([{ uid: 10123, step: 'stop', status: 'pending', restored: false, baseline: [] }]);
    expect(JSON.parse(await readFile(await f.path(), 'utf8'))).toMatchObject({ step: 'stopped', status: 'verified', restored: true });
    expect(f.commands.filter(command => command.startsWith('am force-stop'))).toHaveLength(1);
    await f.owner.quiesce();
    await expect(readFile(await f.path(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await f.owner.dispose(); }
  expect(await readdir(f.root)).toEqual([]);
});

it.each(['copy', 'hardlink', 'symlink'] as const)(
  'fences permission preparation and managed stop before platform work after %s replacement', async kind => {
    const f = await fixture();
    await f.owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' });
    const path = await f.path(), original = await readFile(path, 'utf8'), other = join(f.root, 'original');
    if (kind === 'copy') { await copyFile(path, other); await rename(other, path); }
    if (kind === 'hardlink') await link(path, other);
    if (kind === 'symlink') { await rename(path, other); await symlink(other, path); }
    const before = f.commands.length;
    await expect(f.owner.preparePermissions!([], { mode: 'managed-start' })).rejects.toMatchObject({ code: 'cleanup_failed' });
    await expect(f.owner.stopApp!({ mode: 'managed-start' })).rejects.toMatchObject({ code: 'cleanup_failed' });
    await expect(f.owner.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(f.commands.slice(before)).toEqual([]);
    expect(f.states.camera.granted).toBe(true);
    expect(await readFile(path, 'utf8')).toBe(original);
    await expect(f.leaseManager.acquire('android', 'avd:dedicated-test')).rejects.toMatchObject({ code: 'cleanup_failed' });
  });

it.each(['existing', 'unwritable'] as const)('fails before any platform mutation when the recovery record is %s', async kind => {
  const f = await fixture(), path = await f.path();
  if (kind === 'existing') await writeFile(path, 'previous evidence'); else await mkdir(path);
  await expect(f.owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' })).rejects.toThrow();
  expect(f.commands.some(command => command.startsWith('pm '))).toBe(false);
  await expect(f.owner.dispose()).rejects.toThrow();
  if (kind === 'existing') expect(await readFile(path, 'utf8')).toBe('previous evidence');
});

it('preserves recovery and stops writes if persistence fails after the first dispatched mutation', async () => {
  const f = await fixture(); f.setFault('after-write-journal');
  await expect(f.owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' })).rejects.toThrow();
  expect(f.commands.filter(command => command.startsWith('pm '))).toHaveLength(1);
  const before = f.commands.length;
  await expect(f.owner.dispose()).rejects.toThrow();
  expect(f.commands).toHaveLength(before);
  expect((await readdir(f.root)).some(name => name.endsWith('.lock'))).toBe(true);
});

it('retains pending evidence and never dispatches another mutation after cancellation during a platform write', async () => {
  const f = await fixture(), controller = new AbortController(); f.cancelOnWrite(controller);
  await expect(f.owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], {
    mode: 'managed-start', signal: controller.signal,
  })).rejects.toThrow();
  const path = await f.path(), record = await readFile(path, 'utf8');
  expect(f.states.camera.granted).toBe(true);
  expect(f.commands.filter(command => command.startsWith('pm '))).toHaveLength(1);
  expect(JSON.parse(record)).toMatchObject({ status: 'pending', step: 'grant', restored: false });
  await expect(f.owner.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(f.commands.filter(command => command.startsWith('pm '))).toHaveLength(1);
  expect(await readFile(path, 'utf8')).toBe(record);
});

it('cannot confirm cleanup when platform readback succeeds but the verified checkpoint cannot be persisted', async () => {
  const f = await fixture(); f.setFault('readback-journal');
  await expect(f.owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' })).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(f.states.camera).toEqual({ granted: true, flags: [] });
  const before = f.commands.length;
  await expect(f.owner.dispose()).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(f.commands).toHaveLength(before);
  expect((await stat(await f.path())).isDirectory()).toBe(true);
  expect((await readdir(f.root)).some(name => name.endsWith('.lock'))).toBe(true);
});

it('does not restore a captured permission baseline onto a different isolated UID', async () => {
  const f = await fixture();
  await f.owner.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' });
  const path = await f.path(), before = f.commands.filter(command => command.startsWith('pm ')).length;
  f.setUid(10124);
  await expect(f.owner.dispose()).rejects.toThrow();
  expect(f.commands.filter(command => command.startsWith('pm '))).toHaveLength(before);
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ uid: 10123 });
});

it('lets delegated children inspect but rejects baseline mutations and managed stop before any platform work', async () => {
  const f = await fixture(), delegation = await f.owner.delegate!();
  const child = await openNativeDevice(f.config, { discovery: f.discovery, permissionExecutor: f.executor,
    leaseManager: new DeviceLeaseManager({ delegation, retryDelayMs: 1 }) });
  try {
    await expect(child.preparePermissions!([{ permission: 'camera', state: 'granted' }], { mode: 'managed-start' })).rejects.toThrow(/parent|retained|owner/i);
    await expect(child.stopApp!({ mode: 'managed-start' })).rejects.toThrow(/parent|retained|owner/i);
    expect(f.commands).toEqual([]);
    expect(await child.inspectPermissions!(['camera'])).toMatchObject([{ permission: 'camera', granted: false }]);
  } finally { await child.dispose(); await f.owner.dispose(); }
});

it('validates and snapshots the complete declaration before scheduling platform work', async () => {
  const f = await fixture();
  try {
    for (const declaration of [new Array(1), [{ permission: 'camera', state: 'prompt', ready: true }]]) {
      await expect(f.owner.preparePermissions!(declaration, { mode: 'managed-start' })).rejects.toThrow();
    }
    expect(f.commands).toEqual([]);
    await expect(readFile(await f.path(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    const declaration = [{ permission: 'camera', state: 'granted' as 'granted' | 'denied' }];
    const pending = f.owner.preparePermissions!(declaration, { mode: 'managed-start' });
    declaration[0].state = 'denied';
    expect(await pending).toMatchObject([{ permission: 'camera', granted: true }]);
  } finally { await f.owner.dispose(); }
});

it('carries an inherited nonempty declaration through durable preparation and real child readback, then restores an ordinary peer', async () => {
  const f = await fixture(), original = structuredClone(f.states), delegation = await f.owner.delegate!();
  const childRoot = await mkdtemp(join(tmpdir(), 'permission-declaration-child-')); roots.push(childRoot);
  const server = createServer((request, response) => {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += chunk;
      const { program, args } = JSON.parse(body);
      const result = await f.executor(program, args, { requestId: 'child-tool', deadline: Date.now() + 5000, signal: new AbortController().signal });
      response.end(JSON.stringify({ bytes: result.toString('base64') }));
    })().catch(() => { response.statusCode = 500; response.end(); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Tool executor did not bind');
  const toolUrl = `http://127.0.0.1:${address.port}`;
  await mkdir(join(childRoot, '.fliwright/tests'), { recursive: true });
  await writeFile(join(childRoot, 'vitest.config.mjs'), `export default {root:${JSON.stringify(childRoot)},test:{include:['.fliwright/tests/readback.test.mjs'],maxWorkers:1,reporters:['dot']}};`);
  await writeFile(join(childRoot, '.fliwright/tests/readback.test.mjs'), `
    import {it,expect} from 'vitest';
    import {openNativeDevice} from ${JSON.stringify(resolve(import.meta.dirname, '../../src/NativeDeviceSession.ts'))};
    import {DeviceLeaseManager} from ${JSON.stringify(resolve(import.meta.dirname, '../../src/DeviceLease.ts'))};
    import {createAndroidAppReadback,getAndroidScenarioPermissions} from ${JSON.stringify(import.meta.resolve('@fliwright/core'))};
    it('observes in a separate delegated process',async()=>{
      const {config,expected,context,scenario,toolUrl}=JSON.parse(process.env.DECLARATION_READBACK);
      const owner=await openNativeDevice(config,{
        discovery:{scan:async()=>({scannedAt:new Date().toISOString(),diagnostics:[],devices:[{id:config.deviceId,name:'fake',avdName:'dedicated-test',platform:'android',kind:'simulator',state:'online'}]})},
        leaseManager:DeviceLeaseManager.fromEnvironment(),
        permissionExecutor:async(program,args,operation)=>{
          const response=await fetch(toolUrl,{method:'POST',body:JSON.stringify({program,args}),signal:operation.signal});
          if(!response.ok)throw Error('Independent platform executor failed');
          return Buffer.from((await response.json()).bytes,'base64');
        }
      });
      try{
        const binding={...context,permissionDeclaration:getAndroidScenarioPermissions(scenario)};
        const handle=createAndroidAppReadback(expected,binding,()=>owner.inspectAppState(expected.permissions.map(item=>item.permission)));
        expect((await handle.consume(binding)).permissions).toEqual(expected.permissions);
      }finally{await owner.dispose();}
    });
  `);
  const resolver = new ScenarioResolver({ base: { name: 'base', layers: [{ kind: 'device', permissions: [{ permission: 'camera', state: 'granted' }] }] },
    photo: { name: 'photo', extends: ['base'], layers: [] },
    microphone: { name: 'microphone', layers: [{ kind: 'device', permissions: [{ permission: 'microphone', state: 'denied' }] }] } });
  const scene = resolver.resolve('photo');
  try {
    for (const [index, scenario] of [scene, scene, resolver.resolve('microphone'), undefined].entries()) {
      const permissionDeclaration = getAndroidScenarioPermissions(scenario);
      await f.owner.stopApp!({ mode: 'managed-start' });
      const permissions = await f.owner.preparePermissions!(permissionDeclaration, { mode: 'managed-start' });
      f.start(); // Deterministic platform state, not a claimed device launch.
      const context = { attemptKey: `attempt-${index}`, attemptId: String(index), managedAppGeneration: `managed-${index}`,
        scenarioFingerprint: scenario ? fingerprintScenario(scenario) : undefined, permissionDeclaration,
        identity: { platform: 'android' as const, deviceId: f.config.deviceId, appId: f.config.targetAppId, backend: 'adb', generation: `adapter-${index}` } };
      const expected = { platform: 'android' as const, deviceKey: createHash('sha256').update(`android\0${f.config.deviceId}`).digest('hex'),
        appId: f.config.targetAppId, apkSha256: 'b'.repeat(64), uid: 10123, pid: 42, permissions,
        attemptKey: context.attemptKey, scenarioFingerprint: context.scenarioFingerprint, launchGeneration: `launch-${index}` };
      const child = spawn(process.execPath, [resolve(import.meta.dirname, '../../../../node_modules/vitest/vitest.mjs'), 'run', '--config', join(childRoot, 'vitest.config.mjs')], {
        cwd: childRoot, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
          FLIWRIGHT_NATIVE_DEVICE_LEASE: JSON.stringify(delegation),
          DECLARATION_READBACK: JSON.stringify({ config: f.config, expected, context, scenario, toolUrl }),
        },
      });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
      const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      try { expect(await exited, output).toBe(0); }
      finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; }
      expect(f.states.camera).toEqual(index < 2 ? { granted: true, flags: [] } : original.camera);
      expect(JSON.parse(await readFile(await f.path(), 'utf8'))).toMatchObject({ declaration: permissionDeclaration,
        baseline: [{ permission: 'camera', ...original.camera }, ...(index < 2 ? [] : [{ permission: 'microphone', ...original.microphone }])],
        status: 'verified', restored: index === 3 });
    }
  } finally {
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    await f.owner.stopApp!({ mode: 'managed-start' });
    await f.owner.dispose();
  }
  expect(f.states).toEqual(original);
  expect(await readdir(f.root)).toEqual([]);
}, 25000);

it.each(['pending', 'verified'] as const)('preserves a %s permission recovery record after its actual Node owner crashes', async status => {
  const root = await mkdtemp(join(tmpdir(), 'permission-owner-crash-')); roots.push(root);
  const compile = nativeModuleCompiler(join(root, 'compiled'));
  const journalModule = await compile('android/AndroidPermissionJournal');
  const leaseModule = await compile('DeviceLease');
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {DeviceLeaseManager} from ${JSON.stringify(leaseModule)};
    import {AndroidPermissionJournal} from ${JSON.stringify(journalModule)};
    const lease=await new DeviceLeaseManager({rootDir:${JSON.stringify(root)}}).acquire('android','fake-device');
    const journal=new AndroidPermissionJournal({path:lease.permissionRecoveryPath,deviceId:'fake-device',appId:'example.app',
      recoveryBinding:lease.recoveryBinding,assertOwned:lease.assertOwned});
    await journal.checkpoint({uid:10123,status:${JSON.stringify(status)},step:${JSON.stringify(status === 'pending' ? 'grant' : 'readback')},restored:false,
      ${status === 'pending' ? "permission:'camera'," : "observed:[{permission:'camera',granted:true,userSet:false,userFixed:false,flags:[]}],"}
      baseline:[{permission:'camera',granted:false,userSet:true,userFixed:false,flags:['USER_SET']}],
      declaration:[{permission:'camera',state:'granted'}],desired:[{permission:'camera',granted:true,userSet:false,userFixed:false,flags:[]}]},
      {requestId:'crash-test',deadline:Date.now()+10000,signal:new AbortController().signal});
    process.send({phase:'write-began',path:lease.permissionRecoveryPath});
    setInterval(()=>{},1000);
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const closed = new Promise<void>(resolve => { child.once('close', () => resolve()); });
  let stderr = ''; child.stderr!.on('data', chunk => { stderr += chunk; });
  try {
    const path = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`Child did not reach its durable write: ${stderr}`)), 5000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(Error(`Child exited before its durable write: ${stderr}`)); });
      child.once('message', value => {
        clearTimeout(timer);
        const message = value as { phase: string; path: string };
        if (message.phase !== 'write-began') reject(Error('Unexpected child phase')); else resolve(message.path);
      });
    });
    const before = await readFile(path, 'utf8');
    expect(JSON.parse(before)).toMatchObject({ status, restored: false, uid: 10123, baseline: [{ permission: 'camera', flags: ['USER_SET'] }] });
    child.kill('SIGKILL'); await closed;
    const manager = new DeviceLeaseManager({ rootDir: root, retryDelayMs: 1 });
    await expect(manager.acquire('android', 'fake-device', { signal: AbortSignal.timeout(1000) })).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(before).not.toMatch(/fake-device|Bearer|127\.0\.0\.1|auth=/);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; }
});
