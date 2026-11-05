import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DeviceLeaseManager } from '../src/DeviceLease.js';
import { nativeModuleCompiler } from './helpers/compileNativeModule.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const rootDir = await mkdtemp(join(tmpdir(), 'native-delegation-')); roots.push(rootDir);
  const parent = new DeviceLeaseManager({ rootDir, retryDelayMs: 2 });
  const owner = await parent.acquire('android', 'phone');
  const delegation = await owner.delegate!();
  const child = new DeviceLeaseManager({ rootDir, retryDelayMs: 2, delegation });
  return { rootDir, parent, owner, delegation, child };
}

describe('explicit device ownership delegation', () => {
  it('retains the parent device lock while serializing delegated tasks', async () => {
    const { parent, owner, child } = await setup();
    const first = await child.acquire('android', 'phone');
    expect(first.key).toBe(owner.key);
    expect(owner.recoveryPath).toBe(join(parent.rootDir, `${owner.key}.lock`, 'app-recovery.json'));
    expect(first.recoveryPath).toBeUndefined();
    expect(owner.permissionRecoveryPath).toBe(join(parent.rootDir, `${owner.key}.lock`, 'permission-recovery.json'));
    expect(first.permissionRecoveryPath).toBeUndefined();
    await expect(parent.acquire('android', 'phone', { signal: AbortSignal.timeout(15) })).rejects.toMatchObject({ code: 'cancelled' });
    await expect(child.acquire('android', 'phone', { signal: AbortSignal.timeout(15) })).rejects.toMatchObject({ code: 'cancelled' });
    await first.release();
    const second = await child.acquire('android', 'phone');
    await second.release();
    await owner.release();
    const next = await parent.acquire('android', 'phone'); await next.release();
  });

  it('rejects a foreign device, invalid token and a revoked grant without waiting', async () => {
    const { rootDir, owner, delegation, child } = await setup();
    await expect(child.acquire('ios', 'phone')).rejects.toMatchObject({ code: 'device_mismatch' });
    const wrong = new DeviceLeaseManager({ rootDir, delegation: { ...delegation, token: 'a'.repeat(64) } });
    await expect(wrong.acquire('android', 'phone')).rejects.toMatchObject({ code: 'device_mismatch' });
    await owner.release();
    await expect(child.acquire('android', 'phone')).rejects.toMatchObject({ code: 'device_mismatch' });
  });

  it('never persists the delegation credential in lease files', async () => {
    const { rootDir, owner, delegation, child } = await setup();
    const lease = await child.acquire('android', 'phone');
    const contents = await Promise.all((await readdir(join(rootDir, `${owner.key}.lock`)))
      .filter(name => name.endsWith('.json')).map(name => readFile(join(rootDir, `${owner.key}.lock`, name), 'utf8')));
    expect(contents.join('')).not.toContain(delegation.token);
    await lease.release(); await owner.release();
  });

  it('quarantines and retains the lock if a parent closes while a delegate still owns the device', async () => {
    const { rootDir, parent, owner, child } = await setup();
    const lease = await child.acquire('android', 'phone');
    await expect(owner.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(await readdir(rootDir)).toContain(`${owner.key}.dirty`);
    await expect(parent.acquire('android', 'phone')).rejects.toMatchObject({ code: 'cleanup_failed' });
    await lease.release();
  });

  it('aborts the child lifetime when the parent ownership is fenced', async () => {
    const { rootDir, owner, child } = await setup();
    const lease = await child.acquire('android', 'phone');
    await writeFile(join(rootDir, `${owner.key}.lock`, 'owner.json'), JSON.stringify({ token: 'replacement', pid: process.pid }));
    await expect(lease.assertOwned!()).rejects.toMatchObject({ code: 'device_mismatch' });
    await new Promise<void>(resolve => {
      if (lease.signal!.aborted) resolve(); else lease.signal!.addEventListener('abort', () => resolve(), { once: true });
    });
    expect(lease.signal!.aborted).toBe(true);
    await expect(lease.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
  });

  it('propagates delegated quarantine to subsequent attempts and independent processes', async () => {
    const { owner, parent, child } = await setup();
    const lease = await child.acquire('android', 'phone');
    await lease.quarantine('unconfirmed runner shutdown');
    await lease.release();
    await expect(child.acquire('android', 'phone')).rejects.toMatchObject({ code: 'cleanup_failed' });
    await owner.release();
    await expect(parent.acquire('android', 'phone')).rejects.toMatchObject({ code: 'cleanup_failed' });
  });

  it('retains managed app recovery details when cleanup is unconfirmed', async () => {
    const { owner, child } = await setup();
    await writeFile(owner.recoveryPath!, JSON.stringify({ operation: 'install', appId: 'example.app' }));
    await owner.quarantine('install acknowledgement lost');
    await expect(owner.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(JSON.parse(await readFile(owner.recoveryPath!, 'utf8'))).toMatchObject({ operation: 'install', appId: 'example.app' });
    await expect(child.acquire('android', 'phone')).rejects.toMatchObject({ code: 'cleanup_failed' });
  });

  it('hands a grant to a real child process while excluding an independent owner', async () => {
    const { rootDir, owner, delegation, parent } = await setup();
    const moduleRoot = await mkdtemp(join(tmpdir(), 'native-delegation-modules-')); roots.push(moduleRoot);
    const moduleUrl = await nativeModuleCompiler(moduleRoot)('DeviceLease');
    const child = spawn(process.execPath, ['--input-type=module', '--eval', `
      import {DeviceLeaseManager} from ${JSON.stringify(moduleUrl)};
      const lease=await DeviceLeaseManager.fromEnvironment().acquire('android','phone');
      await lease.runExclusive(async()=>{
        process.stdout.write('ready\\n');
        await new Promise(resolve=>process.stdin.once('data',resolve));
      });
      await lease.release();
    `], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, FLIWRIGHT_NATIVE_DEVICE_LEASE: JSON.stringify(delegation) } });
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
    const exit = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    try {
      await Promise.race([new Promise<void>(resolve => child.stdout.once('data', () => resolve())), exit.then(code => { throw new Error(`delegate exited ${code}: ${errors}`); })]);
      expect(output).toContain('ready');
      await expect(owner.runExclusive!(async () => 'must not overlap the child', AbortSignal.timeout(20))).rejects.toMatchObject({ code: 'cancelled' });
      await expect(parent.acquire('android', 'phone', { signal: AbortSignal.timeout(20) })).rejects.toMatchObject({ code: 'cancelled' });
      expect(await readdir(rootDir)).toEqual([`${owner.key}.lock`]);
      child.stdin.end('release');
      expect(await exit, errors).toBe(0);
      await expect(owner.runExclusive!(async () => 'prepared')).resolves.toBe('prepared');
      await owner.release();
    } finally { child.kill('SIGKILL'); await exit; }
  });
});
