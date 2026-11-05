import { afterEach, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceLeaseManager } from '../src/DeviceLease.js';
import { executeTool } from '../src/ToolExecutor.js';
import { claimDeviceRecovery, inspectDeviceLease } from '../src/DeviceRecovery.js';
import { nativeModuleCompiler } from './helpers/compileNativeModule.js';

const roots: string[] = [];
const children: ChildProcess[] = [], groups: number[] = [];
afterEach(async () => {
  await Promise.all(children.splice(0).map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = new Promise<void>(resolve => { child.once('close', () => resolve()); });
    child.kill('SIGKILL'); await closed;
  }));
  for (const group of groups.splice(0)) { try { process.kill(-group, 'SIGKILL'); } catch { /* Already confirmed exited. */ } }
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
const context = (timeout = 5000, signal = new AbortController().signal) => ({ requestId: 'owned-tool', deadline: Date.now() + timeout, signal });
async function fixture() {
  const rootDir = await mkdtemp(join(tmpdir(), 'native-owned-tool-')); roots.push(rootDir);
  const manager = new DeviceLeaseManager({ rootDir, retryDelayMs: 1 });
  const lease = await manager.acquire('android', 'owned-tool-device');
  const operationPath = join(rootDir, `${lease.key}.lock`, 'operation.lock');
  return { rootDir, manager, lease, operationPath, recordPath: join(operationPath, 'tool-recovery.json'),
    leaseRecordPath: join(rootDir, `${lease.key}.lock`, 'native-tool-recovery.json') };
}

it('retains a lease-scoped process group after its owner crashes and blocks recovery while live', async () => {
  if (process.platform === 'win32') return;
  const rootDir = await mkdtemp(join(tmpdir(), 'native-lease-tool-crash-')); roots.push(rootDir);
  const compile = nativeModuleCompiler(join(rootDir, 'compiled'));
  const leaseUrl = await compile('DeviceLease'), executorUrl = await compile('ToolExecutor');
  const marker = join(rootDir, 'actual-runner');
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {DeviceLeaseManager} from ${JSON.stringify(leaseUrl)};
    import {executeTool} from ${JSON.stringify(executorUrl)};
    const lease=await new DeviceLeaseManager({rootDir:${JSON.stringify(rootDir)}}).acquire('ios','actual-xctest-device');
    process.send({key:lease.key});
    await lease.runOwnedTool(()=>executeTool(process.execPath,['-e',
      "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,group:process.ppid}));process.kill(r.ownerPid,'SIGKILL');process.kill(process.ppid,'SIGKILL');setInterval(()=>{},1000)",
      ${JSON.stringify(marker)},${JSON.stringify(rootDir)}+'/'+lease.key+'.lock/native-tool-recovery.json'],{requestId:'runner',deadline:Date.now()+60000,signal:new AbortController().signal}));
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  children.push(child);
  const closed = new Promise<void>(resolve => { child.once('close', () => resolve()); });
  const messages: unknown[] = []; child.on('message', message => { messages.push(message); });
  await vi.waitFor(() => { expect(messages.length).toBeGreaterThan(0); });
  const key = (messages[0] as { key: string }).key;
  await vi.waitFor(async () => { expect(await readFile(marker, 'utf8')).toContain('group'); });
  const identity = JSON.parse(await readFile(marker, 'utf8')); groups.push(identity.group);
  const journal = await readFile(join(rootDir, `${key}.lock`, 'native-tool-recovery.json'), 'utf8');
  expect(JSON.parse(journal)).toMatchObject({ phase: 'running', wrapperPid: identity.group, group: identity.group, ownerPid: child.pid });
  child.kill('SIGKILL'); await closed;
  const input = { platform: 'ios' as const, deviceId: 'actual-xctest-device', rootDir };
  const report = await inspectDeviceLease(input);
  expect(report).toMatchObject({ owner: 'exited', hostTool: 'live' });
  await expect(claimDeviceRecovery(input, { fingerprint: report.fingerprint })).rejects.toMatchObject({ code: 'device_busy' });
  process.kill(-identity.group, 'SIGKILL');
  await vi.waitFor(() => expect(() => process.kill(-identity.group, 0)).toThrow(), { timeout: 4000 });
  groups.splice(groups.indexOf(identity.group), 1);
  expect(await readFile(join(rootDir, `${key}.lock`, 'native-tool-recovery.json'), 'utf8')).toBe(journal);
  const after = await inspectDeviceLease(input);
  expect(after).toMatchObject({ owner: 'exited', hostTool: 'exited', issues: [] });
  const claim = await claimDeviceRecovery(input, { fingerprint: after.fingerprint });
  await claim.release();
}, 10000);

