import { afterEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { watchTestCollection } from '../src/testing/TestCollectionWatcher.js';
import { createWorkspace } from './helpers/workspace.js';

afterEach(() => vi.useRealTimers());

it('refreshes collections after imported data/config changes and test creation/deletion, with debouncing and disposal', async () => {
  const root = await createWorkspace();
  vi.useFakeTimers();
  const listeners: Array<(uri: vscode.Uri) => void> = [];
  const watcher = { dispose: vi.fn(), onDidChange: (fn: any) => { listeners[0] = fn; },
    onDidCreate: (fn: any) => { listeners[1] = fn; }, onDidDelete: (fn: any) => { listeners[2] = fn; } };
  const watch = vi.spyOn(vscode.workspace, 'createFileSystemWatcher').mockReturnValue(watcher as any);
  const refresh = vi.fn();
  const subscription = watchTestCollection({ refresh });
  for (const [index, file] of ['fixtures/rows.ts', 'vitest.config.ts', 'tests/new.test.ts'].entries()) {
    listeners[index](vscode.Uri.file(`${root}/${file}`));
  }
  await vi.advanceTimersByTimeAsync(300);
  expect(refresh).toHaveBeenCalledTimes(1);
  listeners[0](vscode.Uri.file(`${root}/node_modules/library/index.js`));
  await vi.advanceTimersByTimeAsync(300);
  expect(refresh).toHaveBeenCalledTimes(1);
  listeners[0](vscode.Uri.file(`${root}/fliwright.config.ts`));
  subscription.dispose();
  await vi.advanceTimersByTimeAsync(300);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(watcher.dispose).toHaveBeenCalledOnce();
  watch.mockRestore();
});

it('does not invalidate collected tests when Flutter build output or run artifacts change', async () => {
  const root = await createWorkspace();
  vi.useFakeTimers();
  let changed!: (uri: vscode.Uri) => void;
  const watcher = { dispose: vi.fn(), onDidChange: (fn: any) => { changed = fn; },
    onDidCreate() {}, onDidDelete() {} };
  const watch = vi.spyOn(vscode.workspace, 'createFileSystemWatcher').mockReturnValue(watcher as any);
  const refresh = vi.fn();
  const subscription = watchTestCollection({ refresh });
  for (const file of ['build/app/assets/AssetManifest.json', '.dart_tool/package_config.json',
    '.fliwright/runs/attempt/timeline.json', '.fliwright/cache/project.json',
    'dist/test.js', 'coverage/coverage-final.json']) {
    changed(vscode.Uri.file(`${root}/${file}`));
    await vi.advanceTimersByTimeAsync(350);
  }
  expect(refresh).not.toHaveBeenCalled();
  subscription.dispose();
  watch.mockRestore();
});
