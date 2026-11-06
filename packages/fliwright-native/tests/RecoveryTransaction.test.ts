import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { RecoveryTransaction, inspectRecoveryTransaction } from '../src/RecoveryTransaction.js';
import { nativeModuleCompiler } from './helpers/compileNativeModule.js';
import { withNativeToolOwnership } from '../src/NativeToolOwnership.js';
import { executeTool } from '../src/ToolExecutor.js';
import { setTimeout as delay } from 'node:timers/promises';

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  await Promise.all(children.splice(0).map(async child => {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await new Promise(resolve => child.once('close', resolve)); }
  }));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'recovery-transaction-')); roots.push(root);
  const path = join(root, 'device.recovery');
  return { root, path, binding: { deviceKey: 'a'.repeat(64), fingerprint: 'b'.repeat(64), originalDigest: 'c'.repeat(64) } };
}

it('publishes an immutable claim and checkpoints without changing earlier record bytes', async () => {
  const f = await fixture(), tx = await RecoveryTransaction.claim(f.path, f.binding);
  const first = await readFile(join(f.path, 'step-000000', 'record.json'));
  await tx.checkpoint('shutdown-pending');
  await tx.checkpoint('readback-completed', '2026-11-04T02:00:00.000Z');
  expect(await readFile(join(f.path, 'step-000000', 'record.json'))).toEqual(first);
  expect(await inspectRecoveryTransaction(f.path)).toMatchObject({ state: 'live', valid: true });
  expect(tx.current).toMatchObject({ phase: 'readback-completed', shutdownPending: true, completionBoot: '2026-11-04T02:00:00.000Z' });
  const names = await readdir(f.path);
  expect(names).toEqual(['step-000000', 'step-000001', 'step-000002']);
});

it('excludes concurrent restorers under repeated multi-claim contention', async () => {
  const f = await fixture();
  await mkdir(f.path);
  for (let index = 0; index < 10; index++) {
    const path = join(f.path, String(index));
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => RecoveryTransaction.claim(path, f.binding)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const losers = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(losers).toHaveLength(11);
    expect(losers.every(result => result.reason?.code === 'device_busy')).toBe(true);
    await expect(RecoveryTransaction.claim(path, f.binding)).rejects.toMatchObject({ code: 'device_busy' });
  }
});

it('does not reinterpret a generic, malformed or legacy recovery reservation', async () => {
  const f = await fixture();
  await mkdir(f.path); await writeFile(join(f.path, 'owner.json'), JSON.stringify({ pid: 2147483000 }));
  await expect(RecoveryTransaction.claim(f.path, f.binding)).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readdir(f.path)).toEqual(['owner.json']);
});

it('retains exclusion and refuses completion if an earlier immutable checkpoint is replaced', async () => {
  const f = await fixture(), tx = await RecoveryTransaction.claim(f.path, f.binding);
  const record = join(f.path, 'step-000000', 'record.json');
  await writeFile(record, '{}');
  await expect(tx.checkpoint('readback-completed', '2026-11-04T02:00:00.000Z')).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readdir(f.root)).toContain('device.recovery');
});

it('requires durable readback before archival or retirement', async () => {
  const f = await fixture(), tx = await RecoveryTransaction.claim(f.path, f.binding);
  await expect(tx.checkpoint('archiving')).rejects.toMatchObject({ code: 'cleanup_failed' });
  await expect(tx.retire()).rejects.toMatchObject({ code: 'cleanup_failed' });
  await tx.checkpoint('readback-completed', '2026-11-04T02:00:00.000Z');
  await tx.checkpoint('archiving');
  await tx.checkpoint('archived');
  const archive = await tx.retire();
  expect(await readdir(f.root)).toEqual([archive.split('/').at(-1)]);
  expect((await inspectRecoveryTransaction(archive)).valid).toBe(true);
});

it('resumes an explicitly suspended epoch without resetting the unknown shutdown outcome', async () => {
  const f = await fixture(), first = await RecoveryTransaction.claim(f.path, f.binding);
  await first.checkpoint('shutdown-pending'); await first.suspend();
  const second = await RecoveryTransaction.claim(f.path, f.binding);
  expect(second.current).toMatchObject({ phase: 'shutdown-pending', shutdownPending: true });
  await expect(first.assertOwned()).rejects.toMatchObject({ code: 'cleanup_failed' });
  await expect(second.checkpoint('shutdown-pending')).rejects.toMatchObject({ code: 'cleanup_failed' });
});

