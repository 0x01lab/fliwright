import { writeFliwrightConfigSnapshot } from '@fliwright/core';
import * as path from 'node:path';
import { access, readFile, rm } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Uri, workspace, __setConfiguration } from 'vscode';
import { TestDiscoveryService } from '../src/runner/TestDiscoveryService.js';
import { ScriptDiscoveryService } from '../src/scripts/ScriptDiscoveryService.js';
import { RecordingPersistenceService } from '../src/recording/RecordingPersistenceService.js';
import { FlowFileService } from '../src/flows/FlowFileService.js';
import { FlowsTreeProvider } from '../src/views/FlowsTreeProvider.js';
import { createWorkspace, writeText } from './helpers/workspace.js';

let root: string;
beforeEach(async () => {
  root = await createWorkspace();
  await writeText(root, 'fliwright.config.ts', `export default { paths: {
    tests: 'qa/checks', scripts: 'qa/tasks', recordings: 'qa/captures', flows: 'qa/flows'
  } };`);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it('discovers tests and scripts from shared paths and re-reads environment overrides', async () => {
  const find = vi.spyOn(workspace, 'findFiles').mockResolvedValue([]);
  const tests = new TestDiscoveryService();
  const scripts = new ScriptDiscoveryService();
  await tests.discover(Uri.file(root));
  await scripts.discover(Uri.file(root));
  expect(find.mock.calls.map(([pattern]) => pattern.pattern)).toEqual([
    'qa/checks/**/*.test.ts', 'qa/tasks/**/*.script.ts', 'qa/tasks/**/*.js',
    'qa/tasks/**/*.mjs', 'qa/tasks/**/*.cjs',
  ]);
  vi.stubEnv('FLIWRIGHT_CONFIG_PATH', writeFliwrightConfigSnapshot({ paths: { tests: 'env/checks' } }));
  await tests.discover(Uri.file(root));
  expect(find.mock.calls.at(-1)![0].pattern).toBe('env/checks/**/*.test.ts');
});

it('preserves explicitly configured editor globs', async () => {
  __setConfiguration({ testGlob: 'custom/**/*.spec.ts', scriptGlob: 'tools/*.{ts,mjs}' });
  const find = vi.spyOn(workspace, 'findFiles').mockResolvedValue([]);
  await new TestDiscoveryService().discover(Uri.file(root));
  await new ScriptDiscoveryService().discover(Uri.file(root));
  expect(find.mock.calls.map(([pattern]) => pattern.pattern)).toEqual([
    'custom/**/*.spec.ts', 'tools/*.ts', 'tools/*.mjs',
  ]);
});

it('discovers test files when composed scenarios select shared and Item mock sources', async () => {
  await writeText(root, 'fliwright.config.ts', `export default { scenarios: {
    base: { name: 'base', layers: [{ kind: 'mocks', sources: [
      { name: 'shared', directory: '.fliwright/mocks', files: ['api/user.json'] },
    ], rules: [{ source: 'shared', method: 'POST', endpoint: '/user', rule: 'ready' }] }] },
    review: { name: 'review', extends: ['base'], layers: [{ kind: 'mocks', sources: [
      { name: 'item', directory: '.fliwright/test-plans/437/mocks', files: ['api/user.json'] },
    ], rules: [{ source: 'item', method: 'POST', endpoint: '/user', rule: 'review', replace: true }] }] },
  } };`);
  const uri = Uri.file(path.join(root, '.fliwright/tests/review.test.ts'));
  const find = vi.spyOn(workspace, 'findFiles').mockResolvedValue([uri]);

  await expect(new TestDiscoveryService().discover(Uri.file(root))).resolves.toEqual([
    { kind: 'testFile', uri, label: 'review.test.ts' },
  ]);
  expect(find.mock.calls[0][0].pattern).toBe('.fliwright/tests/**/*.test.ts');
});

it('saves and lists recordings and flows under the same configured directories', async () => {
  const persistence = new RecordingPersistenceService();
  const recording = await persistence.save(Uri.file(root), {
    status: 'preview', rawEventCount: 0, operationCount: 0, frames: [],
  }, 'capture');
  expect(recording.fsPath).toBe(path.join(root, 'qa/captures/capture'));
  expect((await persistence.list(Uri.file(root))).map((item) => item.recordingDir.fsPath)).toEqual([recording.fsPath]);
  const flows = new FlowFileService();
  const created = await flows.create(Uri.file(root), { title: 'Checkout' });
  expect(created.uri.fsPath).toBe(path.join(root, 'qa/flows/checkout.flow.json'));
  expect((await flows.create(Uri.file(root), { title: 'Checkout' })).flow.id).toBe('checkout-2');
  const saved = await persistence.saveProjectFlow(Uri.file(root), { ...created.flow, id: 'saved' });
  expect(saved.fsPath).toBe(path.join(root, 'qa/flows/saved.flow.json'));
  const tree = await new FlowsTreeProvider().getChildren();
  expect(tree.filter((item) => item.kind === 'flowFile')).toHaveLength(3);
});

it('resolves absolute storage paths without nesting them under the workspace', async () => {
  const recordings = path.join(root, 'absolute', 'captures');
  vi.stubEnv('FLIWRIGHT_CONFIG_PATH', writeFliwrightConfigSnapshot({ paths: { recordings } }));
  const persistence = new RecordingPersistenceService();
  const saved = await persistence.save(Uri.file(root), {
    status: 'preview', rawEventCount: 0, operationCount: 0, frames: [],
  }, 'capture');
  expect(saved.fsPath).toBe(path.join(recordings, 'capture'));
  expect(await persistence.list(Uri.file(root))).toHaveLength(1);
});

it('keeps recording evidence local and shares a flow without machine-specific target paths', async () => {
  await writeText(root, 'fliwright.config.ts', 'export default {};');
  const local = await createWorkspace();
  vi.stubEnv('FLIWRIGHT_RUNTIME_ROOT', local);
  const persistence = new RecordingPersistenceService();
  const flow = { version: 1 as const, id: 'shared', createdAt: 'now', updatedAt: 'now',
    source: { kind: 'recording' as const, targetFile: path.join(root, '.fliwright/tests/shared.test.ts') }, nodes: [], edges: [] };
  const recording = await persistence.save(Uri.file(root), {
    status: 'preview', rawEventCount: 0, operationCount: 0, frames: [], flow,
  }, 'capture');
  const flowFile = await persistence.saveProjectFlow(Uri.file(root), flow);
  expect(recording.fsPath).toBe(path.join(local, 'recordings/capture'));
  expect((await persistence.list(Uri.file(root))).map(item => item.recordingDir.fsPath)).toEqual([recording.fsPath]);
  expect(flowFile.fsPath).toBe(path.join(root, '.fliwright/flows/shared.flow.json'));
  const shared = JSON.parse(await readFile(flowFile.fsPath, 'utf8'));
  expect(shared.source.targetFile).toBe('.fliwright/tests/shared.test.ts');
  await expect(access(path.join(root, '.fliwright/recordings'))).rejects.toThrow();
  await rm(local, { recursive: true, force: true });
});
