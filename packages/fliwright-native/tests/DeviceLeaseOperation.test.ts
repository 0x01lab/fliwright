import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceLeaseManager } from '../src/DeviceLease.js';

it('serializes supervisor preparation with delegated Adapter work without reacquiring the claim', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'native-operation-'));
  const parent = await new DeviceLeaseManager({ rootDir, retryDelayMs: 1 }).acquire('android', 'owned');
  const grant = await parent.delegate!();
  const child = await new DeviceLeaseManager({ delegation: grant, retryDelayMs: 1 }).acquire('android', 'owned');
  const events: string[] = [];
  let entered!: () => void, finish!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  try {
    const read = child.runExclusive!(async () => { events.push('adapter-start'); entered(); await gate; events.push('adapter-finish'); });
    await ready;
    await expect(parent.runExclusive!(async () => { events.push('cancelled-preparation'); }, AbortSignal.timeout(20))).rejects.toMatchObject({ code: 'cancelled' });
    finish(); await read;
    await parent.runExclusive!(async () => { events.push('preparation'); });
    expect(events).toEqual(['adapter-start', 'adapter-finish', 'preparation']);
  } finally { finish?.(); await child.release(); await parent.release(); await rm(rootDir, { recursive: true, force: true }); }
});

it('retains quarantine and the device lock when a parent operation has not finished during release', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'native-operation-cleanup-'));
  const manager = new DeviceLeaseManager({ rootDir, retryDelayMs: 1 });
  const parent = await manager.acquire('android', 'owned');
  let entered!: () => void, finish!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  try {
    const work = parent.runExclusive!(async () => { entered(); await gate; });
    await ready;
    await expect(parent.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
    finish(); await work;
    await expect(manager.acquire('android', 'owned')).rejects.toMatchObject({ code: 'cleanup_failed' });
  } finally { finish?.(); await rm(rootDir, { recursive: true, force: true }); }
});

it('preserves both the platform failure and operation-cleanup failure when ownership changes', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'native-operation-errors-'));
  const parent = await new DeviceLeaseManager({ rootDir }).acquire('android', 'owned');
  try {
    const failed = parent.runExclusive!(async () => {
      await writeFile(join(rootDir, `${parent.key}.lock`, 'operation.lock', 'owner.json'), JSON.stringify({ token: 'replaced', pid: process.pid }));
      throw new Error('original platform failure');
    });
    await expect(failed).rejects.toMatchObject({ name: 'AggregateError', errors: [
      expect.objectContaining({ message: 'original platform failure' }), expect.objectContaining({ code: 'cleanup_failed' }),
    ] });
    await expect(parent.release()).rejects.toMatchObject({ code: 'cleanup_failed' });
  } finally { await rm(rootDir, { recursive: true, force: true }); }
});
