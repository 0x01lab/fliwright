import { describe, it, expect, vi } from 'vitest';
import { Locator } from '../src/Locator.js';

const testWidget = {
  id: '42',
  type: 'ElevatedButton',
  text: 'Increment',
  key: 'increment_button',
  rect: { x: 50, y: 100, width: 200, height: 48 },
  properties: {},
};

function createMockSendRequest(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
    if (method === 'ext.fliwright.inspect') {
      return responses['inspect'] ?? { widgets: [], count: 0 };
    }
    if (method === 'ext.fliwright.click') {
      return responses['click'] ?? { success: true };
    }
    return responses[method] ?? {};
  });
}

describe('Locator', () => {
  it('click() sends inspect then click with center coords', async () => {
    const sendRequest = createMockSendRequest({
      inspect: { widgets: [testWidget], count: 1 },
      click: { success: true },
    });

    const locator = new Locator('text=Increment', sendRequest);
    await locator.click();

    expect(sendRequest).toHaveBeenCalledTimes(2);
    expect(sendRequest).toHaveBeenNthCalledWith(1, 'ext.fliwright.inspect', { selector: 'text=Increment' });
    expect(sendRequest).toHaveBeenNthCalledWith(2, 'ext.fliwright.click', { x: 150, y: 124 });
  });

  it('click() throws when no widget found', async () => {
    const sendRequest = createMockSendRequest({
      inspect: { widgets: [], count: 0 },
    });

    const locator = new Locator('text=Missing', sendRequest);
    await expect(locator.click()).rejects.toThrow('No widget found matching selector: text=Missing');
  });

  it('click() throws when widget has no rect', async () => {
    const sendRequest = createMockSendRequest({
      inspect: { widgets: [{ id: '1', type: 'Text', text: 'NoRect', properties: {} }], count: 1 },
    });

    const locator = new Locator('text=NoRect', sendRequest);
    await expect(locator.click()).rejects.toThrow('has no render bounds');
  });

  it('count() returns widget count', async () => {
    const sendRequest = createMockSendRequest({
      inspect: { widgets: [testWidget], count: 1 },
    });

    const locator = new Locator('text=Increment', sendRequest);
    const count = await locator.count();
    expect(count).toBe(1);
  });

  it('count() returns 0 when no match', async () => {
    const sendRequest = createMockSendRequest({
      inspect: { widgets: [], count: 0 },
    });

    const locator = new Locator('text=Nothing', sendRequest);
    const count = await locator.count();
    expect(count).toBe(0);
  });

  it('isVisible() returns true when widget has rect', async () => {
    const sendRequest = createMockSendRequest({
      inspect: { widgets: [testWidget], count: 1 },
    });

    const locator = new Locator('text=Increment', sendRequest);
    await expect(locator.isVisible()).resolves.toBe(true);
  });

  it('isVisible() returns false when no match', async () => {
    const sendRequest = createMockSendRequest({
      inspect: { widgets: [], count: 0 },
    });

    const locator = new Locator('text=Nothing', sendRequest);
    await expect(locator.isVisible()).resolves.toBe(false);
  });
});
