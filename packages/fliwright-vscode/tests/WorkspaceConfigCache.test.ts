import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { writeFliwrightConfigSnapshot } from '@fliwright/core';
import { loadWorkspaceConfig } from '../src/config.js';
import { ensureProjectRunsRoot } from '../src/testing/ProjectRunsRoot.js';
import { watchTestCollection } from '../src/testing/TestCollectionWatcher.js';
import { createWorkspace, writeText } from './helpers/workspace.js';

let root: string;
let home: string;
const subscriptions: vscode.Disposable[] = [];
beforeEach(async () => {
  root = await createWorkspace();
  home = await mkdtemp(join(tmpdir(), 'fliwright-config-cache-home-'));
  await writeText(root, 'paths.ts', "export const tests = 'qa/checks';");
  await writeText(root, 'fliwright.config.ts', `
    import { appendFileSync } from 'node:fs';
    import { tests } from './paths.js';
    appendFileSync(${JSON.stringify(join(root, 'imports.log'))}, 'loaded\\n');
    export default { paths: { tests } };
  `);
});
afterEach(async () => {
  for (const subscription of subscriptions.splice(0)) subscription.dispose();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

it('shares one project import across activation storage setup and concurrent view discovery', async () => {
  const uri = vscode.Uri.file(root);
  await ensureProjectRunsRoot(uri, { homeDir: home });
  const configs = await Promise.all(Array.from({ length: 3 }, () => loadWorkspaceConfig(uri)));
  expect(configs.map(config => config.testGlob)).toEqual(Array(3).fill('qa/checks/**/*.test.ts'));
  expect(await readFile(join(root, 'imports.log'), 'utf8')).toBe('loaded\n');
});

it('re-reads environment snapshots and editor overrides while reusing the imported project', async () => {
  const uri = vscode.Uri.file(root);
  await loadWorkspaceConfig(uri);
  const snapshot = writeFliwrightConfigSnapshot({ paths: { tests: 'env/first' } }, { cacheRoot: home });
  vi.stubEnv('FLIWRIGHT_CONFIG_PATH', snapshot);
  expect((await loadWorkspaceConfig(uri)).testGlob).toBe('env/first/**/*.test.ts');
  const contents = JSON.parse(await readFile(snapshot, 'utf8'));
  contents.paths.tests = 'env/second';
  await writeFile(snapshot, JSON.stringify(contents));
  expect((await loadWorkspaceConfig(uri)).testGlob).toBe('env/second/**/*.test.ts');
  vscode.__setConfiguration({ testGlob: 'editor/**/*.spec.ts' });
  expect((await loadWorkspaceConfig(uri)).testGlob).toBe('editor/**/*.spec.ts');
  expect(await readFile(join(root, 'imports.log'), 'utf8')).toBe('loaded\n');
});

it('invalidates before the debounce when an imported config module changes', async () => {
  let changed!: (uri: vscode.Uri) => void;
  vi.spyOn(vscode.workspace, 'createFileSystemWatcher').mockReturnValue({
    onDidChange(fn: typeof changed) { changed = fn; }, onDidCreate() {}, onDidDelete() {}, dispose() {},
  } as never);
  subscriptions.push(watchTestCollection({ refresh() {} }));
  const uri = vscode.Uri.file(root);
  expect((await loadWorkspaceConfig(uri)).testGlob).toBe('qa/checks/**/*.test.ts');
  await writeText(root, 'paths.ts', "export const tests = 'qa/updated';");
  changed(vscode.Uri.file(join(root, 'paths.ts')));
  expect((await loadWorkspaceConfig(uri)).testGlob).toBe('qa/updated/**/*.test.ts');
  expect(await readFile(join(root, 'imports.log'), 'utf8')).toBe('loaded\nloaded\n');
});

it('retries a failed project import instead of caching the rejection', async () => {
  await writeText(root, 'paths.ts', "throw new Error('invalid project config');");
  await expect(loadWorkspaceConfig(vscode.Uri.file(root))).rejects.toThrow('invalid project config');
  await writeText(root, 'paths.ts', "export const tests = 'qa/repaired';");
  expect((await loadWorkspaceConfig(vscode.Uri.file(root))).testGlob).toBe('qa/repaired/**/*.test.ts');
});

it('keeps a valid project import when an environment snapshot temporarily becomes invalid', async () => {
  const uri = vscode.Uri.file(root);
  await loadWorkspaceConfig(uri);
  const snapshot = join(home, 'override.json');
  await writeFile(snapshot, '{');
  vi.stubEnv('FLIWRIGHT_CONFIG_PATH', snapshot);
  await expect(loadWorkspaceConfig(uri)).rejects.toThrow();
  await writeFile(snapshot, JSON.stringify({ paths: { tests: 'repaired' } }));
  expect((await loadWorkspaceConfig(uri)).testGlob).toBe('repaired/**/*.test.ts');
  expect(await readFile(join(root, 'imports.log'), 'utf8')).toBe('loaded\n');
});