it('does not release a device lease while its long-lived native tool journal remains', async () => {
  const f = await fixture();
  await writeFile(f.leaseRecordPath, JSON.stringify({ schemaVersion: 1, resourceId: '00000000-0000-4000-8000-000000000000',
    operationToken: 'lease-token', ownerPid: process.pid, createdAt: new Date().toISOString(), phase: 'reserved' }));
  await expect(f.lease.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readFile(f.leaseRecordPath, 'utf8')).toContain('lease-token');
});

it('inspects and clears a long-lived tool owned by a delegated session process', async () => {
  if (process.platform === 'win32') return;
  const f = await fixture(), urls = await nativeModuleCompiler(join(f.rootDir, 'delegated-compiled'));
  const leaseUrl = await urls('DeviceLease'), executorUrl = await urls('ToolExecutor');
  const grant = await f.lease.delegate(), marker = join(f.rootDir, 'delegated-runner');
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {DeviceLeaseManager} from ${JSON.stringify(leaseUrl)};
    import {executeTool} from ${JSON.stringify(executorUrl)};
    const lease=await DeviceLeaseManager.fromEnvironment({FLIWRIGHT_NATIVE_DEVICE_LEASE:${JSON.stringify(JSON.stringify(grant))}}).acquire('android','owned-tool-device');
    const abort=new AbortController();
    const task=lease.runOwnedTool(()=>executeTool(process.execPath,['-e',
      "require('fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)",${JSON.stringify(marker)}],
      {requestId:'delegate-runner',deadline:Date.now()+30000,signal:abort.signal}));
    process.send('started');
    await new Promise(resolve=>process.once('message',resolve));
    abort.abort(); await task.catch(()=>{}); await lease.release(); process.send('done');
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  children.push(child);
  const messages: unknown[] = []; child.on('message', message => { messages.push(message); });
  await vi.waitFor(async () => { expect(await readFile(marker, 'utf8')).toBe('ready'); });
  const report = await inspectDeviceLease({ platform: 'android', deviceId: 'owned-tool-device', rootDir: f.rootDir });
  expect(report).toMatchObject({ owner: 'live', delegate: 'live', hostTool: 'live', issues: [] });
  child.send('stop');
  await vi.waitFor(() => { expect(messages).toContain('done'); });
  const after = await inspectDeviceLease({ platform: 'android', deviceId: 'owned-tool-device', rootDir: f.rootDir });
  expect(after).toMatchObject({ delegate: 'absent', hostTool: 'absent', issues: [] });
  await f.lease.release();
});

