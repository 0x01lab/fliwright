import { describe, expect, it, vi } from 'vitest';
import type { FliwrightDriver } from '@fliwright/core';
import { createServerState } from '../src/state.js';
import { handleHotReloadAndSnap } from '../src/tools/hotReloadAndSnap.js';

function connectedState(overrides?: {
  reloadSources?: () => Promise<unknown>;
  snapshot?: (options?: unknown) => Promise<unknown>;
  screenshot?: (options?: unknown) => Promise<Buffer>;
}) {
  const state = createServerState();
  const reloadSources = vi.fn(overrides?.reloadSources ?? (async () => ({ type: 'Success' })));
  const snapshot = vi.fn(overrides?.snapshot ?? (async () => ({
    snapshot: '- button "Submit" [ref=e1]\n',
    refs: [{ ref: 'e1', role: 'button', label: 'Submit', type: 'Semantics' }],
    count: 1,
  })));
  const screenshot = vi.fn(overrides?.screenshot ?? (async () => Buffer.from('png')));

  state.setDriver({
    reloadSources,
    page: { snapshot, screenshot },
  } as unknown as FliwrightDriver);

  return { state, reloadSources, snapshot, screenshot };
}

describe('handleHotReloadAndSnap', () => {
  it('throws when no driver is connected', async () => {
    await expect(handleHotReloadAndSnap({}, createServerState())).rejects.toThrow(
      'fliwright_connect',
    );
  });

  it('chains reload and snapshot without capturing screenshot bytes by default', async () => {
    const { state, reloadSources, snapshot, screenshot } = connectedState();

    const result = await handleHotReloadAndSnap({
      depth: 3,
      includeRects: false,
      includeProperties: true,
    }, state);

    expect(result.reloaded).toBe(true);
    expect(result.reloadResult).toEqual({ type: 'Success' });
    expect(result.exceptions).toEqual([]);
    expect(reloadSources).toHaveBeenCalled();
    expect(snapshot).toHaveBeenCalledWith({
      depth: 3,
      includeRects: false,
      includeProperties: true,
    });
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('captures screenshot bytes only when explicitly requested', async () => {
    const { state, screenshot } = connectedState();

    const result = await handleHotReloadAndSnap({
      includeScreenshot: true,
      pixelRatio: 2,
    }, state);

    expect(result.screenshot).toBe(Buffer.from('png').toString('base64'));
    expect(screenshot).toHaveBeenCalledWith({ pixelRatio: 2 });
  });

  it('returns reload diagnostics when reload fails', async () => {
    const { state, snapshot, screenshot } = connectedState({
      reloadSources: async () => {
        throw new Error('compile failed');
      },
    });

    const result = await handleHotReloadAndSnap({}, state);

    expect(result.reloaded).toBe(false);
    expect(result.exceptions).toEqual([
      { kind: 'reload', message: 'compile failed' },
    ]);
    expect(snapshot).not.toHaveBeenCalled();
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('keeps the snapshot result without serializing screenshot bytes', async () => {
    const { state, screenshot } = connectedState();

    const result = await handleHotReloadAndSnap({}, state);

    expect(result.reloaded).toBe(true);
    expect(result.snapshot).toMatchObject({ count: 1 });
    expect(screenshot).not.toHaveBeenCalled();
    expect(result.exceptions).toEqual([]);
  });
});
