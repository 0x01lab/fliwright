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
    if (method === 'ext.fliwright.scrollIntoView') {
      return responses['scrollIntoView'] ?? { success: true, scrolled: true };
    }
    if (method === 'ext.fliwright.gesture') {
      return responses['gesture'] ?? { success: true };
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
        charDelay: '50',
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

  describe('fill()', () => {
    it('sends ext.fliwright.type with replaceAll enabled', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
        type: { success: true },
      });

      const locator = new Locator({ text: 'Input' }, sendRequest);
      await locator.fill('replacement');

      expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.type', {
        selector: 'text=Input',
        text: 'replacement',
        replaceAll: 'true',
      });
    });

    it('supports charDelay option', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
        type: { success: true },
      });

      const locator = new Locator({ key: 'email_field' }, sendRequest);
      await locator.fill('user@example.com', { charDelay: 25 });

      expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.type', {
        selector: 'key=email_field',
        text: 'user@example.com',
        charDelay: '25',
        replaceAll: 'true',
      });
    });
  });

  describe('scrollIntoView()', () => {
    it('sends ext.fliwright.scrollIntoView with default options', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
        scrollIntoView: { success: true, scrolled: true },
      });

      const locator = new Locator({ text: 'Increment' }, sendRequest);
      await locator.scrollIntoView();

      expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.scrollIntoView', {
        selector: 'text=Increment',
        alignment: 0.5,
        duration: 300,
      });
    });

    it('sends scrollIntoView with custom alignment and duration', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
        scrollIntoView: { success: true, scrolled: true },
      });

      const locator = new Locator({ key: 'increment_button' }, sendRequest);
      await locator.scrollIntoView({ alignment: 0.0, duration: 500 });

      expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.scrollIntoView', {
        selector: 'key=increment_button',
        alignment: 0.0,
        duration: 500,
      });
    });

    it('throws when no widget found', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [], count: 0 },
      });

      const locator = new Locator({ text: 'Missing' }, sendRequest);
      await expect(locator.scrollIntoView()).rejects.toThrow(
        'No widget found matching selector: text=Missing',
      );
    });
  });

  describe('longPress()', () => {
    it('sends ext.fliwright.gesture with longPress type', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
        gesture: { success: true, gesture: 'longPress' },
      });

      const locator = new Locator('text=Increment', sendRequest);
      await locator.longPress();

      expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.gesture', {
        gesture: 'longPress',
        selector: 'text=Increment',
      });
    });

    it('sends longPress with custom duration', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
        gesture: { success: true, gesture: 'longPress' },
      });

      const locator = new Locator('text=Increment', sendRequest);
      await locator.longPress({ duration: 1000 });

      expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.gesture', {
        gesture: 'longPress',
        selector: 'text=Increment',
        duration: 1000,
      });
    });

    it('throws when no widget found', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [], count: 0 },
      });

      const locator = new Locator('text=Missing', sendRequest);
      await expect(locator.longPress()).rejects.toThrow(
        'No widget found matching selector: text=Missing',
      );
    });
  });

  describe('drag()', () => {
    it('sends ext.fliwright.gesture with drag type and deltas', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
        gesture: { success: true, gesture: 'drag' },
      });

      const locator = new Locator('text=Increment', sendRequest);
      await locator.drag(100, -50);

      expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.gesture', {
        gesture: 'drag',
        selector: 'text=Increment',
        deltaX: 100,
        deltaY: -50,
      });
    });

    it('sends drag with custom steps', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
        gesture: { success: true, gesture: 'drag' },
      });

      const locator = new Locator('text=Increment', sendRequest);
      await locator.drag(200, 0, { steps: 20 });

      expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.gesture', {
        gesture: 'drag',
        selector: 'text=Increment',
        deltaX: 200,
        deltaY: 0,
        steps: 20,
      });
    });

    it('throws when no widget found', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [], count: 0 },
      });

      const locator = new Locator('text=Missing', sendRequest);
      await expect(locator.drag(100, 50)).rejects.toThrow(
        'No widget found matching selector: text=Missing',
      );
    });
  });

  describe('pinch()', () => {
    it('sends ext.fliwright.gesture with pinch type and scale', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
        gesture: { success: true, gesture: 'pinch' },
      });

      const locator = new Locator('text=Increment', sendRequest);
      await locator.pinch(0.5);

      expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.gesture', {
        gesture: 'pinch',
        selector: 'text=Increment',
        scale: 0.5,
      });
    });

    it('sends pinch with custom steps', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [testWidget], count: 1 },
        gesture: { success: true, gesture: 'pinch' },
      });

      const locator = new Locator('text=Increment', sendRequest);
      await locator.pinch(2.0, { steps: 15 });

      expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.gesture', {
        gesture: 'pinch',
        selector: 'text=Increment',
        scale: 2.0,
        steps: 15,
      });
    });

    it('throws when no widget found', async () => {
      const sendRequest = createMockSendRequest({
        inspect: { widgets: [], count: 0 },
      });

      const locator = new Locator('text=Missing', sendRequest);
      await expect(locator.pinch(0.5)).rejects.toThrow(
        'No widget found matching selector: text=Missing',
      );
    });
  });
});
