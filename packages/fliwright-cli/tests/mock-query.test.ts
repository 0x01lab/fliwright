import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FliwrightDriver, MockManager } from '@fliwright/core';
import { mockStatusCommand, mockCallsCommand, mockApplyCommand } from '../src/commands/mock-management.js';
import { appInteractCommand } from '../src/commands/app.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

it('reads the Flutter calls store through a fresh CLI connection', async () => {
  const send = vi.fn(async () => ({ calls: [{ path: '/api/cart', method: 'GET' }] }));
  const driver = { mock: new MockManager(send), connect: vi.fn(), dispose: vi.fn() } as unknown as FliwrightDriver;
  const result = await mockCallsCommand({}, { driverFactory: () => driver, resolveVmUrl: async () => 'ws://mock/ws' });
  expect(send).toHaveBeenCalledWith('ext.fliwright.mock.getCalls', {});
  expect(result.count).toBe(1);
});

it('status reads the catalog and Flutter state without applying file rules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-mock-query-')); roots.push(root);
  await mkdir(join(root, '.fliwright/mocks/api'), { recursive: true });
  await writeFile(join(root, '.fliwright/mocks/api/cart.json'), JSON.stringify({ endpoint: '/api/cart', method: 'GET', rules: [{ name: 'ok', status: 200, body: [] }] }));
  const send = vi.fn(async (method: string) => method.endsWith('listRoutes') ? { routes: [{ path: '/api/cart', id: 'error' }] } : { calls: [] });
  const driver = { mock: new MockManager(send), connect: vi.fn(), dispose: vi.fn() } as unknown as FliwrightDriver;
  const result = await mockStatusCommand({ cwd: root }, { driverFactory: () => driver, resolveVmUrl: async () => 'ws://mock/ws' });
  expect(result.rules).toHaveLength(1);
  expect(send.mock.calls.map(([method]) => method)).toEqual(['ext.fliwright.mock.listRoutes', 'ext.fliwright.mock.getCalls']);
});

it('rejects unknown interactions before discovering or connecting to an app', async () => {
  const resolveVmUrl = vi.fn(async () => 'ws://mock/ws');
  await expect(appInteractCommand({ operation: 'typo' as 'tap' }, { resolveVmUrl })).rejects.toThrow(/operation/i);
  expect(resolveVmUrl).not.toHaveBeenCalled();
});


it('validates a named mock rule before acquiring an app connection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-invalid-rule-')); roots.push(root);
  const resolveVmUrl = vi.fn(async () => 'ws://mock/ws');
  await expect(mockApplyCommand({ cwd: root, endpoint: '/missing', ruleName: 'ok' }, { resolveVmUrl })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(resolveVmUrl).not.toHaveBeenCalled();
});
