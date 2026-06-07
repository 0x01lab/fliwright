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
