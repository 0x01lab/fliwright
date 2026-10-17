import { describe, expect, it, vi } from 'vitest';
import { FinalizationBudget } from '../src/FinalizationBudget.js';

describe('attempt finalization deadline', () => {
  it('shares a deadline across stages instead of restarting each timeout', async () => {
    vi.useFakeTimers();
    try {
      const budget = new FinalizationBudget(100);
      const first = budget.run('evidence', async () => {
        await new Promise((resolve) => setTimeout(resolve, 70));
      });
      await vi.advanceTimersByTimeAsync(70);
      await first;
      const second = budget.run('diagnosis', () => new Promise(() => {}));
      const rejected = expect(second).rejects.toThrow('diagnosis exceeded the 100ms test finalization budget');
      await vi.advanceTimersByTimeAsync(30);
      await rejected;
      expect(budget.remainingMs).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('aborts timed-out work and observes its late rejection', async () => {
    vi.useFakeTimers();
    try {
      const budget = new FinalizationBudget(50);
      let signal: AbortSignal | undefined;
      let rejectLate!: (error: Error) => void;
      const work = budget.run('cleanup', async (value) => {
        signal = value;
        await new Promise<void>((_, reject) => { rejectLate = reject; });
      });
      const rejected = expect(work).rejects.toThrow('cleanup');
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
      expect(signal?.aborted).toBe(true);
      rejectLate(new Error('late cleanup failure'));
      await Promise.resolve();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('does not start optional work once the deadline has expired', async () => {
    vi.useFakeTimers();
    try {
      const budget = new FinalizationBudget(50);
      budget.begin();
      await vi.advanceTimersByTimeAsync(50);
      const work = vi.fn();
      await expect(budget.run('diagnosis', work)).rejects.toThrow('diagnosis');
      expect(work).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
