import type { RunResult } from '../types.js';

/** The CodeLens action starts recording only after the selected run succeeds. */
export async function recordAfterPassingTest(
  run: () => Promise<RunResult | undefined>,
  start: () => Promise<unknown>,
): Promise<boolean> {
  const result = await run();
  if (!result?.passed || result.totalTests === 0 || result.passedTests !== result.totalTests || result.failedTests > 0) return false;
  await start();
  return true;
}
