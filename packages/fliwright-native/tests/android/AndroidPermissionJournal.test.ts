import { afterEach, expect, it } from 'vitest';
import { copyFile, link, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NativeOperationContext } from '@fliwright/core';
import { AndroidPermissionJournal, type AndroidPermissionCheckpoint } from '../../src/android/AndroidPermissionJournal.js';
import { inspectAndroidPermissionJournal } from '../../src/android/AndroidRecoveryRecords.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const context = (): NativeOperationContext => ({ requestId: 'permission-journal', deadline: Date.now() + 5000, signal: AbortSignal.timeout(5000) });
const checkpoint = (): AndroidPermissionCheckpoint => ({ uid: 10123, baseline: [], declaration: [], desired: [],
  status: 'verified', step: 'stopped', restored: true });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'permission-journal-')); roots.push(root);
  const directory = join(root, 'owner'); await mkdir(directory);
  const path = join(directory, 'permission-recovery.json');
  const recoveryBinding = { leaseKey: 'a'.repeat(64), ownerGeneration: 'b'.repeat(64) };
  let app = { sha256: 'c'.repeat(64), uid: 10123, installedBySession: false };
  const journal = new AndroidPermissionJournal({ path, deviceId: 'dedicated', appId: 'example.app', recoveryBinding,
    appIdentity: () => app, assertOwned: async () => {} });
  return { root, directory, path, journal, recoveryBinding, setApp: (value: typeof app) => { app = value; } };
}

it.each(['checkpoint', 'complete'] as const)('refuses byte-identical file replacement during %s and retains its bytes', async action => {
  const f = await fixture(); await f.journal.checkpoint(checkpoint(), context());
  const original = await readFile(f.path, 'utf8'), copy = join(f.root, 'copy');
  await copyFile(f.path, copy); await rename(copy, f.path);
  await expect(action === 'checkpoint' ? f.journal.checkpoint(checkpoint(), context()) : f.journal.complete(context()))
    .rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readFile(f.path, 'utf8')).toBe(original);
});

it.each(['hardlink', 'symlink', 'directory-copy'] as const)('refuses %s evidence on later writes and completion', async kind => {
  const f = await fixture(); await f.journal.checkpoint(checkpoint(), context());
  const original = await readFile(f.path, 'utf8'), other = join(f.root, 'original');
  if (kind === 'hardlink') await link(f.path, other);
  if (kind === 'symlink') { await rename(f.path, other); await symlink(other, f.path); }
  if (kind === 'directory-copy') {
    await rename(f.directory, other); await mkdir(f.directory); await copyFile(join(other, 'permission-recovery.json'), f.path);
  }
  await expect(f.journal.checkpoint(checkpoint(), context())).rejects.toMatchObject({ code: 'cleanup_failed' });
  await expect(f.journal.complete(context())).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readFile(f.path, 'utf8')).toBe(original);
});

it('rejects a checkpoint from a different installation UID before creating evidence', async () => {
  const f = await fixture();
  await expect(f.journal.checkpoint({ ...checkpoint(), uid: 10124 }, context())).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readdir(f.directory)).toEqual([]);
});

it.each(['appSha256', 'appInstalledBySession', 'ownerGeneration', 'privatePath'])(
  'rejects caller-supplied %s metadata before publication', async field => {
    const f = await fixture();
    await expect(f.journal.checkpoint({ ...checkpoint(), [field]: 'override' }, context())).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(await readdir(f.directory)).toEqual([]);
  });

it('snapshots a checkpoint before awaiting lease ownership and writes valid private evidence', async () => {
  const f = await fixture(), input = checkpoint();
  const work = f.journal.checkpoint(input, context()); input.uid = 10124;
  await work;
  const value = JSON.parse(await readFile(f.path, 'utf8'));
  expect(value).toMatchObject({ ...f.recoveryBinding, uid: 10123, appSha256: 'c'.repeat(64), appInstalledBySession: false });
  expect(inspectAndroidPermissionJournal(value)).toBe('bound');
  if (process.platform !== 'win32') expect((await stat(f.path)).mode & 0o777).toBe(0o600);
  expect(await readdir(f.directory)).toEqual(['permission-recovery.json']);
  await f.journal.complete(context());
  expect(await readdir(f.directory)).toEqual([]);
});

it('rejects installation identity changes while preserving the previous checkpoint', async () => {
  const f = await fixture(); await f.journal.checkpoint(checkpoint(), context());
  const before = await readFile(f.path, 'utf8');
  f.setApp({ sha256: 'd'.repeat(64), uid: 10123, installedBySession: false });
  await expect(f.journal.checkpoint(checkpoint(), context())).rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readFile(f.path, 'utf8')).toBe(before);
});

it('rejects malformed or oversized checkpoint data before publishing a record', async () => {
  const f = await fixture();
  for (const value of [{ ...checkpoint(), baseline: new Array(1) }, { ...checkpoint(), privatePath: 'x'.repeat(40000) }]) {
    await expect(f.journal.checkpoint(value, context())).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(await readdir(f.directory)).toEqual([]);
  }
});

it.each(['changed', 'removed'] as const)('retains its captured original baseline when a later checkpoint has it %s', async kind => {
  const f = await fixture();
  const baseline = [{ permission: 'camera' as const, granted: false, userSet: true, userFixed: false, flags: ['USER_SET'] }];
  await f.journal.checkpoint({ ...checkpoint(), step: 'readback', baseline, desired: baseline, observed: baseline }, context());
  const before = await readFile(f.path, 'utf8');
  const next = kind === 'removed' ? [] : [{ ...baseline[0], granted: true }];
  await expect(f.journal.checkpoint({ ...checkpoint(), step: 'readback', baseline: next, desired: next, observed: next }, context()))
    .rejects.toMatchObject({ code: 'cleanup_failed' });
  expect(await readFile(f.path, 'utf8')).toBe(before);
});

it('extends the tracked baseline without changing already captured originals', async () => {
  const f = await fixture();
  const camera = { permission: 'camera' as const, granted: false, userSet: true, userFixed: false, flags: ['USER_SET'] };
  const microphone = { permission: 'microphone' as const, granted: true, userSet: false, userFixed: false, flags: [] };
  await f.journal.checkpoint({ ...checkpoint(), step: 'readback', baseline: [camera], desired: [camera], observed: [camera] }, context());
  const baseline = [camera, microphone];
  await f.journal.checkpoint({ ...checkpoint(), step: 'readback', baseline, desired: baseline, observed: baseline }, context());
  expect(JSON.parse(await readFile(f.path, 'utf8')).baseline).toEqual(baseline);
  await f.journal.complete(context());
});
