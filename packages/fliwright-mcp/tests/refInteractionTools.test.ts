import { describe, expect, it, vi } from 'vitest';
import type { FliwrightDriver } from '@fliwright/core';
import { createServerState } from '../src/state.js';
import { handleTap } from '../src/tools/tap.js';
import { handleType } from '../src/tools/type.js';
import { handleDrag } from '../src/tools/drag.js';
import { handleWait } from '../src/tools/wait.js';

describe('ref interaction tools', () => {
  it('validates required target predicates with zod', async () => {
    await expect(handleTap({}, createServerState())).rejects.toThrow(
      'At least one of ref, key, text, or type must be provided',
    );
    await expect(
      handleType({ value: 'alice' }, createServerState()),
    ).rejects.toThrow('At least one of ref, key, text, or type must be provided');
    await expect(
      handleDrag({ deltaX: 0, deltaY: 120 }, createServerState()),
    ).rejects.toThrow('Provide ref, key, text, type, or both x and y');
    await expect(handleWait({}, createServerState())).rejects.toThrow(
      'At least one of ref, key, text, or type must be provided',
    );
  });

  it('tap can target a snapshot ref', async () => {
    const state = createServerState();
    const sendRequest = vi.fn().mockResolvedValue({ success: true });
    state.setDriver({
      sendRequest,
      page: {},
    } as unknown as FliwrightDriver);

    await expect(handleTap({ ref: 'e1' }, state)).resolves.toEqual({
      success: true,
    });
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.action', {
      action: 'tap',
      ref: 'e1',
    });
  });

  it('tap can include a post-action snapshot', async () => {
    const state = createServerState();
    const sendRequest = vi.fn().mockResolvedValue({ success: true });
    const snapshot = vi.fn().mockResolvedValue({ refs: [{ ref: 'e1' }] });
    state.setDriver({
      sendRequest,
      page: { snapshot },
    } as unknown as FliwrightDriver);

    await expect(handleTap({ ref: 'e1', includeSnapshot: true }, state))
      .resolves.toEqual({ success: true, snapshot: { refs: [{ ref: 'e1' }] } });
    expect(snapshot).toHaveBeenCalled();
  });

  it('type can target a snapshot ref', async () => {
    const state = createServerState();
    const sendRequest = vi.fn().mockResolvedValue({ success: true });
    state.setDriver({
      sendRequest,
      page: {},
    } as unknown as FliwrightDriver);

    await expect(
      handleType({ ref: 'e2', value: 'alice', replace: true }, state),
    ).resolves.toEqual({ success: true, filled: 'alice' });
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.action', {
      action: 'fill',
      ref: 'e2',
      text: 'alice',
      replaceAll: 'true',
    });
  });

  it('type can include a post-action snapshot', async () => {
    const state = createServerState();
    const sendRequest = vi.fn().mockResolvedValue({ success: true });
    const snapshot = vi.fn().mockResolvedValue({ refs: [{ ref: 'e2' }] });
    state.setDriver({
      sendRequest,
      page: { snapshot },
    } as unknown as FliwrightDriver);

    await expect(
      handleType({
        ref: 'e2',
        value: 'alice',
        replace: true,
        includeSnapshot: true,
      }, state),
    ).resolves.toEqual({
      success: true,
      filled: 'alice',
      snapshot: { refs: [{ ref: 'e2' }] },
    });
  });

  it('drag can target a snapshot ref through the shared action path', async () => {
    const state = createServerState();
    const sendRequest = vi.fn().mockResolvedValue({ success: true });
    state.setDriver({
      sendRequest,
      page: {},
    } as unknown as FliwrightDriver);

    await expect(
      handleDrag({ ref: 'e4', deltaX: 0, deltaY: 160, steps: 20 }, state),
    ).resolves.toEqual({ success: true, action: 'drag' });
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.action', {
      action: 'drag',
      ref: 'e4',
      deltaX: '0',
      deltaY: '160',
      steps: '20',
    });
  });

  it('drag can use raw coordinates through the shared interaction path', async () => {
    const state = createServerState();
    const dragFrom = vi.fn().mockResolvedValue(undefined);
    state.setDriver({
      page: { dragFrom, snapshot: vi.fn() },
    } as unknown as FliwrightDriver);

    await expect(
      handleDrag({ x: 180, y: 120, deltaX: 0, deltaY: 260, steps: 25 }, state),
    ).resolves.toEqual({ success: true, action: 'drag' });
    expect(dragFrom).toHaveBeenCalledWith(180, 120, 0, 260, { steps: 25 });
  });

  it('wait can target a snapshot ref', async () => {
    const state = createServerState();
    const snapshot = vi.fn().mockResolvedValue({
      refs: [{ ref: 'e3' }],
    });
    state.setDriver({
      page: { snapshot },
    } as unknown as FliwrightDriver);

    await expect(handleWait({ ref: 'e3', timeout: 100 }, state)).resolves.toEqual({
      found: true,
    });
    expect(snapshot).toHaveBeenCalled();
  });
});