it('persists an operation-bound tool/group identity before the actual program can write', async () => {
  if (process.platform === 'win32') return;
  const f = await fixture(), marker = join(f.rootDir, 'program-marker');
  try {
    const output = await f.lease.runExclusive!(() => executeTool(process.execPath, ['-e', `
      const fs=require('fs');
      const record=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
      if(record.schemaVersion!==1||record.phase!=='running'||!record.operationToken||!record.resourceId||record.wrapperPid!==process.ppid||record.group!==process.ppid)process.exit(2);
      fs.writeFileSync(process.argv[2],'dispatched');
      process.stdout.write(JSON.stringify({wrapperPid:record.wrapperPid,toolPid:process.pid}));
    `, f.recordPath, marker], context()));
    const result = JSON.parse(output.toString());
    expect(await readFile(marker, 'utf8')).toBe('dispatched');
    expect(result.wrapperPid).not.toBe(process.pid);
    expect(result.toolPid).not.toBe(result.wrapperPid);
    expect(() => process.kill(result.wrapperPid, 0)).toThrow();
    expect(() => process.kill(-result.wrapperPid, 0)).toThrow();
    await expect(readFile(f.recordPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await f.lease.release(); }
});

it('refuses an existing tool record before starting any platform program and retains operation evidence', async () => {
  const f = await fixture(), marker = join(f.rootDir, 'must-not-exist');
  await expect(f.lease.runExclusive!(async () => {
    await writeFile(f.recordPath, '{"original":"retain"}');
    return executeTool(process.execPath, ['-e', `require('fs').writeFileSync(process.argv[1],'bad')`, marker], context());
  })).rejects.toBeDefined();
  await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(f.recordPath, 'utf8')).toBe('{"original":"retain"}');
  await expect(f.lease.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect((await readdir(f.rootDir)).some(name => name.endsWith('.dirty'))).toBe(true);
});

it('kills a real running tool group on cancellation and removes its journal only after confirmed exit', async () => {
  if (process.platform === 'win32') return;
  const f = await fixture(), marker = join(f.rootDir, 'started'), abort = new AbortController();
  const request = f.lease.runExclusive!(() => executeTool(process.execPath, ['-e', `
    require('fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,group:process.ppid}));
    setInterval(()=>{},1000);
  `, marker], context(5000, abort.signal)));
  const rejected = expect(request).rejects.toMatchObject({ code: 'cancelled' });
  await vi.waitFor(async () => { expect(await readFile(marker, 'utf8')).toContain('group'); });
  const identity = JSON.parse(await readFile(marker, 'utf8'));
  abort.abort(); await rejected;
  expect(() => process.kill(identity.pid, 0)).toThrow();
  expect(() => process.kill(-identity.group, 0)).toThrow();
  await expect(readFile(f.recordPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.lease.release();
});

it('does not persist raw tool paths, command arguments, output or secrets in the recovery record', async () => {
  if (process.platform === 'win32') return;
  const f = await fixture(), marker = join(f.rootDir, 'sensitive-output'), release = join(f.rootDir, 'release');
  const request = f.lease.runExclusive!(() => executeTool(process.execPath, ['-e', `
    process.stdout.write('Bearer test-secret');
    require('fs').writeFileSync(process.argv[1],'ready');
    const timer=setInterval(()=>{if(require('fs').existsSync(process.argv[2]))clearInterval(timer)},10);
  `, marker, release, 'private-argument'], context()));
  await vi.waitFor(async () => { expect(await readFile(marker, 'utf8')).toBe('ready'); });
  const record = await readFile(f.recordPath, 'utf8');
  expect(record).not.toMatch(/Bearer|test-secret|private-argument|owned-tool-device|process\.stdout|sensitive-output/);
  expect(record).not.toContain(process.execPath);
  expect((await inspectDeviceLease({ platform: 'android', deviceId: 'owned-tool-device', rootDir: f.rootDir })).hostTool).toBe('live');
  await writeFile(release, 'finish');
  expect((await request).toString()).toBe('Bearer test-secret');
  await f.lease.release();
});

it('rejects apparent success when a tool leaves a real descendant and cleans the owned group before returning', async () => {
  if (process.platform === 'win32') return;
  const f = await fixture(), marker = join(f.rootDir, 'descendant');
  await expect(f.lease.runExclusive!(() => executeTool(process.execPath, ['-e', `
    const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    require('fs').writeFileSync(process.argv[1],JSON.stringify({pid:child.pid,group:process.ppid}));
    child.unref();
  `, marker], context()))).rejects.toMatchObject({ code: 'transport_lost' });
  const identity = JSON.parse(await readFile(marker, 'utf8'));
  expect(() => process.kill(identity.pid, 0)).toThrow();
  expect(() => process.kill(-identity.group, 0)).toThrow();
  await expect(readFile(f.recordPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await f.lease.release();
});

it.each([false, true])('retains real owner-crash evidence and accounts for a surviving group (killWrapper=%s)', async killWrapper => {
  if (process.platform === 'win32') return;
  const rootDir = await mkdtemp(join(tmpdir(), 'native-tool-owner-crash-')); roots.push(rootDir);
  const compile = nativeModuleCompiler(join(rootDir, 'compiled'));
  const leaseUrl = await compile('DeviceLease'), executorUrl = await compile('ToolExecutor');
  const marker = join(rootDir, 'actual-tool');
  const program = `
    require('fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,group:process.ppid}));
    ${killWrapper ? "process.kill(process.ppid,'SIGKILL');" : ''}
    setInterval(()=>{},1000);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {DeviceLeaseManager} from ${JSON.stringify(leaseUrl)};
    import {executeTool} from ${JSON.stringify(executorUrl)};
    const lease=await new DeviceLeaseManager({rootDir:${JSON.stringify(rootDir)}}).acquire('android','actual-crash-device');
    process.send({key:lease.key});
    try{await lease.runExclusive(()=>executeTool(process.execPath,['-e',${JSON.stringify(program)},${JSON.stringify(marker)}],
      {requestId:'actual',deadline:Date.now()+60000,signal:new AbortController().signal}));}
    catch{process.send({failed:true});}
    setInterval(()=>{},1000);
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  children.push(child);
  const closed = new Promise<void>(resolve => { child.once('close', () => resolve()); });
  let stderr = ''; child.stderr!.on('data', chunk => { stderr += chunk; });
  const messages: unknown[] = []; child.on('message', message => { messages.push(message); });
  await vi.waitFor(() => { expect(messages.length, stderr).toBeGreaterThan(0); });
  const key = (messages[0] as { key: string }).key;
  await vi.waitFor(async () => { expect(await readFile(marker, 'utf8')).toContain('group'); });
  const identity = JSON.parse(await readFile(marker, 'utf8')); groups.push(identity.group);
  const recordPath = join(rootDir, `${key}.lock`, 'operation.lock', 'tool-recovery.json');
  const original = await readFile(recordPath, 'utf8');
  expect(JSON.parse(original)).toMatchObject({ phase: 'running', wrapperPid: identity.group, group: identity.group, ownerPid: child.pid });
  child.kill('SIGKILL'); await closed;
  const input = { platform: 'android' as const, deviceId: 'actual-crash-device', rootDir };
  if (killWrapper) {
    const report = await inspectDeviceLease(input);
    expect(report).toMatchObject({ owner: 'exited', operation: 'exited', hostTool: 'live' });
    await expect(claimDeviceRecovery(input, { fingerprint: report.fingerprint })).rejects.toMatchObject({ code: 'device_busy' });
    process.kill(-identity.group, 'SIGKILL');
  }
  await vi.waitFor(() => {
    expect(() => process.kill(-identity.group, 0)).toThrow();
    expect(() => process.kill(identity.group, 0)).toThrow();
    expect(() => process.kill(identity.pid, 0)).toThrow();
  }, { timeout: 4000 });
  groups.splice(groups.indexOf(identity.group), 1);
  expect(await readFile(recordPath, 'utf8')).toBe(original);
  const report = await inspectDeviceLease(input);
  expect(report).toMatchObject({ owner: 'exited', operation: 'exited', hostTool: 'exited', issues: [] });
  const claim = await claimDeviceRecovery(input, { fingerprint: report.fingerprint });
  await claim.release();
  expect(await readFile(recordPath, 'utf8')).toBe(original);
  await expect(new DeviceLeaseManager({ rootDir }).acquire('android', input.deviceId)).rejects.toMatchObject({ code: 'cleanup_failed' });
}, 10000);
