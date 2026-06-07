import { describe, expect, it, vi } from 'vitest';
import type { FliwrightDriver } from '@fliwright/core';
import { createServerState } from '../src/state.js';
import { handleDiagnostics } from '../src/tools/diagnostics.js';

describe('handleDiagnostics', () => {
  it('throws when no driver is connected', async () => {
    await expect(handleDiagnostics({}, createServerState())).rejects.toThrow(
      'fliwright_connect',
    );
  });

  it('uses the CLI diagnostics capability through the connected driver', async () => {
    const state = createServerState();
    const listenToDiagnostics = vi.fn().mockResolvedValue(undefined);
    const clearDiagnostics = vi.fn();
    const getDiagnostics = vi.fn().mockReturnValue([
      {
        kind: 'Flutter.Error',
        timestamp: 1,
        streamId: 'Logging',
        data: { message: 'boom' },
      },
    ]);

    state.setDriver({
      listenToDiagnostics,
      clearDiagnostics,
      getDiagnostics,
      page: {},
    } as unknown as FliwrightDriver);

    await expect(
      handleDiagnostics({
        listen: true,
        clear: true,
        streams: ['Logging'],
        kinds: ['Flutter.Error'],
        limit: 10,
      }, state),
    ).resolves.toEqual({
      listening: true,
      cleared: true,
      events: [
        {
          kind: 'Flutter.Error',
          timestamp: 1,
          streamId: 'Logging',
          data: { message: 'boom' },
        },
      ],
      count: 1,
    });

    expect(clearDiagnostics).toHaveBeenCalled();
    expect(listenToDiagnostics).toHaveBeenCalledWith(['Logging']);
    expect(getDiagnostics).toHaveBeenCalledWith({
      limit: 10,
      kinds: ['Flutter.Error'],
      streams: ['Logging'],
    });
  });
});
