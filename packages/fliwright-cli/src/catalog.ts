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
}
export interface CatalogSelection extends CatalogCase {}
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
      cases.push({ caseId: catalogCaseId(file, titlePath, duplicateIndex), file, titlePath, duplicateIndex, test });
    }
  }
  return cases;
}
/** Collection only: imports trusted project modules but never starts an app or runs hooks/tests. */
export async function collectCatalog(options: { cwd: string; suites: Record<string, string> }) {
  const root = await realpath(options.cwd);
  const resolver = createJiti(resolve(root, 'package.json'));
  const url = resolver.esmResolve('vitest/node', { try: true }) ?? import.meta.resolve('vitest/node');
  const { createVitest } = await import(url);
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
    if (isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..')) throw new Error('Suite path escapes project');
    const context = await createVitest({ root, watch: false, include: [pattern], reporters: [], maxWorkers: 1,
      configLoader: 'runner', cache: false, fsModuleCache: false });
    try {
      const result = await context.collect([], { staticParse: false });
      if (result.unhandledErrors.length) throw new Error('Unhandled collection error');
      const cases = collectedCases(result.testModules, root).map(({ test: _test, ...item }) => item);
      for (const item of cases) {
        const path = relative(root, await realpath(resolve(root, item.file)));
        if (path.startsWith('../') || isAbsolute(path)) throw new Error('Test symlink escapes project');
      }
      if (cases.length > 10000) throw new Error('Catalog case limit exceeded');
      suites.push({ id, pattern, files: [...new Set(cases.map(item => item.file))], cases });
    } finally { await context.close(); }
  }
  return { suites, scenarios, mocks, scannerVersion: 'vitest-collection-v1', fliwrightVersion: '0.1.0' };
}
