import type { TestSpecification, Vitest } from 'vitest/node';

/**
 * Encodes the Vitest 5 focused rerun recipe for the persistent TDD executor.
 * Vitest 5 replaces changeNamePattern/changeFilenamePattern with specification-scoped
 * filters plus rerunTestSpecifications.
 */
export async function focusAndRerun(vitest: Vitest, file: string, testName?: string): Promise<void> {
  const specifications = await resolveSpecifications(vitest, file);
  if (specifications.length === 0) {
    throw new Error(`No Vitest specifications found for ${file}`);
  }

  const savedPatterns = specifications.map((spec) => spec.testNamePattern);
  try {
    if (testName) {
      const pattern = new RegExp(testName);
      for (const spec of specifications) spec.testNamePattern = pattern;
    }
    await vitest.rerunTestSpecifications(specifications);
  } finally {
    specifications.forEach((spec, index) => {
      spec.testNamePattern = savedPatterns[index];
    });
  }
}

async function resolveSpecifications(vitest: Vitest, file: string): Promise<TestSpecification[]> {
  let specifications = vitest.getModuleSpecifications(file);
  if (specifications.length > 0) return specifications;

  return (await vitest.globTestSpecifications([file])).filter(
    (spec) => spec.moduleId === file,
  );
}
