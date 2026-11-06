import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { TestsTreeProvider } from '../src/views/TestsTreeProvider.js';
import type { TestStatusStore } from '../src/testing/TestStatusStore.js';
import { createWorkspace, writeText } from './helpers/workspace.js';


const { collect } = vi.hoisted(() => ({ collect: vi.fn() }));
vi.mock('../src/testing/TestCatalogCollector.js', () => ({
  TestCatalogCollector: class { collect = collect; },
}));
beforeEach(() => {
  vscode.workspace.isTrusted = true;
  collect.mockReset().mockImplementation(async (_root: string, file: string) => {
    const names: Record<string, string[]> = {
      'a.test.ts': ['case A', 'case B'], 'running.test.ts': ['case A'],
      'single.test.ts': ['case A', 'case B'], 'assertions.test.ts': ['case A'],
      'lazy.test.ts': ['never expanded'], 'inv.test.ts': ['a'],
      'first.test.ts': ['first'], 'second.test.ts': ['second'],
    };
    if (file.endsWith('refresh.test.ts')) return { nodes: [{ kind: 'group', title: 'balance [USD]', children: [
      { kind: 'test', title: 'APP-RESUME-007 / home (REST)' },
      { kind: 'test', title: 'APP-RESUME-007 / assets (REST)' },
    ] }] };
    const children = (names[path.basename(file)] ?? []).map(title => ({ kind: 'test', title }));
    return { nodes: file.endsWith('/a.test.ts') ? [{ kind: 'group', title: 'suite', children }] : children };
  });
});

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

    const itemA = await provider.getTreeItem(cases[0]!);
    expect(itemA.iconPath).toBeTruthy(); // ThemeIcon('pass')
    expect((itemA.iconPath as any).id).toBe('pass');
    expect(itemA.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
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

    const fileItem = await provider.getTreeItem(files[0]!);
    expect((fileItem.iconPath as any).id).toBe('loading~spin');
    expect(fileItem.description).toBe('running');
    expect(fileItem.contextValue).toBe('testFileRunning');

    const cases = await provider.getChildren(files[0]!);
    const caseItem = await provider.getTreeItem(cases[0]!);
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
    const caseItem = await provider.getTreeItem(cases[0]!);
    expect(caseItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);

    const assertions = await provider.getChildren(cases[0]!);
    expect(assertions.map((node) => node.kind === 'testAssertion' ? node.label : '')).toEqual([
      '首页头像按钮可见',
      '年度审核提醒操作按钮可见',
    ]);

    const firstItem = await provider.getTreeItem(assertions[0]!);
    const secondItem = await provider.getTreeItem(assertions[1]!);
    expect((firstItem.iconPath as any).id).toBe('pass');
    expect((secondItem.iconPath as any).id).toBe('error');
    expect(secondItem.tooltip).toBe('not visible');
  });

  it('does NOT collect tests until a file row is expanded (lazy, with per-file cache)', async () => {
    const ws = await createWorkspace();
    const relPath = 'tests/lazy.test.ts';
    await writeText(ws, relPath, `test('never expanded', () => {})`);
    const fileUri = vscode.Uri.file(path.join(ws, relPath));

    const spy = collect;

    const discovery = {
      discover: vi.fn().mockResolvedValue([{ kind: 'testFile', uri: fileUri, label: 'lazy.test.ts' }]),
    } as any;
    const store = { loadIndex: vi.fn().mockResolvedValue(new Map()), loadAssertions: vi.fn().mockResolvedValue([]) } as unknown as TestStatusStore;
    const provider = new TestsTreeProvider(discovery as any, store);

    const files = await provider.getChildren();        // root expansion
    expect(spy).not.toHaveBeenCalled();                // no collection yet
    expect(files[0]!.kind).toBe('testFile');

    await provider.getChildren(files[0]!);             // NOW expand the file
    expect(spy).toHaveBeenCalledTimes(1);              // collected once

    await provider.getChildren(files[0]!);             // expand again
    expect(spy).toHaveBeenCalledTimes(1);              // served from cache, no recollection

  });

  it('invalidateFile clears the cache for one file and re-fires its subtree', async () => {
    const ws = await createWorkspace();
    const relPath = 'tests/inv.test.ts';
    await writeText(ws, relPath, `test('a', () => {})`);
    const fileUri = vscode.Uri.file(path.join(ws, relPath));

    const spy = collect;

    const discovery = {
      discover: vi.fn().mockResolvedValue([{ kind: 'testFile', uri: fileUri, label: 'inv.test.ts' }]),
    } as any;
    const store = { loadIndex: vi.fn().mockResolvedValue(new Map()), loadAssertions: vi.fn().mockResolvedValue([]) } as unknown as TestStatusStore;
    const provider = new TestsTreeProvider(discovery as any, store);

    const files = await provider.getChildren();
    const file = files[0]!;
    await provider.getChildren(file);     // collection #1
    expect(spy).toHaveBeenCalledTimes(1);

    provider.invalidateFile(fileUri);     // wipe cache for this file

    await provider.getChildren(file);     // collection #2 — cache was invalidated
    expect(spy).toHaveBeenCalledTimes(2);

  });

  it('refreshFile refreshes one file without rediscovering or clearing other file caches', async () => {
    const ws = await createWorkspace();
    const firstRelPath = 'tests/first.test.ts';
    const secondRelPath = 'tests/second.test.ts';
    await writeText(ws, firstRelPath, `test('first', () => {})`);
    await writeText(ws, secondRelPath, `test('second', () => {})`);
    const firstUri = vscode.Uri.file(path.join(ws, firstRelPath));
    const secondUri = vscode.Uri.file(path.join(ws, secondRelPath));

    const spy = collect;

    const discovery = {
      discover: vi.fn().mockResolvedValue([
        { kind: 'testFile', uri: firstUri, label: 'first.test.ts' },
        { kind: 'testFile', uri: secondUri, label: 'second.test.ts' },
      ]),
    } as any;
    const store = {
      loadIndex: vi.fn()
        .mockResolvedValueOnce(new Map())
        .mockResolvedValueOnce(new Map([
          ['tests/first.test.ts::first', { runId: 'r1', status: 'passed' as const, ranAt: 1, durationMs: 10 }],
        ])),
      loadAssertions: vi.fn().mockResolvedValue([]),
    } as unknown as TestStatusStore;
    const provider = new TestsTreeProvider(discovery as any, store);

    const files = await provider.getChildren();
    const first = files[0]!;
    const second = files[1]!;
    await provider.getChildren(first);
    await provider.getChildren(second);
    expect(spy).toHaveBeenCalledTimes(2);

    await provider.refreshFile(firstUri);
    expect(discovery.discover).toHaveBeenCalledTimes(1);
    expect((store.loadIndex as any)).toHaveBeenCalledTimes(2);

    const refreshedFirstCases = await provider.getChildren(first);
    expect(spy).toHaveBeenCalledTimes(3);
    expect((refreshedFirstCases[0] as any).status).toBe('passed');

    await provider.getChildren(second);
    expect(spy).toHaveBeenCalledTimes(3);

  });
});

