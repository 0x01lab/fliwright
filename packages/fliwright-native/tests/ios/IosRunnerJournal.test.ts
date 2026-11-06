import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IosRunnerJournal, isIosRunnerRecord } from '../../src/ios/IosRunnerJournal.js';
import type { NativeOperationContext } from '@fliwright/core';

const roots: string[] = [];
const generation = '00000000-0000-4000-8000-000000000001';
const simulatorBootedAt = '2026-11-04T02:00:00.000Z';
const credentials = { sessionId: '00000000-0000-4000-8000-000000000002', recoveryKey: 'c'.repeat(64) };
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const context = (): NativeOperationContext => ({ requestId: 'runner-journal', deadline: Date.now() + 5000, signal: AbortSignal.timeout(5000) });

it('persists launch intent and binds the authenticated Simulator PID before completing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-runner-journal-')); roots.push(root);
  const path = join(root, 'runner-recovery.json'), binding = { leaseKey: 'a'.repeat(64), ownerGeneration: 'b'.repeat(64) };
  const journal = new IosRunnerJournal({ path, deviceId: 'simulator-id', binding, assertOwned: async () => {} });
  await journal.begin(generation, simulatorBootedAt, credentials, context());
  const launching = JSON.parse(await readFile(path, 'utf8'));
  expect(launching).toMatchObject({ schemaVersion: 2, phase: 'launching', ...binding, ...credentials,
    deviceKey: expect.any(String), generation, simulatorBootedAt, runnerPid: null, recoveryPort: null });
  expect(isIosRunnerRecord(launching)).toBe(true);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  await journal.bind(456, 3456, context());
  const running = JSON.parse(await readFile(path, 'utf8'));
  expect(running).toMatchObject({ phase: 'running', runnerPid: 456, recoveryPort: 3456, ...credentials });
  expect(isIosRunnerRecord(running)).toBe(true);
  expect(isIosRunnerRecord({ ...running, schemaVersion: 1 })).toBe(false);
  expect(isIosRunnerRecord({ ...running, recoveryKey: 'wrong' })).toBe(false);
  expect(isIosRunnerRecord({ ...running, recoveryPort: null })).toBe(false);
  expect(isIosRunnerRecord({ ...running, extra: true })).toBe(false);
  await journal.complete(context());
  expect(await readdir(root)).toEqual([]);
});

it('retains unresolved evidence when ownership changes or completion is cancelled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-runner-journal-')); roots.push(root);
  const path = join(root, 'runner-recovery.json'); let owned = true;
  const journal = new IosRunnerJournal({ path, deviceId: 'simulator-id',
    binding: { leaseKey: 'a'.repeat(64), ownerGeneration: 'b'.repeat(64) }, assertOwned: async () => {
      if (!owned) throw new Error('lease lost');
    } });
  await journal.begin(generation, simulatorBootedAt, credentials, context());
  await journal.bind(456, 3456, context());
  const bytes = await readFile(path, 'utf8');
  await expect(journal.complete({ ...context(), signal: AbortSignal.abort() })).rejects.toBeDefined();
  expect(await readFile(path, 'utf8')).toBe(bytes);
  owned = false;
  await expect(journal.complete(context())).rejects.toThrow('lease lost');
  expect(await readFile(path, 'utf8')).toBe(bytes);
});

it('rejects invalid runner identities and never adopts an existing journal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-runner-journal-')); roots.push(root);
  const path = join(root, 'runner-recovery.json');
  const options = { path, deviceId: 'simulator-id', binding: { leaseKey: 'a'.repeat(64), ownerGeneration: 'b'.repeat(64) }, assertOwned: async () => {} };
  const journal = new IosRunnerJournal(options);
  await expect(journal.bind(0, 3456, context())).rejects.toBeDefined();
  await expect(journal.begin(generation, 'not-a-timestamp', credentials, context())).rejects.toBeDefined();
  await expect(journal.begin(generation, simulatorBootedAt, { ...credentials, recoveryKey: 'wrong' }, context())).rejects.toBeDefined();
  await journal.begin(generation, simulatorBootedAt, credentials, context());
  await expect(journal.bind(456, 0, context())).rejects.toBeDefined();
  await expect(new IosRunnerJournal(options).begin('00000000-0000-4000-8000-000000000002', simulatorBootedAt, credentials, context())).rejects.toBeDefined();
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ generation, runnerPid: null });
});
