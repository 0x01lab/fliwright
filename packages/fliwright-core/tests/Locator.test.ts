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
    if (method === 'ext.fliwright.type') {
      return responses['type'] ?? { success: true };
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

  describe('object selector support', () => {
    it('accepts { text: "X" } object selector', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
      });

      const locator = new Locator({ text: 'Increment' }, sendRequest);
      await locator.click();

      expect(sendRequest).toHaveBeenNthCalledWith(1, 'ext.fliwright.inspect', {
        selector: 'text=Increment',
      });
    });

    it('accepts { key: "X" } object selector', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
      });

      const locator = new Locator({ key: 'increment_button' }, sendRequest);
      await locator.click();

      expect(sendRequest).toHaveBeenNthCalledWith(1, 'ext.fliwright.inspect', {
        selector: 'key=increment_button',
      });
    });

    it('accepts { type: "X" } object selector', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
      });

      const locator = new Locator({ type: 'ElevatedButton' }, sendRequest);
      await locator.click();

      expect(sendRequest).toHaveBeenNthCalledWith(1, 'ext.fliwright.inspect', {
        selector: 'byType=ElevatedButton',
      });
    });

    it('passes ancestorSelector when ancestor is provided', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
      });

      const locator = new Locator({ text: 'Increment', ancestor: { type: 'ListView' } }, sendRequest);
      await locator.count();

      expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.inspect', {
        selector: 'text=Increment',
        ancestorSelector: 'byType=ListView',
      });
    });
  });

  describe('selectorString getter', () => {
    it('returns wire format for string input', () => {
      const locator = new Locator('text=Login', createMockSendRequest({}));
      expect(locator.selectorString).toBe('text=Login');
    });

    it('returns wire format for object input', () => {
      const locator = new Locator({ text: 'Login' }, createMockSendRequest({}));
      expect(locator.selectorString).toBe('text=Login');
    });
  });

  describe('type()', () => {
    it('sends ext.fliwright.type with correct params', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
        type: { success: true },
      });

      const locator = new Locator({ text: 'Input' }, sendRequest);
      await locator.type('hello world');

      expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.type', {
        selector: 'text=Input',
        text: 'hello world',
      });
    });

    it('sends type with delay option', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
        type: { success: true },
      });

      const locator = new Locator({ key: 'email_field' }, sendRequest);
      await locator.type('user@example.com', { delay: 50 });

      expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.type', {
        selector: 'key=email_field',
        text: 'user@example.com',
        delay: 50,
      });
    });

    it('throws when no widget found', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [], count: 0 },
      });

      const locator = new Locator({ text: 'Missing' }, sendRequest);
      await expect(locator.type('hello')).rejects.toThrow(
        'No widget found matching selector: text=Missing',
      );
    });

    it('sends type with ancestorSelector when ancestor present', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
        type: { success: true },
      });

      const locator = new Locator(
        { text: 'Input', ancestor: { type: 'Form' } },
        sendRequest,
      );
      await locator.type('test');

      expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.type', {
        selector: 'text=Input',
        ancestorSelector: 'byType=Form',
        text: 'test',
      });
    });
  });
});