it('retains a pending platform action across takeover and requires observed completion before the next write', async () => {
  const f = await fixture(), first = await RecoveryTransaction.claim(f.path, f.binding);
  await first.checkpointAction({ id: 'permission.camera.grant', intent: 'd'.repeat(64), state: 'pending' });
  const original = await readFile(join(f.path, 'step-000001', 'record.json'));
  await expect(first.checkpoint('readback-completed', 'e'.repeat(64))).rejects.toMatchObject({ code: 'cleanup_failed' });
  await first.suspend();
  const next = await RecoveryTransaction.claim(f.path, f.binding);
  expect(next.current.action).toEqual({ id: 'permission.camera.grant', intent: 'd'.repeat(64), state: 'pending' });
  await expect(next.checkpointAction({ id: 'permission.camera.flags', intent: 'd'.repeat(64), state: 'pending' })).rejects.toMatchObject({ code: 'cleanup_failed' });
  await expect(next.checkpointAction({ id: 'permission.camera.grant', intent: 'e'.repeat(64), state: 'verified', observation: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'cleanup_failed' });
  await next.checkpointAction({ id: 'permission.camera.grant', intent: 'd'.repeat(64), state: 'verified', observation: 'f'.repeat(64) });
  await next.checkpointAction({ id: 'permission.camera.flags', intent: 'e'.repeat(64), state: 'pending' });
  await next.checkpointAction({ id: 'permission.camera.flags', intent: 'e'.repeat(64), state: 'verified', observation: 'f'.repeat(64) });
  await expect(next.checkpointAction({ id: 'permission.camera.grant', intent: 'd'.repeat(64), state: 'pending' })).rejects.toMatchObject({ code: 'cleanup_failed' });
  await next.checkpoint('readback-completed', 'a'.repeat(64));
  expect(await readFile(join(f.path, 'step-000001', 'record.json'))).toEqual(original);
  expect((await inspectRecoveryTransaction(f.path)).valid).toBe(true);
});

it('takes over an actual SIGKILLed owner by appending a new epoch and preserving its records', async () => {
  const f = await fixture(), url = await nativeModuleCompiler(join(f.root, 'compiled'))('RecoveryTransaction');
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {RecoveryTransaction} from ${JSON.stringify(url)};
    const tx=await RecoveryTransaction.claim(${JSON.stringify(f.path)},${JSON.stringify(f.binding)});
    await tx.checkpoint('shutdown-pending'); process.send('ready'); setInterval(()=>{},1000);
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.push(child);
  await new Promise<void>((resolve, reject) => { child.once('message', () => resolve()); child.once('error', reject); child.once('exit', () => reject(new Error('Child exited before claim.'))); });
  const original = await readFile(join(f.path, 'step-000001', 'record.json'));
  child.kill('SIGKILL'); await new Promise(resolve => child.once('close', resolve));
  const tx = await RecoveryTransaction.claim(f.path, f.binding);
  expect(tx.current).toMatchObject({ sequence: 2, kind: 'claim', phase: 'shutdown-pending', shutdownPending: true });
  expect(await readFile(join(f.path, 'step-000001', 'record.json'))).toEqual(original);
});

it('takes over an actual SIGKILL after a platform intent without authorizing another write', async () => {
  const f = await fixture(), url = await nativeModuleCompiler(join(f.root, 'compiled'))('RecoveryTransaction');
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import {RecoveryTransaction} from ${JSON.stringify(url)};
    const tx=await RecoveryTransaction.claim(${JSON.stringify(f.path)},${JSON.stringify(f.binding)});
    await tx.checkpointAction({id:'permission.camera.grant',intent:'${'d'.repeat(64)}',state:'pending'});
    process.send('ready'); setInterval(()=>{},1000);
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.push(child);
  await new Promise<void>((resolve, reject) => { child.once('message', () => resolve()); child.once('error', reject); child.once('exit', () => reject(new Error('Child exited before pending intent.'))); });
  const original = await readFile(join(f.path, 'step-000001', 'record.json'));
  child.kill('SIGKILL'); await new Promise(resolve => child.once('close', resolve));
  const transaction = await RecoveryTransaction.claim(f.path, f.binding);
  expect(transaction.current).toMatchObject({ phase: 'restoring', action: { id: 'permission.camera.grant', state: 'pending' } });
  await expect(transaction.checkpointAction({ id: 'permission.camera.grant', intent: 'e'.repeat(64), state: 'verified', observation: 'f'.repeat(64) }))
    .rejects.toMatchObject({ code: 'cleanup_failed' });
  await expect(transaction.checkpointAction({ id: 'permission.camera.flags', intent: 'e'.repeat(64), state: 'pending' }))
    .rejects.toMatchObject({ code: 'cleanup_failed' });
  await transaction.checkpointAction({ id: 'permission.camera.grant', intent: 'd'.repeat(64), state: 'verified', observation: 'f'.repeat(64) });
  expect(await readFile(join(f.path, 'step-000001', 'record.json'))).toEqual(original);
});

it('does not suspend or transfer exclusion while an actually owned host process is running', async () => {
  const f = await fixture(), tx = await RecoveryTransaction.claim(f.path, f.binding), controller = new AbortController();
  const context = { requestId: 'tool', deadline: Date.now() + 10000, signal: controller.signal };
  const work = withNativeToolOwnership({ path: tx.toolPath, operationToken: tx.operationToken, assertOwned: () => tx.assertOwned() },
    () => executeTool(process.execPath, ['-e', 'setInterval(()=>{},1000)'], context));
  // Attach the failure handler before cancellation so no rejection can become unhandled.
  const settled = work.catch(error => error);
  for (let count = 0; count < 100; count++) {
    try { if (JSON.parse(await readFile(tx.toolPath, 'utf8')).phase === 'running') break; } catch { /* Not published yet. */ }
    await delay(10);
  }
  expect(JSON.parse(await readFile(tx.toolPath, 'utf8')).phase).toBe('running');
  await expect(tx.suspend()).rejects.toMatchObject({ code: 'cleanup_failed' });
  await expect(RecoveryTransaction.claim(f.path, f.binding)).rejects.toMatchObject({ code: 'device_busy' });
  controller.abort(); await settled;
  await tx.suspend();
  const next = await RecoveryTransaction.claim(f.path, f.binding);
  expect(next.current.kind).toBe('claim');
});

it('rejects linked inert candidates during takeover rather than following their records', async () => {
  const f = await fixture(), tx = await RecoveryTransaction.claim(f.path, f.binding);
  await tx.suspend();
  const pending = join(f.path, '.pending-00000000-0000-4000-8000-000000000001');
  await mkdir(pending); await symlink(join(f.path, 'step-000000', 'record.json'), join(pending, 'record.json'));
  await expect(RecoveryTransaction.claim(f.path, f.binding)).rejects.toMatchObject({ code: 'cleanup_failed' });
});
