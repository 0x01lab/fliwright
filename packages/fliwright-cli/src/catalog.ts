import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { createJiti } from 'jiti';
import { loadConfig } from './config.js';
import { MockRuleStore } from '@fliwright/core';

export interface CatalogCase {
  caseId: string;
  file: string;
  titlePath: string[];
  duplicateIndex: number;
  description?: string;
}
export type CatalogSelection = Omit<CatalogCase, 'description'>;
export function catalogCaseId(file: string, titlePath: string[], duplicateIndex: number): string {
  return createHash('sha256').update(JSON.stringify([file, titlePath, duplicateIndex])).digest('hex');
}
/** Translate the actual collected task tree, preserving duplicate title ordinals. */
export function collectedCases(modules: Iterable<any>, root: string): Array<CatalogCase & { test: any }> {
  const cases: Array<CatalogCase & { test: any }> = [];
  const counts = new Map<string, number>();
  for (const module of modules) {
    if (module.errors().length) throw new Error('Test module collection failed', { cause: module.errors()[0] });
    const file = relative(root, module.moduleId).split('\\').join('/');
    if (isAbsolute(file) || file.startsWith('../')) throw new Error('Test file escapes project');
    for (const test of module.children.allTests()) {
      const titlePath = [test.name];
      let parent = test.parent;
      while (parent && parent.type !== 'module') { titlePath.unshift(parent.name); parent = parent.parent; }
      const key = JSON.stringify([file, titlePath]);
      const duplicateIndex = counts.get(key) ?? 0;
      counts.set(key, duplicateIndex + 1);
      const description = test.meta?.().fliwrightDescription;
      cases.push({ caseId: catalogCaseId(file, titlePath, duplicateIndex), file, titlePath, duplicateIndex, test,
        ...(typeof description === 'string' && description.trim() ? { description: description.trim().slice(0, 4000) } : {}),
      });
    }
  }
  return cases;
}
export interface CollectedCatalogFile {
  file: string;
  cases: CatalogCase[];
  errors: string[];
}

