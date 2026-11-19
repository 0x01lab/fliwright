import * as vscode from 'vscode';
import type { TestProgress } from '@fliwright/cli/run';
import type { TestDiscoveryService } from '../runner/TestDiscoveryService.js';
import type { AssertionStatusEntry, TestStatusStore } from '../testing/TestStatusStore.js';
import { relPathOf } from '../testing/relPath.js';
import { TestCatalogCollector } from '../testing/TestCatalogCollector.js';
import type { CollectedFile, CollectedNode } from '../testing/TestCatalogTree.js';
import {
  aggregateStatus,
  testNodeId,
  type TestAssertionNode,
  type TestCaseNode,
  type TestFileNode,
  type TestGroupNode,
  type TestNodeStatus,
  type TestTreeNode,
} from '../testing/types.js';

interface StatusEntry {
  status: TestNodeStatus;
  ranAt?: number;
  durationMs?: number;
  error?: string;
}

/** Tests panel with lazy, cancellable Vitest collection and per-file caching. */
export class TestsTreeProvider implements vscode.TreeDataProvider<TestTreeNode> {
  private readonly emitter = new vscode.EventEmitter<TestTreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private roots: TestFileNode[] | undefined;
  private rootsLoading: Promise<[Map<string, StatusEntry>, TestFileNode[]]> | undefined;
  private statusMap: Map<string, StatusEntry> = new Map();
  private readonly liveStatuses = new Map<string, StatusEntry>();
  private readonly fileChildren = new Map<string, TestTreeNode[]>();
  private runningWorkspace = false;
  private runningFile: string | undefined;
  private runningTestId: string | undefined;
  private disposed = false;
  private readonly assertionCache = new Map<string, Promise<AssertionStatusEntry[]>>();
  private readonly collectionCache = new Map<string, { promise: Promise<CollectedFile>; controller: AbortController }>();

  constructor(
    private readonly discovery: TestDiscoveryService,
    private readonly statusStore: TestStatusStore,
    private readonly collector: Pick<TestCatalogCollector, 'collect'> = new TestCatalogCollector(),
    private readonly onCollectionError: (message: string) => void = () => {},
  ) {}

  /** Full refresh — drop roots, status map, and all collection caches. */
  refresh(): void {
    this.roots = undefined;
    this.rootsLoading = undefined;
    this.statusMap = new Map();
    this.assertionCache.clear();
    this.clearCollections();
    this.emitter.fire(undefined);
  }

  /** Reload execution results without invalidating expensive test collection. */
  async refreshStatuses(): Promise<void> {
    const stored = await this.loadStatusMap();
    if (!this.runningWorkspace && !this.runningFile) {
      // A killed worker may never write a final report. Retain its last live
      // result, but let a newly persisted result replace the transient snapshot.
      for (const [id, entry] of this.liveStatuses) {
        if (stored.get(id)?.ranAt === this.statusMap.get(id)?.ranAt) stored.set(id, entry);
      }
      this.liveStatuses.clear();
    }
    this.statusMap = stored;
    this.assertionCache.clear();
    this.updateRootStatuses();
    this.emitter.fire(undefined);
  }

  /** Cancel and invalidate a file, preserving every other file's collection. */
  invalidateFile(uri: vscode.Uri): void {
    const key = uri.toString();
    this.collectionCache.get(key)?.controller.abort();
    this.collectionCache.delete(key);
    const file = this.roots?.find(node => node.uri.toString() === key);
    if (file) this.fileChildren.delete(file.relPath);
    if (file) for (const testId of this.assertionCache.keys()) {
      if (testId.startsWith(`${file.relPath}::`)) this.assertionCache.delete(testId);
    }
    this.emitter.fire(file);
  }

  /** Refresh an individual file and its persisted run status. */
  async refreshFile(uri: vscode.Uri): Promise<void> {
    this.statusMap = await this.loadStatusMap();
    const file = this.roots?.find(node => node.uri.toString() === uri.toString());
    if (file) file.status = this.statusForFile(file.relPath, 'unknown');
    this.invalidateFile(uri);
  }

  dispose(): void {
    this.disposed = true;
    this.rootsLoading = undefined;
    this.assertionCache.clear();
    this.clearCollections();
    this.emitter.dispose();
  }

