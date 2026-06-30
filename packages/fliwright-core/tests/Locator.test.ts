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

  it('ref locator sends action payloads by ref without selector params', async () => {
    const sendRequest = createMockSendRequest({ action: { success: true } });
    const locator = new Locator({ ref: 'e4' }, sendRequest);

    await locator.click();
    await locator.fill('replacement');

    expect(locator.selectorString).toBe('ref=e4');
    expect(sendRequest).toHaveBeenNthCalledWith(1, 'ext.fliwright.action', {
      action: 'tap',
      ref: 'e4',
      alignment: 'center',
    });
    expect(sendRequest).toHaveBeenNthCalledWith(2, 'ext.fliwright.action', {
      action: 'fill',
      ref: 'e4',
      text: 'replacement',
      replaceAll: 'true',
    });
  });

  it('does not allow selector chaining from a ref locator', () => {
    const sendRequest = createMockSendRequest({});
    const locator = new Locator({ ref: 'e4' }, sendRequest);

    expect(() => locator.getByText('child')).toThrow(
      'locator is not supported on ref locator e4',
    );
  });

  it('fillWithResolved keeps the exact resolved widget target id', async () => {
    const sendRequest = createMockSendRequest({ action: { success: true } });
    const locator = new Locator({ text: '邮箱地址' }, sendRequest);

    await locator.fillWithResolved('exact@example.com', {
      id: 'address-email-field',
      type: 'TextFormField',
      rect: { x: 20, y: 100, width: 360, height: 48 },
      properties: {},
    });

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.action', {
      action: 'fill',
      selector: JSON.stringify({ match: { text: '邮箱地址' } }),
      strict: 'true',
      visible: 'hitTestable',
      text: 'exact@example.com',
      replaceAll: 'true',
      targetId: 'address-email-field',
      targetRect: JSON.stringify({ x: 20, y: 100, width: 360, height: 48 }),
    });
  });

  it('gesture and scroll helpers use action extension', async () => {
    const sendRequest = createMockSendRequest({ action: { success: true } });
    const locator = new Locator('text=Increment', sendRequest);

    await locator.longPress({ duration: 1000 });
    await locator.drag(100, -50, { steps: 20 });
    await locator.dragTo('down', 120, { steps: 24 });
    await locator.slideTo(240, { steps: 18 });
    await locator.pinch(0.5, { steps: 15 });
    await locator.scrollIntoView({ alignment: 0, duration: 500 });

    expect(sendRequest.mock.calls.map((call) => [call[0], (call[1] as any).action])).toEqual([
      ['ext.fliwright.action', 'longPress'],
      ['ext.fliwright.action', 'drag'],
      ['ext.fliwright.action', 'semanticDrag'],
      ['ext.fliwright.action', 'slideTo'],
      ['ext.fliwright.action', 'pinch'],
      ['ext.fliwright.action', 'scrollIntoView'],
    ]);
  });

  it('extended pointer and focus helpers use action extension', async () => {
    const sendRequest = createMockSendRequest({ action: { success: true } });
    const locator = new Locator({ ref: 'e9' }, sendRequest);

    await locator.doubleClick();
    await locator.tripleClick();
    await locator.rightClick();
    await locator.hover();
    await locator.focus();
    await locator.blur();
    await locator.clear();
    await locator.pressKey('Backspace');
    await locator.setCheckbox(true);
    await locator.selectOption('US');

    expect(sendRequest.mock.calls.map((call) => (call[1] as any).action)).toEqual([
      'doubleClick',
      'tripleClick',
      'rightClick',
      'hover',
      'focus',
      'blur',
      'clear',
      'pressKey',
      'setCheckbox',
      'selectOption',
    ]);
    expect(sendRequest.mock.calls.every((call) => (call[1] as any).ref === 'e9')).toBe(true);
    expect(sendRequest.mock.calls[7][1]).toMatchObject({ key: 'Backspace' });
    expect(sendRequest.mock.calls[8][1]).toMatchObject({ checked: 'true' });
    expect(sendRequest.mock.calls[9][1]).toMatchObject({ value: 'US' });
  });

  it('check(), uncheck(), and isChecked() use semantic checked state', async () => {
    const sendRequest = createMockSendRequest({
      resolve: {
        matches: [{
          ...testWidget,
          type: 'Semantics',
          properties: { checked: true },
        }],
        count: 1,
      },
      action: { success: true },
    });
    const locator = new Locator({ semantics: { identifier: 'terms.accept' } }, sendRequest);

    await locator.check();
    await locator.uncheck();

    expect(sendRequest).toHaveBeenNthCalledWith(1, 'ext.fliwright.action', {
      action: 'setCheckbox',
      selector: JSON.stringify({ match: { semanticIdentifier: 'terms.accept' } }),
      strict: 'true',
      visible: 'hitTestable',
      checked: 'true',
    });
    expect(sendRequest).toHaveBeenNthCalledWith(2, 'ext.fliwright.action', {
      action: 'setCheckbox',
      selector: JSON.stringify({ match: { semanticIdentifier: 'terms.accept' } }),
      strict: 'true',
      visible: 'hitTestable',
      checked: 'false',
    });
    await expect(locator.isChecked()).resolves.toBe(true);
  });

  it('isChecked() falls back to toggled and selected semantic states', async () => {
    const sendRequest = createMockSendRequest({
      resolve: {
        matches: [{ ...testWidget, properties: { toggled: true } }],
        count: 1,
      },
    });
    await expect(new Locator({ key: 'toggle' }, sendRequest).isChecked()).resolves.toBe(true);

    sendRequest.mockResolvedValueOnce({
      matches: [{ ...testWidget, properties: { selected: true } }],
      count: 1,
    });
    await expect(new Locator({ key: 'radio' }, sendRequest).isChecked()).resolves.toBe(true);
  });
});
