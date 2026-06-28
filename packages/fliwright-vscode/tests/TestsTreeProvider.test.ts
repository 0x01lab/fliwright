import { describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { TestsTreeProvider } from '../src/views/TestsTreeProvider.js';
import type { TestStatusStore } from '../src/testing/TestStatusStore.js';
import { createWorkspace, writeText } from './helpers/workspace.js';

describe('TestsTreeProvider', () => {
  it('renders file -> describe -> test tree and applies statuses from the store', async () => {
    const ws = await createWorkspace();
    const relPath = 'tests/a.test.ts';
    await writeText(ws, relPath, `
      import { describe, test } from 'vitest';
      describe('suite', () => {
        test('case A', () => {});
        test('case B', () => {});
      });
    `);
    const fileUri = vscode.Uri.file(path.join(ws, relPath));

    const discovery = {
      discover: vi.fn().mockResolvedValue([{ kind: 'testFile', uri: fileUri, label: 'a.test.ts' }]),
    } as any;
    const store = {
      loadIndex: vi.fn().mockResolvedValue(new Map([
        ['tests/a.test.ts::suite/case A', { runId: 'r1', status: 'passed' as const, ranAt: 1, durationMs: 12 }],
      ])),
      loadAssertions: vi.fn().mockResolvedValue([]),
    } as unknown as TestStatusStore;

    const provider = new TestsTreeProvider(discovery as any, store);

    const files = await provider.getChildren();
    expect(files).toHaveLength(1);
    expect(files[0]!.kind).toBe('testFile');

    const groups = await provider.getChildren(files[0]!);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe('testGroup');
    const group = groups[0]!;

    const cases = await provider.getChildren(group);
    expect(cases.map((c) => c.kind === 'testCase' ? c.label : '')).toEqual(['case A', 'case B']);
    expect((cases[0] as any).status).toBe('passed');
    expect((cases[1] as any).status).toBe('unknown');

    // Aggregate up: the group should reflect passed+unknown => passed (aggregateStatus).
    expect((group as any).status).toBe('passed');
    // File status aggregates top-level children.
    expect((files[0] as any).status).toBe('passed');

    const itemA = provider.getTreeItem(cases[0]!);
    expect(itemA.iconPath).toBeTruthy(); // ThemeIcon('pass')
    expect((itemA.iconPath as any).id).toBe('pass');
    expect(itemA.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    expect(itemA.command).toMatchObject({
      command: 'vscode.open',
      title: 'Open Test File',
      arguments: [fileUri],
    });
    await expect(provider.getChildren(cases[0]!)).resolves.toEqual([]);
  });

  it('empty workspace shows empty node', async () => {
    await createWorkspace(); // no test files
    const discovery = { discover: vi.fn().mockResolvedValue([]) } as any;
    const store = { loadIndex: vi.fn().mockResolvedValue(new Map()), loadAssertions: vi.fn().mockResolvedValue([]) } as unknown as TestStatusStore;
    const provider = new TestsTreeProvider(discovery as any, store);
    const roots = await provider.getChildren();
    expect(roots[0]!.kind).toBe('empty');
  });

  it('marks a running test file and its cases with spinning status', async () => {
    const ws = await createWorkspace();
    const relPath = 'tests/running.test.ts';
    await writeText(ws, relPath, `
      import { test } from 'vitest';
      test('case A', () => {});
    `);
    const fileUri = vscode.Uri.file(path.join(ws, relPath));

    const discovery = {
      discover: vi.fn().mockResolvedValue([{ kind: 'testFile', uri: fileUri, label: 'running.test.ts' }]),
    } as any;
    const store = { loadIndex: vi.fn().mockResolvedValue(new Map()), loadAssertions: vi.fn().mockResolvedValue([]) } as unknown as TestStatusStore;
    const provider = new TestsTreeProvider(discovery as any, store);

    const files = await provider.getChildren();
    provider.setRunning({ relPath });

    const fileItem = provider.getTreeItem(files[0]!);
    expect((fileItem.iconPath as any).id).toBe('loading~spin');
    expect(fileItem.description).toBe('running');
    expect(fileItem.contextValue).toBe('testFileRunning');

    const cases = await provider.getChildren(files[0]!);
    const caseItem = provider.getTreeItem(cases[0]!);
    expect((caseItem.iconPath as any).id).toBe('loading~spin');
    expect(caseItem.description).toBe('running');
    expect(caseItem.contextValue).toBe('testCaseRunning');
  });

  it('marks only the selected test case as running when a case is launched', async () => {
    const ws = await createWorkspace();
    const relPath = 'tests/single.test.ts';
    await writeText(ws, relPath, `
      import { test } from 'vitest';
      test('case A', () => {});
      test('case B', () => {});
    `);
    const fileUri = vscode.Uri.file(path.join(ws, relPath));

    const discovery = {
      discover: vi.fn().mockResolvedValue([{ kind: 'testFile', uri: fileUri, label: 'single.test.ts' }]),
    } as any;
    const store = {
      loadIndex: vi.fn().mockResolvedValue(new Map([
        ['tests/single.test.ts::case B', { runId: 'r1', status: 'passed' as const, ranAt: 1, durationMs: 9 }],
      ])),
      loadAssertions: vi.fn().mockResolvedValue([]),
    } as unknown as TestStatusStore;
    const provider = new TestsTreeProvider(discovery as any, store);

    const files = await provider.getChildren();
    provider.setRunning({ relPath, testId: 'tests/single.test.ts::case A' });

    const cases = await provider.getChildren(files[0]!);
    expect((cases[0] as any).status).toBe('running');
    expect((cases[1] as any).status).toBe('passed');
  });



  it('expands a completed test case into assertion status nodes from the run timeline', async () => {
    const ws = await createWorkspace();
    const relPath = 'tests/assertions.test.ts';
    await writeText(ws, relPath, `
      import { test } from 'vitest';
      test('case A', () => {});
    `);
    const fileUri = vscode.Uri.file(path.join(ws, relPath));

    const discovery = {
      discover: vi.fn().mockResolvedValue([{ kind: 'testFile', uri: fileUri, label: 'assertions.test.ts' }]),
    } as any;
    const store = {
      loadIndex: vi.fn().mockResolvedValue(new Map([
        ['tests/assertions.test.ts::case A', { runId: 'r1', status: 'failed' as const, ranAt: 1, durationMs: 22 }],
      ])),
      loadAssertions: vi.fn().mockResolvedValue([
        { id: 'a1', label: '首页头像按钮可见', status: 'passed' as const, assertionIndex: 0, durationMs: 12 },
        { id: 'a2', label: '年度审核提醒操作按钮可见', status: 'failed' as const, assertionIndex: 1, error: 'not visible' },
      ]),
    } as unknown as TestStatusStore;
    const provider = new TestsTreeProvider(discovery as any, store);

    const files = await provider.getChildren();
    const cases = await provider.getChildren(files[0]!);
    const caseItem = provider.getTreeItem(cases[0]!);
    expect(caseItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);

    const assertions = await provider.getChildren(cases[0]!);
    expect(assertions.map((node) => node.kind === 'testAssertion' ? node.label : '')).toEqual([
      '首页头像按钮可见',
      '年度审核提醒操作按钮可见',
    ]);

    const firstItem = provider.getTreeItem(assertions[0]!);
    const secondItem = provider.getTreeItem(assertions[1]!);
    expect((firstItem.iconPath as any).id).toBe('pass');
    expect((secondItem.iconPath as any).id).toBe('error');
    expect(secondItem.tooltip).toBe('not visible');
  });

  it('does NOT parse any file source until a file row is expanded (lazy, with per-file cache)', async () => {
    const ws = await createWorkspace();
    const relPath = 'tests/lazy.test.ts';
    await writeText(ws, relPath, `test('never expanded', () => {})`);
    const fileUri = vscode.Uri.file(path.join(ws, relPath));

    const builder = await import('../src/testing/TestTreeBuilder.js');
    const spy = vi.spyOn(builder, 'buildTestTree');

    const discovery = {
      discover: vi.fn().mockResolvedValue([{ kind: 'testFile', uri: fileUri, label: 'lazy.test.ts' }]),
    } as any;
    const store = { loadIndex: vi.fn().mockResolvedValue(new Map()), loadAssertions: vi.fn().mockResolvedValue([]) } as unknown as TestStatusStore;
    const provider = new TestsTreeProvider(discovery as any, store);

    const files = await provider.getChildren();        // root expansion
    expect(spy).not.toHaveBeenCalled();                // no parse yet
    expect(files[0]!.kind).toBe('testFile');

    await provider.getChildren(files[0]!);             // NOW expand the file
    expect(spy).toHaveBeenCalledTimes(1);              // parsed once

    await provider.getChildren(files[0]!);             // expand again
    expect(spy).toHaveBeenCalledTimes(1);              // served from cache, no re-parse
    spy.mockRestore();
  });

  it('invalidateFile clears the cache for one file and re-fires its subtree', async () => {
    const ws = await createWorkspace();
    const relPath = 'tests/inv.test.ts';
    await writeText(ws, relPath, `test('a', () => {})`);
    const fileUri = vscode.Uri.file(path.join(ws, relPath));

    const builder = await import('../src/testing/TestTreeBuilder.js');
    const spy = vi.spyOn(builder, 'buildTestTree');

    const discovery = {
      discover: vi.fn().mockResolvedValue([{ kind: 'testFile', uri: fileUri, label: 'inv.test.ts' }]),
    } as any;
    const store = { loadIndex: vi.fn().mockResolvedValue(new Map()), loadAssertions: vi.fn().mockResolvedValue([]) } as unknown as TestStatusStore;
    const provider = new TestsTreeProvider(discovery as any, store);

    const files = await provider.getChildren();
    const file = files[0]!;
    await provider.getChildren(file);     // parse #1
    expect(spy).toHaveBeenCalledTimes(1);

    provider.invalidateFile(fileUri);     // wipe cache for this file

    await provider.getChildren(file);     // parse #2 — cache was invalidated
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
