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
});
