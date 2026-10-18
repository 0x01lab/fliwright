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
    sendRequest: vi.fn(async () => ({ isolates: [{ id: 'main' }] })),
    ...overrides,
  } as unknown as FliwrightDriver;
}

describe('FliwrightSession', () => {
  it('uses the workspace cache for healing through the connected driver', async () => {
    const root = await createWorkspace();
    const connect = vi.spyOn(FliwrightDriver.prototype, 'connect').mockResolvedValue(undefined);
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
      await rm(root, { recursive: true, force: true });
    }
  });

  it('verifies an active VM Service connection with getVM', async () => {
    const driver = createDriverStub();
    const session = new FliwrightSession({ createDriver: () => driver });

    await session.connect('ws://127.0.0.1:8181/ws');

    await expect(session.verifyConnection()).resolves.toBe(true);
    expect(driver.sendRequest).toHaveBeenCalledWith('getVM');
  });

  it('marks a lost connection as an error and disposes the stale driver', async () => {
    const driver = createDriverStub({
      sendRequest: vi.fn(async () => {
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
