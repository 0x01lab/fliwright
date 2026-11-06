import { describe, expect, it, vi } from 'vitest';
import { FliwrightDriver, Locator, SnapshotStore } from '@fliwright/core';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createWorkspace, writeText } from './helpers/workspace.js';
import { FliwrightSession } from '../src/session/FliwrightSession.js';

function createDriverStub(overrides: Partial<FliwrightDriver> = {}): FliwrightDriver {
  return {
    connect: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
    sendRequest: vi.fn(async (method: string) => method === 'ext.fliwright.handshake'
      ? { status: 'ok', compatible: true, initialized: true }
      : { isolates: [{ id: 'main' }] }),
    ...overrides,
  } as unknown as FliwrightDriver;
}

describe('FliwrightSession', () => {
  it('reports config initialization failures and allows reconnecting after the config is repaired', async () => {
    const root = await createWorkspace();
    const connect = vi.spyOn(FliwrightDriver.prototype, 'connect').mockResolvedValue(undefined);
    const handshake = vi.spyOn(FliwrightDriver.prototype, 'sendRequest').mockResolvedValue({ status: 'ok', compatible: true, initialized: true });
    const session = new FliwrightSession();
    const states: string[] = [];
    session.onDidChangeState(state => states.push(state.status));
    try {
      await writeText(root, 'fliwright.config.ts', `import { readFileSync } from 'node:fs';
        readFileSync(new URL('./missing-mock.json', import.meta.url), 'utf8');
        export default {};`);

      await expect(session.connect('ws://127.0.0.1:8181/ws')).resolves.toMatchObject({
        status: 'error',
        url: 'ws://127.0.0.1:8181/ws',
        message: expect.stringMatching(/ENOENT.*missing-mock\.json/),
      });
      expect(session.state.status).toBe('error');
      expect(states).toEqual(['connecting', 'error']);
      expect(connect).not.toHaveBeenCalled();
      expect(() => session.connectedDriver).toThrow(/Connect/);

      await writeText(root, 'fliwright.config.ts', 'export default {};');
      await expect(session.connect('ws://127.0.0.1:8181/ws')).resolves.toMatchObject({ status: 'connected' });
      expect(states).toEqual(['connecting', 'error', 'connecting', 'connected']);
      expect(connect).toHaveBeenCalledOnce();
    } finally {
      await session.disconnect();
      session.dispose();
      connect.mockRestore();
      handshake.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports driver construction failures as connection errors', async () => {
    const session = new FliwrightSession({ createDriver: () => { throw new Error('Driver initialization failed'); } });
    try {
      await expect(session.connect('ws://127.0.0.1:8181/ws')).resolves.toMatchObject({
        status: 'error', message: 'Driver initialization failed',
      });
      expect(session.state.status).toBe('error');
    } finally {
      session.dispose();
    }
  });

  it('rejects a reachable VM without a bridge instead of enabling screenshot commands', async () => {
    const driver = createDriverStub({
      sendRequest: vi.fn(async () => {
        throw new Error('VM Service error [-32601]: Unknown method "ext.fliwright.handshake".');
      }),
    });
    const session = new FliwrightSession({ createDriver: () => driver });

    const state = await session.connect('ws://127.0.0.1:8181/ws');

    expect(state).toMatchObject({ status: 'error', message: expect.stringMatching(/Fliwright bridge.*not registered/i) });
    expect(state.status === 'error' && state.message).toMatch(/FliwrightBridge\.init/);
    expect(state.status === 'error' && state.message).toMatch(/entrypoint/i);
    expect(driver.dispose).toHaveBeenCalled();
    expect(() => session.connectedDriver).toThrow(/Connect/);
    session.dispose();
  });

  it.each([
    { status: 'ok', compatible: false, initialized: true },
    { status: 'ok', compatible: true, initialized: false },
    { status: 'ok' },
    null,
  ])('rejects an unready or incompatible bridge handshake %j', async (handshake) => {
    const driver = createDriverStub({ sendRequest: vi.fn(async () => handshake) });
    const session = new FliwrightSession({ createDriver: () => driver });

    await expect(session.connect('ws://127.0.0.1:8181/ws')).resolves.toMatchObject({ status: 'error' });
    expect(driver.dispose).toHaveBeenCalled();
    expect(() => session.connectedDriver).toThrow();
    session.dispose();
  });

  it('uses the workspace cache for healing through the connected driver', async () => {
    const root = await createWorkspace();
    const connect = vi.spyOn(FliwrightDriver.prototype, 'connect').mockResolvedValue(undefined);
    const handshake = vi.spyOn(FliwrightDriver.prototype, 'sendRequest').mockResolvedValue({ status: 'ok', compatible: true, initialized: true });
    const session = new FliwrightSession();
    try {
      await writeText(root, 'fliwright.config.ts', "export default { cacheRoot: 'custom-cache' };");
      await session.connect('ws://127.0.0.1:8181/ws');
      const snapshot = { type: 'TextButton', parentType: 'Column', adjacentText: [],
        rect: { x: 0, y: 0, width: 10, height: 10 }, callbackNames: [] };
      await session.connectedDriver.healing.recordSuccess(new Locator('key=submit', async () => ({})), 'session', async () => snapshot);
      expect(new SnapshotStore(join(root, 'custom-cache/healing')).load('session', 'key=submit')).toEqual(snapshot);
    } finally {
      await session.disconnect();
      connect.mockRestore();
      handshake.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('verifies an active VM Service connection with getVM', async () => {
    const driver = createDriverStub();
    const session = new FliwrightSession({ createDriver: () => driver });

    await session.connect('ws://127.0.0.1:8181/ws');

    expect(driver.sendRequest).toHaveBeenCalledWith('ext.fliwright.handshake', { protocolVersion: '2' });
    await expect(session.verifyConnection()).resolves.toBe(true);
    expect(driver.sendRequest).toHaveBeenCalledWith('getVM');
  });

  it('marks a lost connection as an error and disposes the stale driver', async () => {
    const driver = createDriverStub({
      sendRequest: vi.fn(async (method: string) => {
        if (method === 'ext.fliwright.handshake') return { status: 'ok', compatible: true, initialized: true };
        throw new Error('WebSocket connection closed');
      }),
    });
    const session = new FliwrightSession({ createDriver: () => driver });

    await session.connect('ws://127.0.0.1:8181/ws');

    await expect(session.verifyConnection()).resolves.toBe(false);
    await session.markConnectionLost('VM Service connection lost.');

    expect(driver.dispose).toHaveBeenCalled();
    expect(session.state).toEqual({
      status: 'error',
      url: 'ws://127.0.0.1:8181/ws',
      message: 'VM Service connection lost.',
    });
  });

  it('keeps the connected driver available while recording', async () => {
    const driver = createDriverStub();
    const session = new FliwrightSession({ createDriver: () => driver });

    await session.connect('ws://127.0.0.1:8181/ws');
    session.setRecording();

    expect(session.connectedDriver).toBe(driver);
  });
});
