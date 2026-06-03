import { describe, expect, it, vi } from 'vitest';
import type { FliwrightDriver } from '@fliwright/core';
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
