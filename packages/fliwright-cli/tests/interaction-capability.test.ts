import { describe, expect, it, vi } from 'vitest';
import {
  actionInteraction,
  diagnosticsInteraction,
  findInteraction,
  hotReloadAndSnapInteraction,
  dragInteraction,
  navigateInteraction,
  observeInteraction,
  snapInteraction,
  tapInteraction,
  typeInteraction,
  waitInteraction,
  type InteractionDriver,
} from '../src/capabilities/interaction.js';

const snapshot = {
  snapshot: '- button "Submit" [ref=e1]\n- textbox "Email" [ref=e2]\n',
  groupId: 'snapshot-1',
  refs: [
    {
      ref: 'e1',
      role: 'button',
      label: 'Submit',
      type: 'Semantics',
      key: 'submitButton',
      enabled: true,
    },
    {
      ref: 'e2',
      role: 'textbox',
      label: 'Email',
      type: 'TextField',
      enabled: true,
    },
  ],
  count: 2,
};

function createDriver(): {
  driver: InteractionDriver;
  sendRequest: ReturnType<typeof vi.fn>;
  pageSnapshot: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  drag: ReturnType<typeof vi.fn>;
  dragFrom: ReturnType<typeof vi.fn>;
  dismissModal: ReturnType<typeof vi.fn>;
  dismissKeyboard: ReturnType<typeof vi.fn>;
  waitForNetworkIdle: ReturnType<typeof vi.fn>;
  resetRouteStack: ReturnType<typeof vi.fn>;
} {
  const sendRequest = vi.fn().mockResolvedValue({ success: true });
  const pageSnapshot = vi.fn().mockResolvedValue(snapshot);
  const click = vi.fn().mockResolvedValue(undefined);
  const fill = vi.fn().mockResolvedValue(undefined);
  const drag = vi.fn().mockResolvedValue(undefined);
  const dragFrom = vi.fn().mockResolvedValue(undefined);
  const dismissModal = vi.fn().mockResolvedValue(undefined);
  const dismissKeyboard = vi.fn().mockResolvedValue(undefined);
  const waitForNetworkIdle = vi.fn().mockResolvedValue(undefined);
  const resetRouteStack = vi.fn().mockResolvedValue(undefined);

  return {
    sendRequest,
    pageSnapshot,
    click,
    fill,
    drag,
    dragFrom,
    dismissModal,
    dismissKeyboard,
    waitForNetworkIdle,
    resetRouteStack,
    driver: {
      sendRequest,
      reloadSources: vi.fn().mockResolvedValue({ type: 'Success' }),
      listenToDiagnostics: vi.fn().mockResolvedValue(undefined),
      getDiagnostics: vi.fn(() => [
        {
          kind: 'Flutter.Error',
          timestamp: 1,
          streamId: 'Logging',
          data: { message: 'boom' },
        },
      ]),
      clearDiagnostics: vi.fn(),
      page: {
        snapshot: pageSnapshot,
        screenshot: vi.fn().mockResolvedValue(Buffer.from('png')),
        waitFor: vi.fn().mockResolvedValue(undefined),
        dragFrom,
        dismissModal,
        dismissKeyboard,
        waitForNetworkIdle,
        resetRouteStack,
        getByKey: vi.fn(() => ({ click, fill, drag })),
        getByText: vi.fn(() => ({ click, fill, drag })),
        getByType: vi.fn(() => ({ click, fill, drag })),
      },
    },
  };
}

