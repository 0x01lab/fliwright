import { stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
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

  specifications = (await vitest.globTestSpecifications([file])).filter(
    (spec) => spec.moduleId === file,
  );
  if (specifications.length > 0 || !isGeneratedCandidate(file)) return specifications;

  const candidate = resolve(file);
  if (!(await isFile(candidate))) return [];

  // Generated candidates are deliberately excluded from normal project discovery.
  // A focused rerun creates a specification for this exact, validated file only.
  return vitest.projects
    .filter((project) => isWithinProject(project.config.root, candidate))
    .map((project) => project.createSpecification(candidate));
}

function isGeneratedCandidate(file: string): boolean {
  const segments = relative(process.cwd(), resolve(file)).split(sep);
  return segments.includes('.fliwright')
    && segments[segments.indexOf('.fliwright') + 1] === 'generated'
    && /\.test\.[cm]?[jt]sx?$/.test(file);
}

function isWithinProject(root: string, file: string): boolean {
  const path = relative(root, file);
  return path !== '' && !path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
