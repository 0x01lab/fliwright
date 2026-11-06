import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { parseVitestJson } from '../src/runner/VitestRunner.js';
import { RunArtifactStore } from '../src/testing/RunArtifactStore.js';
import { TestStatusStore } from '../src/testing/TestStatusStore.js';
import { TestsTreeProvider } from '../src/views/TestsTreeProvider.js';
import { createWorkspace, writeText } from './helpers/workspace.js';

it.each(['pending', 'skipped', 'todo'].flatMap(status =>
  ['artifact', 'status'].map(writer => ({ status, writer })),
))('retains sibling results after a $writer store run reports them as $status', async ({ status, writer }) => {
  const workspace = await createWorkspace();
  const root = vscode.Uri.file(workspace);
  const relPath = 'tests/settings.test.ts';
  const fileUri = vscode.Uri.file(join(workspace, relPath));
  const artifacts = new RunArtifactStore({ runsRoot: join(workspace, 'runs') });
  const store = new TestStatusStore(await artifacts.ensureRunsDir(root));
  const provider = new TestsTreeProvider({ discover: vi.fn().mockResolvedValue([
    { kind: 'testFile', uri: fileUri, label: 'settings.test.ts' },
  ]) } as any, store, { collect: vi.fn().mockResolvedValue({ nodes: [
    { kind: 'test', title: 'locale en' },
    { kind: 'test', title: 'locale zh-Hans' },
    { kind: 'test', title: 'locale zh-Hant' },
    { kind: 'test', title: 'never run' },
  ] }) });
  const report = (assertionResults: unknown[]) => parseVitestJson(JSON.stringify({
    success: true, testResults: [{ name: fileUri.fsPath, assertionResults }],
  }));
  const record = (runId: string, ranAt: number, result: ReturnType<typeof report>) => writer === 'artifact'
    ? artifacts.recordTestRun(root, result, relPath, { baseRunId: runId, ranAt })
    : store.recordRun(runId, ranAt, root, result, relPath);
  try {
    await writeText(workspace, relPath, '');
    await record('previous', 1, report([
      { title: 'locale en', status: 'failed', duration: 2 },
      { title: 'locale zh-Hans', status: 'passed', duration: 9 },
      { title: 'locale zh-Hant', status: 'failed', duration: 4, failureMessages: ['old failure'] },
    ]));
    await writeText(workspace, 'runs/previous-locale-zh-Hans/timeline.json', JSON.stringify({ nodes: [
      { id: 'visible', kind: 'assertion', title: 'settings visible', status: 'passed' },
    ] }));
    const previous = await store.loadIndex();
    const [file] = await provider.getChildren();
    await provider.getChildren(file);
    provider.setRunning({ relPath, testId: `${relPath}::locale en` });
    expect(await provider.getChildren(file)).toEqual([
      expect.objectContaining({ status: 'running' }),
      expect.objectContaining({ status: 'passed' }),
      expect.objectContaining({ status: 'failed' }),
      expect.objectContaining({ status: 'unknown' }),
    ]);

    await record('focused', 2, report([
      { title: 'locale en', status: 'passed', duration: 7 },
      { title: 'locale zh-Hans', status },
      { title: 'locale zh-Hant', status },
      { title: 'never run', status },
    ]));
    provider.setRunning();
    await provider.refreshStatuses();

    const cases = await provider.getChildren(file);
    expect(cases).toEqual([
      expect.objectContaining({ status: 'passed', durationMs: 7 }),
      expect.objectContaining({ status: 'passed', durationMs: 9 }),
      expect.objectContaining({ status: 'failed', durationMs: 4 }),
      expect.objectContaining({ status: 'unknown' }),
    ]);
    const index = await new TestStatusStore(artifacts.runsDir(root)).loadIndex();
    for (const title of ['locale zh-Hans', 'locale zh-Hant']) {
      expect(index.get(`${relPath}::${title}`)).toEqual(previous.get(`${relPath}::${title}`));
    }
    expect(index.has(`${relPath}::never run`)).toBe(false);
    expect((await provider.getTreeItem(cases[1])).iconPath).toMatchObject({ id: 'pass' });
    expect(await provider.getChildren(cases[1])).toEqual([
      expect.objectContaining({ label: 'settings visible', status: 'passed' }),
    ]);
  } finally {
    provider.dispose();
    await rm(workspace, { recursive: true, force: true });
  }
});