describe('CLI interaction capabilities', () => {
  it('captures snapshots through the CLI capability layer', async () => {
    const { driver, pageSnapshot } = createDriver();

    const result = await snapInteraction(driver, { depth: 2 });

    expect(pageSnapshot).toHaveBeenCalledWith({ depth: 2 });
    expect(result.refs[0].ref).toBe('e1');
  });

  it('finds and observes snapshot refs', async () => {
    const { driver } = createDriver();

    await expect(findInteraction(driver, { role: 'button' })).resolves.toEqual({
      matches: [snapshot.refs[0]],
      count: 1,
    });

    const observed = await observeInteraction(driver, {
      roles: 'textbox',
      includeDiagnostics: true,
      intent: 'fill email',
    });
    expect(observed.count).toBe(1);
    expect(observed.candidates[0]).toMatchObject({
      ref: 'e2',
      diagnostics: { intent: 'fill email', enabled: true },
    });
  });

  it('routes ref interactions through ext.fliwright.action', async () => {
    const { driver, sendRequest } = createDriver();

    await tapInteraction(driver, { ref: 'e1' });
    await typeInteraction(driver, { ref: 'e2', value: 'alice', replace: true });
    await dragInteraction(driver, { ref: 'e1', deltaX: 0, deltaY: 120, steps: 24 });
    await actionInteraction(driver, {
      action: 'pressKey',
      ref: 'e2',
      keyboardKey: 'Backspace',
    });

    expect(sendRequest).toHaveBeenNthCalledWith(1, 'ext.fliwright.action', {
      action: 'tap',
      ref: 'e1',
    });
    expect(sendRequest).toHaveBeenNthCalledWith(2, 'ext.fliwright.action', {
      action: 'fill',
      ref: 'e2',
      text: 'alice',
      replaceAll: 'true',
    });
    expect(sendRequest).toHaveBeenNthCalledWith(3, 'ext.fliwright.action', {
      action: 'drag',
      ref: 'e1',
      deltaX: '0',
      deltaY: '120',
      steps: '24',
    });
    expect(sendRequest).toHaveBeenNthCalledWith(4, 'ext.fliwright.action', {
      action: 'pressKey',
      ref: 'e2',
      key: 'Backspace',
    });
  });

  it('routes selector interactions through locators', async () => {
    const { driver, click, fill, drag } = createDriver();

    await tapInteraction(driver, { text: 'Submit' });
    await typeInteraction(driver, { key: 'email', value: 'alice' });
    await dragInteraction(driver, { type: 'ListView', deltaX: 0, deltaY: 160, steps: 20 });

    expect(click).toHaveBeenCalled();
    expect(fill).toHaveBeenCalledWith('alice');
    expect(drag).toHaveBeenCalledWith(0, 160, { steps: 20 });
  });

  it('routes coordinate drags through the page raw coordinate API', async () => {
    const { driver, dragFrom } = createDriver();

    await expect(dragInteraction(driver, {
      x: 180,
      y: 120,
      deltaX: 0,
      deltaY: 260,
      steps: 25,
    })).resolves.toEqual({ success: true, action: 'drag' });

    expect(dragFrom).toHaveBeenCalledWith(180, 120, 0, 260, { steps: 25 });
  });

  it('routes page-level actions through page APIs', async () => {
    const {
      driver,
      dismissModal,
      dismissKeyboard,
      waitForNetworkIdle,
    } = createDriver();

    await actionInteraction(driver, { action: 'dismissModal' });
    await actionInteraction(driver, { action: 'dismissKeyboard' });
    await actionInteraction(driver, {
      action: 'waitForNetworkIdle',
      quietMs: 250,
      timeout: 2000,
    });

    expect(dismissModal).toHaveBeenCalled();
    expect(dismissKeyboard).toHaveBeenCalled();
    expect(waitForNetworkIdle).toHaveBeenCalledWith({
      quietMs: 250,
      timeout: 2000,
    });
  });

  it('navigates and resets route stacks through page APIs', async () => {
    const { driver, resetRouteStack } = createDriver();

    const result = await navigateInteraction(driver, {
      action: 'resetRouteStack',
      path: '/login',
      waitUntil: 'settled',
      settleTimeout: 2500,
      includeSnapshot: true,
    });

    expect(resetRouteStack).toHaveBeenCalledWith('/login', {
      extra: undefined,
      waitUntil: 'settled',
      settleTimeout: 2500,
      stableFrames: undefined,
      waitFor: undefined,
      waitForTimeout: undefined,
      throwOnSettleTimeout: undefined,
    });
    expect(result).toMatchObject({
      success: true,
      action: 'resetRouteStack',
      path: '/login',
      snapshot,
    });
  });

  it('falls back to navigation RPCs and settle when page helpers are absent', async () => {
    const { driver, sendRequest } = createDriver();
    delete driver.page.resetRouteStack;

    await navigateInteraction(driver, {
      action: 'resetRouteStack',
      path: '/home',
      waitUntil: 'settled',
      settleTimeout: 1500,
      stableFrames: 2,
    });

    expect(sendRequest).toHaveBeenNthCalledWith(1, 'ext.fliwright.resetRouteStack', {
      path: '/home',
    });
    expect(sendRequest).toHaveBeenNthCalledWith(2, 'ext.fliwright.settle', {
      timeout: '1500',
      stableFrames: '2',
    });
  });

  it('waits for refs and performs hot reload snapshots', async () => {
    const { driver } = createDriver();

    await expect(waitInteraction(driver, { ref: 'e1', timeout: 100 }))
      .resolves.toEqual({ found: true });

    const result = await hotReloadAndSnapInteraction(driver, {
      includeRects: false,
      pixelRatio: 1,
    });

    expect(result.reloaded).toBe(true);
    expect(result.snapshot?.refs).toHaveLength(2);
    expect(result.screenshot).toBe(Buffer.from('png').toString('base64'));
    expect(result.exceptions).toEqual([]);
  });

  it('retrieves diagnostics through the CLI capability layer', async () => {
    const { driver } = createDriver();

    const result = await diagnosticsInteraction(driver, {
      listen: true,
      clear: true,
      streams: ['Logging'],
      kinds: ['Flutter.Error'],
      limit: 5,
    });

    expect(driver.clearDiagnostics).toHaveBeenCalled();
    expect(driver.listenToDiagnostics).toHaveBeenCalledWith(['Logging']);
    expect(driver.getDiagnostics).toHaveBeenCalledWith({
      limit: 5,
      kinds: ['Flutter.Error'],
      streams: ['Logging'],
    });
    expect(result).toEqual({
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
  });
});