it('keeps parameterized scenario titles intact when selecting one case to run', async () => {
  const ws = await createWorkspace();
  const relPath = '.fliwright/tests/refresh.test.ts';
  await writeText(ws, relPath, `
    describe('balance [USD]', () => {
      test.scenario('refresh').for(['home', 'assets'])('APP-RESUME-007 / %s (REST)', () => {});
    });
  `);
  const fileUri = vscode.Uri.file(path.join(ws, relPath));
  const discovery = { discover: vi.fn().mockResolvedValue([{ kind: 'testFile', uri: fileUri, label: 'refresh.test.ts' }]) };
  const store = { loadIndex: vi.fn().mockResolvedValue(new Map()), loadAssertions: vi.fn().mockResolvedValue([]) };
  const provider = new TestsTreeProvider(discovery as any, store as unknown as TestStatusStore);
  const [file] = await provider.getChildren();
  const [group] = await provider.getChildren(file);
  const cases = await provider.getChildren(group);
  const selected = cases[0];
  expect(selected.kind).toBe('testCase');
  if (selected.kind !== 'testCase') throw Error('Expected test case');
  const pattern = (selected as typeof selected & { testNamePattern: string }).testNamePattern;
  expect(pattern).toBeTruthy();
  expect(new RegExp(pattern).test('balance [USD] APP-RESUME-007 / home (REST)')).toBe(true);
  expect(new RegExp(pattern).test('balance [USD] APP-RESUME-007 / assets (REST)')).toBe(false);
  expect(new RegExp(pattern).test('balance [USD] APP-RESUME-007 / home (REST) extra')).toBe(false);
});


it('deduplicates simultaneous expands and retries after collection failures', async () => {
  const ws = await createWorkspace();
  const uri = vscode.Uri.file(path.join(ws, 'tests/a.test.ts'));
  const discovery = { discover: vi.fn().mockResolvedValue([{ uri, label: 'a.test.ts' }]) };
  const store = { loadIndex: vi.fn().mockResolvedValue(new Map()) };
  const provider = new TestsTreeProvider(discovery as any, store as any);
  const [file] = await provider.getChildren();
  collect.mockRejectedValueOnce(new Error('Invalid scenario ready'));
  const errors = await Promise.all([provider.getChildren(file), provider.getChildren(file)]);
  expect(collect).toHaveBeenCalledTimes(1);
  expect(errors[0][0]).toMatchObject({ kind: 'empty', label: expect.stringContaining('Invalid scenario ready') });
  const children = await provider.getChildren(file);
  expect(children[0].kind).toBe('testGroup');
  expect(collect).toHaveBeenCalledTimes(2);
});