/** Collect only test declarations, sharing one Vitest context across the requested patterns. */
export async function collectTestCases(options: { cwd: string; patterns: string[] }): Promise<CollectedCatalogFile[]> {
  if (!options.patterns.length) return [];
  for (const pattern of options.patterns) {
    if (isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..')) throw new Error('Suite path escapes project');
  }
  const root = await realpath(options.cwd);
  const resolver = createJiti(resolve(root, 'package.json'));
  const url = resolver.esmResolve('vitest/node', { try: true }) ?? import.meta.resolve('vitest/node');
  const { createVitest } = await import(url);
  const context = await createVitest({ root, watch: false, include: options.patterns, reporters: [], maxWorkers: 1,
    fileParallelism: false, configLoader: 'runner', cache: false, fsModuleCache: false });
  try {
    const result = await context.collect([], { staticParse: false });
    if (result.unhandledErrors.length) throw new Error('Unhandled collection error', { cause: result.unhandledErrors[0] });
    const files: CollectedCatalogFile[] = [];
    let count = 0;
    for (const module of result.testModules) {
      const file = relative(root, module.moduleId).split('\\').join('/');
      const canonical = relative(root, await realpath(module.moduleId));
      if (isAbsolute(file) || file.startsWith('../') || canonical.startsWith('../') || isAbsolute(canonical)) {
        throw new Error('Test file escapes project');
      }
      const errors = module.errors().map((error: { message?: string }) => error.message ?? String(error));
      const cases = errors.length ? [] : collectedCases([module], root).map(({ test: _test, ...item }) => item);
      count += cases.length;
      if (count > 10000) throw new Error('Catalog case limit exceeded');
      files.push({ file, cases, errors });
    }
    return files.sort((a, b) => a.file.localeCompare(b.file));
  } finally { await context.close(); }
}

/** Collection only: imports trusted project modules but never starts an app or runs hooks/tests. */
export async function collectCatalog(options: { cwd: string; suites: Record<string, string>; suiteMode?: 'patterns' | 'directories' }) {
  const root = await realpath(options.cwd);
  const config = await loadConfig(root);
  const directories = new Set(['.fliwright/mocks', ...Object.values(config.scenarios ?? {}).flatMap(scenario =>
    scenario.layers.flatMap(layer => layer.kind === 'mocks' && layer.directory ? [layer.directory] : []))]);
  if (directories.size > 20) throw new Error('Catalog mock directory limit exceeded');
  const mocks = [];
  const visited = new Set<string>();
  for (const directory of directories) {
    const path = resolve(root, directory);
    const relativePath = relative(root, path);
    if (isAbsolute(directory) || relativePath === '..' || relativePath.startsWith('../')) throw new Error('Mock directory escapes project');
    if (visited.has(relativePath)) continue;
    visited.add(relativePath);
    try { if (!(await stat(path)).isDirectory()) continue; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const realRelative = relative(root, await realpath(path));
    if (isAbsolute(realRelative) || realRelative === '..' || realRelative.startsWith('../')) throw new Error('Mock directory symlink escapes project');
    const store = new MockRuleStore();
    await store.loadFromDirectory(path);
    const endpoints = store.listEndpoints();
    if (endpoints.length > 1000 || endpoints.some(item => item.rules.length > 100)) throw new Error('Catalog mock rule limit exceeded');
    const declaredProfiles = Object.values(config.scenarios ?? {}).flatMap(scenario => scenario.layers
      .filter((layer): layer is Extract<typeof layer, { kind: 'mocks' }> => layer.kind === 'mocks' && Boolean(layer.directory) && resolve(root, layer.directory!) === path)
      .flatMap(layer => layer.profile ? [layer.profile] : []));
    const profiles = [...new Set([...declaredProfiles, ...endpoints.flatMap(item => item.rules)])].sort();
    if (endpoints.length) mocks.push({ directory: relativePath.split('\\').join('/') || '.', profiles, endpoints });
  }
  const scenarios = Object.entries(config.scenarios ?? {}).map(([name, scenario]) => {
    return { name, fingerprint: createHash('sha256').update(JSON.stringify(scenario)).digest('hex') };
  });
  const suites = [];
  for (const [id, pattern] of Object.entries(options.suites)) {
    const files = await collectTestCases({ cwd: root, patterns: [pattern] });
    const failed = files.find(file => file.errors.length);
    if (failed) throw new Error('Test module collection failed', { cause: new Error(failed.errors.join('\n')) });
    const cases = files.flatMap(file => file.cases);
    suites.push({ id, pattern, files: [...new Set(cases.map(item => item.file))], cases });
  }
  if (options.suiteMode === 'directories') suites.push(...await collectDirectorySuites(root, config.testDir, new Set(Object.keys(options.suites)), new Set(suites.flatMap(suite => suite.files))));
  return { suites, scenarios, mocks, scannerVersion: 'vitest-collection-v1', fliwrightVersion: '0.1.1' };
}

/** Root-level test files form a single suite; nested files group under their first directory. */
const rootSuiteId = 'default';
const testExtensions = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}';

/**
 * Derive suites from the first-level directories under the configured test directory.
 * Explicit suites keep their files, so a hand-written glob can claim a cross-directory set.
 */
async function collectDirectorySuites(root: string, testDir: string, explicitIds: Set<string>, claimed: Set<string>) {
  const directory = testDir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!directory || directory === '.' || isAbsolute(directory) || directory.split('/').includes('..')) throw new Error('Test directory escapes project');
  const files = await collectTestCases({ cwd: root, patterns: [`${directory}/**/*.test.${testExtensions}`] });
  const failed = files.find(file => file.errors.length);
  if (failed) throw new Error('Test module collection failed', { cause: new Error(failed.errors.join('\n')) });
  const groups = new Map<string, { files: Set<string>; cases: CatalogCase[] }>();
  for (const file of files) {
    if (claimed.has(file.file) || !file.cases.length) continue;
    if (!file.file.startsWith(`${directory}/`)) throw new Error('Collected test file is outside the test directory');
    const segments = file.file.slice(directory.length + 1).split('/');
    const id = segments.length > 1 ? segments[0]! : rootSuiteId;
    if (segments.length > 1 && id === rootSuiteId) throw new Error(`Suite id "${rootSuiteId}" is reserved for root-level tests`);
    const group = groups.get(id) ?? { files: new Set<string>(), cases: [] };
    group.files.add(file.file);
    group.cases.push(...file.cases);
    groups.set(id, group);
  }
  const suites = [];
  for (const [id, group] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
    if (explicitIds.has(id)) throw new Error(`Suite id conflict: "${id}" is both configured and derived from a test directory`);
    suites.push({ id, pattern: id === rootSuiteId ? `${directory}/*.test.${testExtensions}` : `${directory}/${id}/**/*.test.${testExtensions}`, files: [...group.files].sort(), cases: group.cases });
  }
  return suites;
}
