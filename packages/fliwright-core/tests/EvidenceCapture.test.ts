import { describe, expect, it, vi } from 'vitest';
import { EvidenceCapture } from '../src/index.js';

describe('EvidenceCapture', () => {
  it('returns partial evidence immediately on cancellation and clears the remaining channel timers', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const diagnostics = vi.fn(async () => 'must not start');
      const capture = new EvidenceCapture({ totalBudgetMs: 3000 });
      const pending = capture.capture('aborted', {
        screenshot: async () => 'saved screenshot', snapshot: () => new Promise(() => {}), diagnostics,
      }, { signal: controller.signal });
      await vi.advanceTimersByTimeAsync(1);
      controller.abort(new Error('test finalization deadline'));
      const result = await pending;
      expect(result.status).toBe('partial');
      expect(result.channels.screenshot).toMatchObject({ status: 'captured', value: 'saved screenshot' });
      expect(result.channels.snapshot).toMatchObject({ status: 'timeout' });
      expect(result.channels.diagnostics).toMatchObject({ status: 'timeout' });
      expect(diagnostics).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('returns the original partial result to concurrent and later callers', async () => {
    const capture = new EvidenceCapture();
    const screenshot = vi.fn(async () => { throw new Error('offline'); });
    const [first, concurrent] = await Promise.all([
      capture.capture('same', { screenshot }), capture.capture('same', { screenshot }),
    ]);
    expect(concurrent).toBe(first);
    expect(await capture.capture('same', {})).toBe(first);
    expect(first.status).toBe('partial');
    expect(screenshot).toHaveBeenCalledTimes(1);
  });

  it('reports disabled when no channels are enabled and clears completed timers', async () => {
    vi.useFakeTimers();
    try {
      const capture = new EvidenceCapture();
      expect((await capture.capture('off', {})).status).toBe('disabled');
      await capture.capture('on', { screenshot: async () => 'png' });
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('captures evidence independently when one channel fails', async () => {
    const capture = new EvidenceCapture({ totalBudgetMs: 100 });
    const result = await capture.capture('failure-1', {
      screenshot: async () => Buffer.from('png'),
      snapshot: async () => ({ route: '/form' }),
      diagnostics: async () => { throw new Error('diagnostics unavailable'); },
    });
    expect(result.failureId).toBe('failure-1');
    expect(result.channels.screenshot.status).toBe('captured');
    expect(result.channels.snapshot.status).toBe('captured');
    expect(result.channels.diagnostics.status).toBe('unavailable');
    expect(result.channels.diagnostics.error).toBeInstanceOf(Error);
    expect(result.status).toBe('partial');
  });

  it('marks a slow channel timeout without delaying other channels', async () => {
    vi.useFakeTimers();
    try {
      const capture = new EvidenceCapture({ channelTimeoutMs: 10, totalBudgetMs: 25 });
      const promise = capture.capture('failure-2', {
        screenshot: () => new Promise<Buffer>(() => {}),
        snapshot: async () => ({ ok: true }),
      });
      await vi.advanceTimersByTimeAsync(30);
      const result = await promise;
      expect(result.channels.screenshot.status).toBe('timeout');
      expect(result.channels.snapshot.status).toBe('captured');
      expect(result.status).toBe('partial');
    } finally {
      vi.useRealTimers();
    }
  });

  it('deduplicates a failure while allowing separate failures to capture', async () => {
    const capture = new EvidenceCapture();
    const source = { screenshot: vi.fn(async () => Buffer.from('png')) };
    await capture.capture('same', source);
    await capture.capture('same', source);
    await capture.capture('other', source);
    expect(source.screenshot).toHaveBeenCalledTimes(2);
  });
});
