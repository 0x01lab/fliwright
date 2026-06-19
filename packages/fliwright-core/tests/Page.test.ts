import { describe, it, expect, vi } from 'vitest';
import { Page } from '../src/Page.js';

function createMockSendRequest(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
    if (method === 'ext.fliwright.resolve') {
      return responses['resolve'] ?? { matches: [], widgets: [], count: 0 };
    }
    return responses[method] ?? {};
  });
}

describe('Page', () => {
  it('returns a Locator from locator()', () => {
    const page = new Page(createMockSendRequest({}));
    const locator = page.locator('text=Login');
    expect(locator).toBeDefined();
  });

  it('returns a ref Locator from ref()', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.action': { success: true },
    });
    const page = new Page(sendRequest);

    await page.ref('e7').click();

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.action', {
      action: 'tap',
      ref: 'e7',
      alignment: 'center',
    });
  });

  it('waitFor resolves when widget appears', async () => {
    let callCount = 0;
    const sendRequest = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount >= 2) {
        return { widgets: [{ id: '1', type: 'Text', text: 'Hello', rect: { x: 0, y: 0, width: 100, height: 50 }, properties: {} }], count: 1 };
      }
      return { widgets: [], count: 0 };
    });

    const page = new Page(sendRequest);
    const locator = await page.waitFor('text=Hello', 2000);
    expect(locator).toBeDefined();
    const count = await locator.count();
    expect(count).toBe(1);
  });

  it('waitFor throws on timeout', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ widgets: [], count: 0 });
    const page = new Page(sendRequest);
    await expect(page.waitFor('text=Never', 200)).rejects.toThrow('"match":{"text":"Never"}');
  });

  it('snapshot calls snap extension with string options', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      snapshot: '- button "Submit" [ref=e1]\n',
      groupId: 'snapshot-1',
      refs: [{ ref: 'e1', role: 'button', label: 'Submit', type: 'Semantics' }],
      count: 1,
    });
    const page = new Page(sendRequest);

    const result = await page.snapshot({
      depth: 4,
      includeRects: false,
      includeProperties: true,
    });

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.snap', {
      depth: '4',
      includeRects: 'false',
      includeProperties: 'true',
    });
    expect(result.refs[0].ref).toBe('e1');
  });

  it('context calls the timeline context extension', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      route: { location: '/register' },
      focused: { ref: 'e1', role: 'textbox', label: 'Email' },
    });
    const page = new Page(sendRequest);

    const context = await page.context();

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.context', {});
    expect(context.route?.location).toBe('/register');
  });

  it('captureFrame forwards capture options', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      frameId: 'frame-1',
      capturedAt: '2026-06-18T00:00:00.000Z',
    });
    const page = new Page(sendRequest);

    await page.captureFrame({ screenshot: true, snapshot: false, diagnostics: true });

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.captureFrame', {
      screenshot: 'true',
      snapshot: 'false',
      diagnostics: 'true',
    });
  });

  it('query serializes normalized bridge queries', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      matches: [{ ref: 'e1', role: 'button', label: 'Next', enabled: true }],
      count: 1,
    });
    const page = new Page(sendRequest);

    const result = await page.query({ text: 'Next', role: 'button' }, { visible: 'hitTestable', limit: 1 });

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.query', {
      query: JSON.stringify({ text: 'Next', role: 'button' }),
      visible: 'hitTestable',
      limit: '1',
    });
    expect(result.count).toBe(1);
  });

  it('dismissModal sends a page-level action', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ success: true });
    const page = new Page(sendRequest);

    await page.dismissModal();

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.action', {
      action: 'dismissModal',
    });
  });

  it('waitForNetworkIdle sends quiet and timeout options', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ success: true });
    const page = new Page(sendRequest);

    await page.waitForNetworkIdle({ quietMs: 250, timeout: 2000 });

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.action', {
      action: 'waitForNetworkIdle',
      quietMs: '250',
      timeout: '2000',
    });
  });

  it('settle sends stable frame options and throws on settle timeout when requested', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      success: true,
      timedOut: true,
      settledAfterMs: 250,
    });
    const page = new Page(sendRequest);

    await expect(page.settle({
      timeout: 250,
      stableFrames: 4,
      throwOnTimeout: true,
    })).rejects.toThrow('settle timed out after 250ms');

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.settle', {
      timeout: '250',
      stableFrames: '4',
    });
  });

  it('goto navigates and waits for the destination to settle by default', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ success: true });
    const page = new Page(sendRequest);

    await page.goto('/login', {
      extra: { from: 'test' },
      settleTimeout: 4000,
      stableFrames: 2,
    });

    expect(sendRequest).toHaveBeenNthCalledWith(1, 'ext.fliwright.navigate', {
      path: '/login',
      extra: JSON.stringify({ from: 'test' }),
    });
    expect(sendRequest).toHaveBeenNthCalledWith(2, 'ext.fliwright.settle', {
      timeout: '4000',
      stableFrames: '2',
    });
  });

  it('goto can wait for a selector before settling', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.resolve') {
        return {
          matches: [{ id: '1', type: 'Text', text: 'Login', rect: { x: 0, y: 0, width: 100, height: 20 } }],
          count: 1,
        };
      }
      return { success: true };
    });
    const page = new Page(sendRequest);

    await page.goto('/login', {
      waitFor: { text: 'Login' },
      waitForTimeout: 1000,
      settleTimeout: 1500,
    });

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.resolve', expect.objectContaining({
      selector: expect.stringContaining('"text":"Login"'),
    }));
    expect(sendRequest).toHaveBeenLastCalledWith('ext.fliwright.settle', {
      timeout: '1500',
    });
  });

  it('resetRouteStack resets through the bridge and waits for stability', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ success: true });
    const page = new Page(sendRequest);

    await page.resetRouteStack('/dashboard', {
      extra: { id: 42 },
      waitUntil: 'settled',
      settleTimeout: 3500,
    });

    expect(sendRequest).toHaveBeenNthCalledWith(1, 'ext.fliwright.resetRouteStack', {
      path: '/dashboard',
      extra: JSON.stringify({ id: 42 }),
    });
    expect(sendRequest).toHaveBeenNthCalledWith(2, 'ext.fliwright.settle', {
      timeout: '3500',
    });
  });

  it('resetToHome resets to slash by default without settling when requested', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ success: true });
    const page = new Page(sendRequest);

    await page.resetToHome({ waitUntil: 'none' });

    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.resetRouteStack', {
      path: '/',
    });
  });

  it('findRef returns a ref locator from the current snapshot', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.snap') {
        return {
          snapshot: '- button "Submit" [ref=e1]\n',
          groupId: 'snapshot-1',
          refs: [
            { ref: 'e1', role: 'button', label: 'Submit', type: 'Semantics' },
          ],
          count: 1,
        };
      }
      return { success: true };
    });
    const page = new Page(sendRequest);

    const locator = await page.findRef({ text: 'Submit', role: 'button' });
    await locator.click();

    expect(sendRequest).toHaveBeenLastCalledWith('ext.fliwright.action', {
      action: 'tap',
      ref: 'e1',
      alignment: 'center',
    });
  });

  it('findRef throws when no snapshot ref matches', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      snapshot: '',
      groupId: 'snapshot-1',
      refs: [],
      count: 0,
    });
    const page = new Page(sendRequest);

    await expect(page.findRef({ text: 'Missing' })).rejects.toThrow(
      'No ref found for query',
    );
  });
});
