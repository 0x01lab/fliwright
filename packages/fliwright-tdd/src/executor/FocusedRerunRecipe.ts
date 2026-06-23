import type { Vitest } from 'vitest/node';

/**
 * Encodes the Vitest 2.1.9 focused rerun recipe confirmed by the P0.2 spike.
 * In this Vitest version, changeNamePattern/changeFilenamePattern already rerun.
 */
export async function focusAndRerun(vitest: Vitest, file: string, testName?: string): Promise<void> {
  if (testName) {
    await vitest.changeNamePattern(testName, [file], 'fliwright tdd focused rerun');
    return;
  }

  await vitest.changeFilenamePattern(file, [file]);
}
