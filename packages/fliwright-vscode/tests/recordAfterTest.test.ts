import { expect, it, vi } from 'vitest';
import { recordAfterPassingTest } from '../src/recording/recordAfterTest.js';

it.each([
  { passed: false, totalTests: 1, passedTests: 0, failedTests: 1 },
  { passed: true, totalTests: 0, passedTests: 0, failedTests: 0 },
  { passed: true, totalTests: 1, passedTests: 0, failedTests: 0 },
])('does not start recording after a failed, empty, or skipped run', async (result) => {
  const start = vi.fn();
  expect(await recordAfterPassingTest(async () => ({ ...result, duration: 0, results: [] }), start)).toBe(false);
  expect(start).not.toHaveBeenCalled();
});

it('waits for the selected test to pass before starting recording', async () => {
  const order: string[] = [];
  expect(await recordAfterPassingTest(async () => {
    order.push('run');
    return { passed: true, totalTests: 1, passedTests: 1, failedTests: 0, duration: 1, results: [] };
  }, async () => { order.push('record'); })).toBe(true);
  expect(order).toEqual(['run', 'record']);
});
