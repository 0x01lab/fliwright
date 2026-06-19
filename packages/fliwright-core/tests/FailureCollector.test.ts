import { describe, it, expect, vi } from 'vitest';
import { FailureCollector } from '../src/FailureCollector.js';
import { AssertionError } from '../src/Assertion.js';

function createMockSendRequest(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((method: string) => {
    if (method === 'ext.fliwright.screenshot') return responses['fliwrightScreenshot'] ?? {};
    if (method === 'ext.fliwright.snapshot') return responses['snapshot'] ?? { widgets: [] };
    if (method === 'ext.fliwright.inspect') return responses['inspect'] ?? { widgets: [] };
    return {};
  });
}

describe('FailureCollector', () => {
  it('collects failure context from AssertionError', async () => {
    const sendRequest = createMockSendRequest({
      fliwrightScreenshot: { screenshot: Buffer.from('png').toString('base64') },
      snapshot: { widgets: [{ type: 'ElevatedButton' }], count: 1 },
      inspect: { widgets: [], count: 0 },
    });
    const collector = new FailureCollector(sendRequest);
    const error = new AssertionError('toBeVisible', 'visible', 'not visible', 'text=Login');
    const ctx = await collector.collect(error, 5000);
    expect(ctx.assertion.matcher).toBe('toBeVisible');
    expect(ctx.assertion.timeout).toBe(5000);
    expect(ctx.screenshot?.toString()).toBe('png');
    expect(ctx.timestamp).toBeDefined();
    expect(ctx.widgetTree).toEqual({ widgets: [{ type: 'ElevatedButton' }], count: 1 });
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.screenshot', {});
  });

  it('handles screenshot failure gracefully', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.screenshot') throw new Error('not available');
      if (method === 'ext.fliwright.snapshot') return { widgets: [] };
      if (method === 'ext.fliwright.inspect') return { widgets: [] };
      return {};
    });
    const collector = new FailureCollector(sendRequest);
    const error = new AssertionError('toBeVisible', 'visible', 'not visible', 'text=Login');
    const ctx = await collector.collect(error, 5000);
    expect(ctx.screenshot).toBeNull();
    expect(ctx.assertion.matcher).toBe('toBeVisible');
  });

  it('does not fall back to legacy flutter driver screenshots', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.screenshot') return {};
      if (method === 'ext.fliwright.snapshot') return { widgets: [] };
      return {};
    });
    const collector = new FailureCollector(sendRequest);
    const error = new AssertionError('toBeVisible', 'visible', 'not visible', 'text=Login');
    const ctx = await collector.collect(error, 5000);
    expect(ctx.screenshot).toBeNull();
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.screenshot', {});
    expect(sendRequest.mock.calls.map(([method]) => method)).not.toContain('ext.flutter.driver.screenshot');
  });

  it('falls back to inspect when snapshot collection fails', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.snapshot') throw new Error('snapshot unavailable');
      if (method === 'ext.fliwright.inspect') return { widgets: [{ type: 'Text' }], count: 1 };
      return {};
    });
    const collector = new FailureCollector(sendRequest);
    const error = new AssertionError('toBeVisible', 'visible', 'not visible', 'text=Login');
    const ctx = await collector.collect(error, 5000);
    expect(ctx.widgetTree).toEqual({ widgets: [{ type: 'Text' }], count: 1 });
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.snapshot', {});
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.inspect', { selector: '' });
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
