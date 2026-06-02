import { describe, it, expect, vi } from 'vitest';
import { Locator } from '../src/Locator.js';

const testWidget = {
  id: '42',
  type: 'ElevatedButton',
  text: 'Increment',
  key: 'increment_button',
  rect: { x: 50, y: 100, width: 200, height: 48 },
  hitTestable: true,
  properties: {},
};

function createMockSendRequest(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((method: string) => {
    if (method === 'ext.fliwright.resolve') {
      return responses.resolve ?? { matches: [], widgets: [], count: 0 };
    }
    if (method === 'ext.fliwright.action') {
      return responses.action ?? { success: true };
    }
    return responses[method] ?? {};
  });
}

function selectorParam(call: unknown[]) {
  return JSON.parse((call[1] as Record<string, string>).selector);
}

describe('Locator', () => {
  it('click() sends a single strict hit-testable action', async () => {
    const sendRequest = createMockSendRequest({ action: { success: true } });

    const locator = new Locator({ text: 'Increment' }, sendRequest);
    await locator.click();

    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.action', {
      action: 'tap',
      selector: JSON.stringify({ match: { text: 'Increment' } }),
      strict: 'true',
      visible: 'hitTestable',
      alignment: 'center',
    });
  });

  it('throws when action returns an error', async () => {
    const sendRequest = createMockSendRequest({
      action: { success: false, error: 'No widget found matching selector' },
    });

    const locator = new Locator({ text: 'Missing' }, sendRequest);
    await expect(locator.click()).rejects.toThrow('No widget found matching selector');
  });

  it('count() returns resolve match count', async () => {
    const sendRequest = createMockSendRequest({
      resolve: { matches: [testWidget], count: 1 },
    });

    const locator = new Locator({ text: 'Increment' }, sendRequest);
    await expect(locator.count()).resolves.toBe(1);
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.resolve', {
      selector: JSON.stringify({ match: { text: 'Increment' } }),
      strict: 'false',
      visible: 'any',
    });
  });

  it('isVisible() uses hit-testable resolve', async () => {
    const sendRequest = createMockSendRequest({
      resolve: { matches: [testWidget], count: 1 },
    });

    const locator = new Locator({ key: 'increment_button' }, sendRequest);
    await expect(locator.isVisible()).resolves.toBe(true);
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.resolve', {
      selector: JSON.stringify({ match: { key: 'increment_button' } }),
      limit: '1',
      strict: 'false',
      visible: 'hitTestable',
    });
  });

  it('resolve() returns first widget', async () => {
    const sendRequest = createMockSendRequest({
      resolve: { matches: [testWidget], count: 1 },
    });

    const locator = new Locator({ type: 'ElevatedButton' }, sendRequest);
    await expect(locator.resolve()).resolves.toEqual(testWidget);
  });

  it('supports descendant shorthand and nth()', async () => {
    const sendRequest = createMockSendRequest({ resolve: { matches: [], count: 0 } });
    const locator = new Locator({ type: 'Form' }, sendRequest).getByText('Submit').nth(2);

    await locator.count();
    expect(selectorParam(sendRequest.mock.calls[0])).toEqual({
      match: { text: 'Submit' },
      within: { match: { type: 'Form' } },
      position: { nth: 2 },
    });
  });

  it('type() and fill() send action payloads', async () => {
    const sendRequest = createMockSendRequest({ action: { success: true } });
    const locator = new Locator({ key: 'email_field' }, sendRequest);

    await locator.type('user@example.com', { delay: 50 });
    await locator.fill('replacement', { charDelay: 25 });

    expect(sendRequest).toHaveBeenNthCalledWith(1, 'ext.fliwright.action', {
      action: 'type',
      selector: JSON.stringify({ match: { key: 'email_field' } }),
      strict: 'true',
      visible: 'hitTestable',
      text: 'user@example.com',
      charDelay: '50',
      replaceAll: 'false',
    });
    expect(sendRequest).toHaveBeenNthCalledWith(2, 'ext.fliwright.action', {
      action: 'fill',
      selector: JSON.stringify({ match: { key: 'email_field' } }),
      strict: 'true',
      visible: 'hitTestable',
      text: 'replacement',
      charDelay: '25',
      replaceAll: 'true',
    });
  });

  it('gesture and scroll helpers use action extension', async () => {
    const sendRequest = createMockSendRequest({ action: { success: true } });
    const locator = new Locator('text=Increment', sendRequest);

    await locator.longPress({ duration: 1000 });
    await locator.drag(100, -50, { steps: 20 });
    await locator.pinch(0.5, { steps: 15 });
    await locator.scrollIntoView({ alignment: 0, duration: 500 });

    expect(sendRequest.mock.calls.map((call) => [call[0], (call[1] as any).action])).toEqual([
      ['ext.fliwright.action', 'longPress'],
      ['ext.fliwright.action', 'drag'],
      ['ext.fliwright.action', 'pinch'],
      ['ext.fliwright.action', 'scrollIntoView'],
    ]);
  });
});