  private clearCollections(): void {
    for (const entry of this.collectionCache.values()) entry.controller.abort();
    this.collectionCache.clear();
    this.fileChildren.clear();
  }

  setRunning(target?: { workspace?: boolean; relPath?: string; testId?: string }, unfinished: 'interrupted' | 'failed' = 'interrupted'): void {
    if (target) this.liveStatuses.clear();
    else for (const [id, entry] of this.liveStatuses) {
      if (entry.status === 'running') this.liveStatuses.set(id, { status: unfinished });
    }
    this.runningWorkspace = target?.workspace ?? false;
    this.runningFile = target?.relPath;
    this.runningTestId = target?.testId;
    this.updateRootStatuses();
    this.emitter.fire(undefined);
  }

  /** Apply a real runner event without re-collecting or replacing expanded nodes. */
  updateTestProgress(progress: TestProgress): void {
    if (!this.runningWorkspace && !this.runningFile) return;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) return;
    const relPath = relPathOf(root, { fsPath: progress.filePath });
    const id = testNodeId(relPath, progress.titlePath.slice(0, -1), progress.titlePath.at(-1)!);
    this.liveStatuses.set(id, { status: progress.status, durationMs: progress.durationMs, error: progress.error });
    this.assertionCache.delete(id);
    this.updateRootStatuses();
    this.emitter.fire(undefined);
  }

  async getChildren(element?: TestTreeNode): Promise<TestTreeNode[]> {
    if (this.disposed) return [];
    if (!vscode.workspace.isTrusted) {
      return [{ kind: 'empty', label: 'Trust this workspace to discover Fliwright tests' }];
    }
    // Root expansion lists files; Vitest starts only when a file is expanded.
    await this.ensureRoots();
    if (this.disposed) return [];

    if (!element) {
      return this.roots?.length
        ? this.roots
        : [{ kind: 'empty', label: 'No Fliwright tests' }];
    }

    switch (element.kind) {
      case 'testFile': {
        let collected: CollectedFile;
        try { collected = await this.collectedFileFor(element); }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.onCollectionError(`${element.relPath}: ${message}`);
          return [{ kind: 'empty', label: message }];
        }
        const children = this.fileChildren.get(element.relPath) ?? collected.nodes.map((n) =>
          this.toNode(element.relPath, [], n, element.uri),
        );
        this.fileChildren.set(element.relPath, children);
        this.updateRootStatuses();
        return children;
      }
      case 'testGroup':
        // Eager recursion: the subtree under a group is built when the file was
        // expanded (see toNode). getChildren(group) just hands it back.
        return element.children ?? [];
      case 'testCase':
        return this.assertionsForCase(element);
      default:
        return [];
    }
  }

  async getTreeItem(element: TestTreeNode): Promise<vscode.TreeItem> {
    switch (element.kind) {
      case 'empty':
        return iconItem(
          element.label,
          'info',
          vscode.TreeItemCollapsibleState.None,
          'empty',
        );
      case 'testFile': {
        const item = iconItem(
          element.label,
          statusIcon(element.status),
          vscode.TreeItemCollapsibleState.Collapsed,
          element.status === 'running' ? 'testFileRunning' : 'testFile',
        );
        item.resourceUri = element.uri;
        item.description = this.progressDescription(element.relPath)
          ?? (element.status === 'unknown' ? undefined : element.status);
        item.command = {
          command: 'fliwright.runCurrentTest',
          title: 'Run',
          arguments: [element],
        };
        return item;
      }
      case 'testGroup':
        return iconItem(
          element.label,
          statusIcon(element.status),
          vscode.TreeItemCollapsibleState.Collapsed,
          'testGroup',
        );
      case 'testCase': {
        const assertions = await this.assertionsForCase(element);
        const item = iconItem(
          element.label,
          statusIcon(element.status),
          assertions.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
          element.status === 'running' ? 'testCaseRunning' : 'testCase',
        );
        item.description = ['running', 'queued', 'skipped', 'interrupted'].includes(element.status)
          ? element.status
          : element.durationMs != null ? `${element.durationMs}ms` : undefined;
        item.tooltip = element.error ?? element.label;
        item.command = {
          command: 'vscode.open',
          title: 'Open Test File',
          arguments: [element.fileUri],
        };
        return item;
      }
      case 'testAssertion': {
        const item = iconItem(
          element.label,
          statusIcon(element.status),
          vscode.TreeItemCollapsibleState.None,
          element.status === 'running' ? 'testAssertionRunning' : 'testAssertion',
        );
        item.description = element.status === 'running'
          ? 'running'
          : element.durationMs != null ? `${element.durationMs}ms` : element.status;
        item.tooltip = element.error ?? element.label;
        item.command = {
          command: 'vscode.open',
          title: 'Open Test File',
          arguments: [element.fileUri],
        };
        return item;
      }
    }
  }

  // ── internals ────────────────────────────────────────────────────────

  private async collectedFileFor(file: TestFileNode): Promise<CollectedFile> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) return { nodes: [] };
    const key = file.uri.toString();
    while (!this.disposed) {
      let entry = this.collectionCache.get(key);
      if (!entry) {
        const controller = new AbortController();
        entry = { controller, promise: this.collector.collect(root.fsPath, file.relPath, controller.signal) };
        this.collectionCache.set(key, entry);
      }
      try {
        const result = await entry.promise;
        if (this.collectionCache.get(key) === entry) return result;
      } catch (error) {
        if (!entry.controller.signal.aborted) {
          if (this.collectionCache.get(key) === entry) this.collectionCache.delete(key);
          throw error;
        }
      }
      // A refresh overtook this request. Join the replacement collection.
    }
    return { nodes: [] };
  }

  private async discoverRoots(): Promise<TestFileNode[]> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) return [];
    const entries = await this.discovery.discover(root);
    return entries.map((e) => ({
      kind: 'testFile' as const,
      uri: e.uri,
      relPath: relPathOf(root, e.uri),
      label: e.label,
      status: this.statusForFile(relPathOf(root, e.uri), 'unknown'),
    }));
  }

  private async ensureRoots(): Promise<void> {
    while (!this.disposed && !this.roots) {
      const pending = this.rootsLoading ??= Promise.all([this.loadStatusMap(), this.discoverRoots()]);
      try {
        const [statuses, roots] = await pending;
        if (this.rootsLoading !== pending) continue;
        this.statusMap = statuses;
        this.roots = roots;
        this.rootsLoading = undefined;
        this.updateRootStatuses();
      } catch (error) {
        if (this.rootsLoading !== pending) continue;
        this.rootsLoading = undefined;
        throw error;
      }
    }
  }

  private async loadStatusMap(): Promise<Map<string, StatusEntry>> {
    const raw = await this.statusStore.loadIndex();
    const out = new Map<string, StatusEntry>();
    for (const [id, entry] of raw) {
      out.set(id, {
        status: entry.status,
        ranAt: entry.ranAt,
        durationMs: entry.durationMs,
      });
    }
    return out;
  }

  /**
   * Build groups and cases from collected Vitest titles, retaining run-status IDs.
   */
  private toNode(
    relPath: string,
    ancestors: string[],
    collected: CollectedNode,
    fileUri: vscode.Uri,
  ): TestGroupNode | TestCaseNode {
    const id = testNodeId(relPath, ancestors, collected.title);

    if (collected.kind === 'group') {
      const childAncestors = [...ancestors, collected.title];
      const children = collected.children.map((child) =>
        this.toNode(relPath, childAncestors, child, fileUri),
      );
      return {
        kind: 'testGroup',
        id,
        label: collected.title,
        status: aggregateStatus(children.map((c) => c.status)),
        children,
      };
    }

    const entry = this.liveStatuses.get(id) ?? this.statusMap.get(id);
    return {
      kind: 'testCase',
      id,
      label: collected.title,
      testNamePattern: `^${[...ancestors, collected.title].join(' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
      status: this.statusForCase(relPath, id, entry?.status ?? 'unknown'),
      durationMs: entry?.durationMs,
      error: entry?.error,
      fileUri,
    };
  }

  private updateRootStatuses(): void {
    if (!this.roots) return;
    for (const root of this.roots) {
      const children = this.fileChildren.get(root.relPath);
      if (children) this.updateChildren(root.relPath, children);
      root.status = this.statusForFile(root.relPath, 'unknown');
    }
  }

  private updateChildren(relPath: string, nodes: TestTreeNode[]): void {
    for (const node of nodes) {
      if (node.kind === 'testCase') {
        const entry = this.liveStatuses.get(node.id) ?? this.statusMap.get(node.id);
        node.status = this.statusForCase(relPath, node.id, entry?.status ?? 'unknown');
        node.durationMs = node.status === 'queued' || node.status === 'running' ? undefined : entry?.durationMs;
        node.error = entry?.error;
      } else if (node.kind === 'testGroup') {
        this.updateChildren(relPath, node.children ?? []);
        node.status = aggregateStatus((node.children ?? []).flatMap(child => 'status' in child ? [child.status] : []));
      }
    }
  }

  private statusForFile(relPath: string, fallback: TestNodeStatus): TestNodeStatus {
    if (this.runningWorkspace) return 'running';
    if (this.runningFile === relPath) return 'running';
    const children = this.fileChildren.get(relPath);
    if (children) return aggregateStatus(children.flatMap(child => 'status' in child ? [child.status] : []));
    const entries = new Map([...this.statusMap, ...this.liveStatuses]);
    const statuses = [...entries].filter(([id]) => id.startsWith(`${relPath}::`)).map(([, entry]) => entry.status);
    return statuses.length ? aggregateStatus(statuses) : fallback;
  }

  private statusForCase(relPath: string, id: string, fallback: TestNodeStatus): TestNodeStatus {
    const live = this.liveStatuses.get(id);
    if (live) return live.status;
    if (this.runningTestId) return this.runningTestId === id ? 'queued' : fallback;
    if (this.runningWorkspace || this.runningFile === relPath) return 'queued';
    return fallback;
  }

  private progressDescription(relPath: string): string | undefined {
    if (!this.runningWorkspace && this.runningFile !== relPath) return undefined;
    const ids: string[] = [];
    const visit = (nodes: TestTreeNode[]): void => {
      for (const node of nodes) {
        if (node.kind === 'testCase' && (!this.runningTestId || this.runningTestId === node.id)) ids.push(node.id);
        if (node.kind === 'testGroup') visit(node.children ?? []);
      }
    };
    visit(this.fileChildren.get(relPath) ?? []);
    if (!ids.length) return undefined;
    const statuses = ids.map(id => this.liveStatuses.get(id)?.status);
    const completed = statuses.filter(status => status === 'passed' || status === 'failed' || status === 'skipped').length;
    return `${completed}/${ids.length} completed · ${statuses.filter(status => status === 'passed').length} passed · ${statuses.filter(status => status === 'failed').length} failed`;
  }

  private async assertionsForCase(testCase: TestCaseNode): Promise<TestAssertionNode[]> {
    // Stored assertions belong to the previous attempt until this run is saved.
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    const inActiveRun = this.runningWorkspace || (root && this.runningFile === relPathOf(root, testCase.fileUri)
      && (!this.runningTestId || this.runningTestId === testCase.id));
    if (testCase.status === 'queued' || testCase.status === 'running' || testCase.status === 'interrupted' || inActiveRun) return [];
    let pending = this.assertionCache.get(testCase.id);
    if (!pending) {
      pending = this.statusStore.loadAssertions(testCase.id);
      this.assertionCache.set(testCase.id, pending);
    }
    const entries = await pending;
    return entries.map((entry) => ({
      kind: 'testAssertion' as const,
      id: `${testCase.id}::assertion/${entry.id}`,
      label: entry.label,
      status: entry.status,
      assertionIndex: entry.assertionIndex,
      durationMs: entry.durationMs,
      error: entry.error,
      fileUri: testCase.fileUri,
    }));
  }
}

// ── helpers ────────────────────────────────────────────────────────────
function iconItem(
  label: string,
  icon: string | vscode.ThemeIcon,
  collapsible: vscode.TreeItemCollapsibleState,
  contextValue: string,
): vscode.TreeItem {
  const item = new vscode.TreeItem(label, collapsible);
  item.iconPath = typeof icon === 'string' ? new vscode.ThemeIcon(icon) : icon;
  item.contextValue = contextValue;
  return item;
}

function statusIcon(s: TestNodeStatus): string | vscode.ThemeIcon {
  if (s === 'passed') return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
  if (s === 'failed') return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
  if (s === 'running') return 'loading~spin';
  if (s === 'queued') return 'clock';
  if (s === 'interrupted') return 'debug-stop';
  if (s === 'skipped') return 'debug-step-over';
  return 'circle-outline';
}