it('discards and cancels stale in-flight results on invalidation', async () => {
  const ws = await createWorkspace();
  const uri = vscode.Uri.file(path.join(ws, 'tests/a.test.ts'));
  const provider = new TestsTreeProvider({ discover: vi.fn().mockResolvedValue([{ uri, label: 'a.test.ts' }]) } as any,
    { loadIndex: vi.fn().mockResolvedValue(new Map()) } as any);
  const [file] = await provider.getChildren();
  let complete!: (value: unknown) => void;
  collect.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const pending = provider.getChildren(file);
  await Promise.resolve();
  const signal = collect.mock.calls[0][2] as AbortSignal;
  provider.invalidateFile(uri);
  expect(signal.aborted).toBe(true);
  complete({ nodes: [{ kind: 'test', title: 'stale' }] });
  const children = await pending;
  expect(children[0].kind).toBe('testGroup');
  expect(collect).toHaveBeenCalledTimes(2);
});

it('does not discover or execute project code in an untrusted workspace', async () => {
  await createWorkspace();
  vscode.workspace.isTrusted = false;
  const discovery = { discover: vi.fn() };
  const store = { loadIndex: vi.fn() };
  const provider = new TestsTreeProvider(discovery as any, store as any);
  const nodes = await provider.getChildren();
  expect(nodes).toEqual([{ kind: 'empty', label: expect.stringMatching(/trust/i) }]);
  expect(discovery.discover).not.toHaveBeenCalled();
  expect(collect).not.toHaveBeenCalled();
});


it.each(['passed', 'failed', 'skipped', 'running'] as const)('hides the expand arrow for %s cases with no assertion records', async (status) => {
  const ws = await createWorkspace();
  await writeText(ws, 'tests/a.test.ts', '');
  const fileUri = vscode.Uri.file(path.join(ws, 'tests/a.test.ts'));
  const store = {
    loadIndex: vi.fn().mockResolvedValue(new Map([['tests/a.test.ts::case A', { status, runId: 'run', ranAt: 1 }]])),
    loadAssertions: vi.fn().mockResolvedValue([]),
  };
  collect.mockResolvedValue({ nodes: [{ kind: 'test', title: 'case A' }] });
  const provider = new TestsTreeProvider({ discover: vi.fn().mockResolvedValue([{ uri: fileUri, label: 'a.test.ts' }]) } as any, store as any);
  const [file] = await provider.getChildren();
  const [testCase] = await provider.getChildren(file);
  expect(testCase).toMatchObject({ kind: 'testCase', status });
  expect((await provider.getTreeItem(testCase)).collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
  expect(await provider.getChildren(testCase)).toEqual([]);
  // Rendering and expansion must use the same assertion snapshot.
  expect(store.loadAssertions).toHaveBeenCalledTimes(1);
});

it('refreshes assertion availability when a new run produces children', async () => {
  const ws = await createWorkspace();
  await writeText(ws, 'tests/a.test.ts', '');
  const fileUri = vscode.Uri.file(path.join(ws, 'tests/a.test.ts'));
  const store = {
    loadIndex: vi.fn().mockResolvedValue(new Map([['tests/a.test.ts::case A', { status: 'failed', runId: 'run', ranAt: 1 }]])),
    loadAssertions: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([
      { id: 'assertion', label: 'visible assertion', status: 'passed', assertionIndex: 0 },
    ]),
  };
  collect.mockResolvedValue({ nodes: [{ kind: 'test', title: 'case A' }] });
  const provider = new TestsTreeProvider({ discover: vi.fn().mockResolvedValue([{ uri: fileUri, label: 'a.test.ts' }]) } as any, store as any);
  const [file] = await provider.getChildren();
  const [testCase] = await provider.getChildren(file);
  expect((await provider.getTreeItem(testCase)).collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
  await provider.refreshStatuses();
  const [updatedCase] = await provider.getChildren(file);
  expect((await provider.getTreeItem(updatedCase)).collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
  expect(await provider.getChildren(updatedCase)).toEqual([expect.objectContaining({ label: 'visible assertion' })]);
  expect(store.loadAssertions).toHaveBeenCalledTimes(2);
});

it('updates run statuses without reimporting test files or rediscovering the tree', async () => {
  const ws = await createWorkspace();
  await writeText(ws, 'tests/first.test.ts', '');
  const uri = vscode.Uri.file(path.join(ws, 'tests/first.test.ts'));
  const discovery = { discover: vi.fn().mockResolvedValue([{ uri, label: 'first.test.ts' }]) };
  const store = { loadIndex: vi.fn().mockResolvedValueOnce(new Map()).mockResolvedValueOnce(new Map([
    ['tests/first.test.ts::first', {status:'passed',durationMs:7}],
  ])) };
  const provider = new TestsTreeProvider(discovery as any, store as any);
  const [file] = await provider.getChildren();
  await provider.getChildren(file);
  await provider.refreshStatuses();
  const [test] = await provider.getChildren(file);
  expect(test).toMatchObject({kind:'testCase',status:'passed',durationMs:7});
  expect(collect).toHaveBeenCalledTimes(1);
  expect(discovery.discover).toHaveBeenCalledTimes(1);
});
