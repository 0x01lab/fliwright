import { describe, it, expect, vi } from 'vitest';
import { FailureCollector } from '../src/FailureCollector.js';
import { AssertionError } from '../src/Assertion.js';

function createMockSendRequest(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((method: string) => {
    if (method === 'ext.flutter.driver.screenshot') return responses['screenshot'] ?? {};
    if (method === 'ext.fliwright.inspect') return responses['inspect'] ?? { widgets: [] };
    return {};
  });
}

describe('FailureCollector', () => {
  it('collects failure context from AssertionError', async () => {
    const sendRequest = createMockSendRequest({
      screenshot: { screenshot: Buffer.from('png').toString('base64') },
      inspect: { widgets: [], count: 0 },
    });
    const collector = new FailureCollector(sendRequest);
    const error = new AssertionError('toBeVisible', 'visible', 'not visible', 'text=Login');
    const ctx = await collector.collect(error, 5000);
    expect(ctx.assertion.matcher).toBe('toBeVisible');
    expect(ctx.assertion.timeout).toBe(5000);
    expect(ctx.timestamp).toBeDefined();
    expect(ctx.widgetTree).toBeDefined();
  });

  it('handles screenshot failure gracefully', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.flutter.driver.screenshot') throw new Error('not available');
      if (method === 'ext.fliwright.inspect') return { widgets: [] };
      return {};
    });
    const collector = new FailureCollector(sendRequest);
    const error = new AssertionError('toBeVisible', 'visible', 'not visible', 'text=Login');
    const ctx = await collector.collect(error, 5000);
    expect(ctx.screenshot).toBeNull();
    expect(ctx.assertion.matcher).toBe('toBeVisible');
  });

  it('extracts source location from stack trace', async () => {
    const sendRequest = createMockSendRequest({});
    const collector = new FailureCollector(sendRequest);
    const error = new AssertionError('toBeVisible', 'visible', 'not visible', 'text=Login');
    error.stack = 'AssertionError: toBeVisible\n    at Object.<anonymous> (/tests/login.test.ts:42:5)';
    const ctx = await collector.collect(error, 5000);
    expect(ctx.source.file).toMatch(/login\.test\.ts/);
    expect(ctx.source.line).toBe(42);
  });
});
