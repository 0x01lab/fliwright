import { describe, expect, it, vi } from 'vitest';
import type { FliwrightDriver } from '@fliwright/core';
import { createServerState } from '../src/state.js';
import { handleScreenshot } from '../src/tools/screenshot.js';

describe('handleScreenshot', () => {
  it('throws a URL discovery error when no driver or VM URL is available', async () => {
    await expect(handleScreenshot({}, createServerState(), { env: {} })).rejects.toThrow('No Flutter VM Service URL found');
  });

  it('returns screenshot bytes for MCP image content without choosing a file path', async () => {
    const state = createServerState();
    const screenshot = vi.fn(async () => Buffer.from('png'));
    state.setDriver({
      page: { screenshot },
    } as unknown as FliwrightDriver);

    const result = await handleScreenshot({ pixelRatio: 2 }, state);

    expect(screenshot).toHaveBeenCalledWith({ pixelRatio: 2 });
    expect(result).toEqual({
      success: true,
      base64: Buffer.from('png').toString('base64'),
    });
    expect(result).not.toHaveProperty('path');
    expect(result).not.toHaveProperty('outputPath');
  });

  it('auto-connects from a discoverable VM URL before capturing', async () => {
    const state = createServerState();
    const screenshot = vi.fn(async () => Buffer.from('auto-png'));
    const connect = vi.fn(async () => undefined);

    const result = await handleScreenshot({}, state, {
      env: { FLIWRIGHT_VM_URL: 'http://127.0.0.1:54321/auto/' },
      driverFactory: () => ({
        connect,
        page: { screenshot },
      } as unknown as FliwrightDriver),
    });

    expect(connect).toHaveBeenCalledWith('ws://127.0.0.1:54321/auto/ws');
    expect(screenshot).toHaveBeenCalledWith({ pixelRatio: 1 });
    expect(result.base64).toBe(Buffer.from('auto-png').toString('base64'));
  });
});
