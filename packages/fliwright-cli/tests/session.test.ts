import { expect, it, vi } from 'vitest';
import { ConnectionHost } from '../src/session/ConnectionHost.js';
import { connectAppSession } from '../src/capabilities/session.js';
import { FliwrightDriver, Locator, SnapshotStore } from '@fliwright/core';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('uses the project cache for healing in an interactive app session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-session-cache-'));
  const connect = vi.spyOn(FliwrightDriver.prototype, 'connect').mockResolvedValue(undefined);
  try {
    await writeFile(join(root, 'fliwright.config.ts'), "export default { cacheRoot: 'custom-cache' };");
    const { driver } = await connectAppSession({ cwd: root }, { resolveVmUrl: async () => 'ws://mock/ws' });
    const snapshot = { type: 'TextButton', parentType: 'Column', adjacentText: [],
      rect: { x: 0, y: 0, width: 10, height: 10 }, callbackNames: [] };
    await driver.healing.recordSuccess(new Locator('key=submit', async () => ({})), 'session', async () => snapshot);
    expect(new SnapshotStore(join(root, 'custom-cache/healing')).load('session', 'key=submit')).toEqual(snapshot);
    await driver.dispose();
  } finally {
    connect.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

it('passes resolved project storage to a persistent TDD session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-session-tdd-storage-'));
  const runtime = { start: vi.fn(async () => ({})), snapshot: () => ({}), whenIdle: async () => {}, stop: async () => {} };
  const host = new ConnectionHost({ cwd: root, runtimeFactory: () => runtime as never });
  try {
    await writeFile(join(root, 'fliwright.config.ts'), "export default { runsRoot: 'history', cacheRoot: 'scratch' };");
    await host.execute('tdd.start', { vmUrl: 'ws://mock/ws' });
    expect(runtime.start).toHaveBeenCalledWith(expect.objectContaining({ sharedConfig: expect.objectContaining({
      runsRoot: join(root, 'history'), cacheRoot: join(root, 'scratch'),
    }) }));
  } finally {
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('retains one owned driver across commands and disposes only when closed', async () => {
  const driver = { connect: vi.fn(async () => {}), dispose: vi.fn(async () => {}), page: { snapshot: vi.fn(async () => ({ refs: [], snapshot: '', groupId: 'g', count: 0 })) } };
  const host = new ConnectionHost({ cwd: '/tmp', driverFactory: () => driver as never, resolveVmUrl: async () => 'ws://mock/ws' });
  await host.open();
  await host.execute('app.snapshot', {});
  await host.execute('app.snapshot', {});
  expect(driver.connect).toHaveBeenCalledTimes(1);
  expect(driver.dispose).not.toHaveBeenCalled();
  await host.close();
  expect(driver.dispose).toHaveBeenCalledTimes(1);
});

it('serializes commands through a host even when callers arrive concurrently', async () => {
  const events: string[] = [];
  const driver = { connect: vi.fn(async () => {}), dispose: vi.fn(async () => {}), page: { snapshot: async () => {
    events.push('start'); await new Promise((resolve) => setTimeout(resolve, 5)); events.push('end');
    return { refs: [], snapshot: '', groupId: 'g', count: 0 };
  } } };
  const host = new ConnectionHost({ cwd: '/tmp', driverFactory: () => driver as never, resolveVmUrl: async () => 'ws://mock/ws' });
  await host.open();
  await Promise.all([host.execute('app.snapshot', {}), host.execute('app.snapshot', {})]);
  expect(events).toEqual(['start', 'end', 'start', 'end']);
  await host.close();
});


it('rejects foreground listeners through session IPC before starting work', async () => {
  const host = new ConnectionHost({ cwd: '/tmp' });
  await expect(host.execute('mock.start', { port: -1 })).rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('cannot execute') });
  await host.close();
});

it('exposes a starting runtime to cancellation and releases it after failed startup', async () => {
  let failStart!: (error: Error) => void;
  const cancel = vi.fn(async () => { failStart(new Error('startup cancelled')); });
  const runtime = { start: vi.fn(() => new Promise((_, reject) => { failStart = reject; })), cancel, whenIdle: async () => {}, stop: async () => {} };
  const host = new ConnectionHost({ cwd: '/tmp', runtimeFactory: () => runtime as never });
  const controller = new AbortController();
  const starting = host.execute('tdd.start', { vmUrl: 'ws://mock/ws' }, { signal: controller.signal, onStart: async () => {} });
  while (!runtime.start.mock.calls.length) await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await expect(starting).rejects.toThrow('startup cancelled');
  expect(cancel).toHaveBeenCalledOnce();
  expect(host.status().tdd).toBeUndefined();
  await host.close();
});
