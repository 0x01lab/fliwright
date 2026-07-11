import { describe, expect, it, vi } from 'vitest';
import type { FliwrightDriver } from '@fliwright/core';
import { createServerState } from '../src/state.js';
import { handleAction } from '../src/tools/action.js';

describe('handleAction', () => {
  it('throws when no driver is connected', async () => {
    await expect(
      handleAction({ action: 'hover', ref: 'e1' }, createServerState()),
    ).rejects.toThrow('fliwright_connect');
  });

  it('validates action-specific parameters with zod', async () => {
    await expect(
      handleAction({ action: 'pressKey', ref: 'e1' }, createServerState()),
    ).rejects.toThrow('pressKey requires keyboardKey');

    await expect(
      handleAction({ action: 'setCheckbox', ref: 'e1' }, createServerState()),
    ).rejects.toThrow('setCheckbox requires checked');

    await expect(
      handleAction({ action: 'drag', ref: 'e1', deltaY: 100 }, createServerState()),
    ).rejects.toThrow('drag requires deltaX');
  });

  it('can target a snapshot ref', async () => {
    const state = createServerState();
    const sendRequest = vi.fn().mockResolvedValue({ success: true });
    state.setDriver({
      sendRequest,
      page: {},
    } as unknown as FliwrightDriver);

    await expect(handleAction({ action: 'doubleClick', ref: 'e1' }, state))
      .resolves.toEqual({ success: true, action: 'doubleClick' });
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.action', {
      action: 'doubleClick',
      ref: 'e1',
    });
  });

  it('passes extended ref action parameters', async () => {
    const state = createServerState();
    const sendRequest = vi.fn().mockResolvedValue({ success: true });
    state.setDriver({
      sendRequest,
      page: {},
    } as unknown as FliwrightDriver);

    await expect(
      handleAction({
        action: 'pressKey',
        ref: 'e2',
        keyboardKey: 'Backspace',
      }, state),
    ).resolves.toEqual({ success: true, action: 'pressKey' });

    await expect(
      handleAction({
        action: 'setCheckbox',
        ref: 'e3',
        checked: true,
      }, state),
    ).resolves.toEqual({ success: true, action: 'setCheckbox' });

    await expect(
      handleAction({
        action: 'selectOption',
        ref: 'e4',
        value: 'US',
      }, state),
    ).resolves.toEqual({ success: true, action: 'selectOption' });

    expect(sendRequest).toHaveBeenNthCalledWith(1, 'ext.fliwright.action', {
      action: 'pressKey',
      ref: 'e2',
      key: 'Backspace',
    });
    expect(sendRequest).toHaveBeenNthCalledWith(2, 'ext.fliwright.action', {
      action: 'setCheckbox',
      ref: 'e3',
      checked: 'true',
    });
    expect(sendRequest).toHaveBeenNthCalledWith(3, 'ext.fliwright.action', {
      action: 'selectOption',
      ref: 'e4',
      value: 'US',
    });
  });

  it('routes drag action through the shared drag interaction', async () => {
    const state = createServerState();
    const sendRequest = vi.fn().mockResolvedValue({ success: true });
    state.setDriver({
      sendRequest,
      page: {},
    } as unknown as FliwrightDriver);

    await expect(
      handleAction({
        action: 'drag',
        ref: 'e5',
        deltaX: 0,
        deltaY: 180,
        steps: 22,
      }, state),
    ).resolves.toEqual({ success: true, action: 'drag' });

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.action', {
      action: 'drag',
      ref: 'e5',
      deltaX: '0',
      deltaY: '180',
      steps: '22',
    });
  });

  it('routes raw coordinate drag action through page dragFrom', async () => {
    const state = createServerState();
    const dragFrom = vi.fn().mockResolvedValue(undefined);
    state.setDriver({
      page: { dragFrom, snapshot: vi.fn() },
    } as unknown as FliwrightDriver);

    await expect(
      handleAction({
        action: 'drag',
        x: 200,
        y: 100,
        deltaX: 0,
        deltaY: 240,
      }, state),
    ).resolves.toEqual({ success: true, action: 'drag' });

    expect(dragFrom).toHaveBeenCalledWith(200, 100, 0, 240, { steps: undefined });
  });

  it('supports page-level actions', async () => {
    const state = createServerState();
    const dismissModal = vi.fn().mockResolvedValue(undefined);
    const dismissKeyboard = vi.fn().mockResolvedValue(undefined);
    const waitForNetworkIdle = vi.fn().mockResolvedValue(undefined);
    state.setDriver({
      page: { dismissModal, dismissKeyboard, waitForNetworkIdle },
    } as unknown as FliwrightDriver);

    await expect(handleAction({ action: 'dismissModal' }, state))
      .resolves.toEqual({ success: true, action: 'dismissModal' });
    await expect(handleAction({ action: 'dismissKeyboard' }, state))
      .resolves.toEqual({ success: true, action: 'dismissKeyboard' });
    await expect(handleAction({
      action: 'waitForNetworkIdle',
      quietMs: 250,
      timeout: 2000,
    }, state)).resolves.toEqual({ success: true, action: 'waitForNetworkIdle' });

    expect(dismissModal).toHaveBeenCalled();
    expect(dismissKeyboard).toHaveBeenCalled();
    expect(waitForNetworkIdle).toHaveBeenCalledWith({
      quietMs: 250,
      timeout: 2000,
    });
  });

  it('can include a post-action snapshot', async () => {
    const state = createServerState();
    const sendRequest = vi.fn().mockResolvedValue({ success: true });
    const snapshot = vi.fn().mockResolvedValue({ refs: [{ ref: 'e1' }] });
    state.setDriver({
      sendRequest,
      page: { snapshot },
    } as unknown as FliwrightDriver);

    await expect(
      handleAction({ action: 'hover', ref: 'e1', includeSnapshot: true }, state),
    ).resolves.toEqual({
      success: true,
      action: 'hover',
      snapshot: { refs: [{ ref: 'e1' }] },
    });
  });

  it('can target a legacy text locator fallback', async () => {
    const state = createServerState();
    const clear = vi.fn().mockResolvedValue(undefined);
    const getByText = vi.fn(() => ({ clear }));
    state.setDriver({
      page: { getByText },
    } as unknown as FliwrightDriver);

    await expect(handleAction({ action: 'clear', text: 'Email' }, state))
      .resolves.toEqual({ success: true, action: 'clear' });
    expect(getByText).toHaveBeenCalledWith('Email');
    expect(clear).toHaveBeenCalled();
  });
});
