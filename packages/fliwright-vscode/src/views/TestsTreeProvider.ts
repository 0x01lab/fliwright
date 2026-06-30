import * as vscode from 'vscode';
import type { TestDiscoveryService } from '../runner/TestDiscoveryService.js';
import type { TestStatusStore } from '../testing/TestStatusStore.js';
import { relPathOf } from '../testing/relPath.js';
// Namespace import so test spies (vi.spyOn(builder, 'buildTestTree')) on the
// module namespace are observed at call time — required by the lazy-parse test.
import * as TestTreeBuilder from '../testing/TestTreeBuilder.js';
import type { ParsedFile, ParsedNode } from '../testing/TestTreeBuilder.js';
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
}

/**
 * VS Code TreeDataProvider for the Tests panel.
 *
 * Renders a three-level tree: file -> describe (group) -> test (case). Statuses
 * from {@link TestStatusStore} are joined onto case nodes by node id; group and
 * file statuses aggregate upward.
 *
 * LAZY PARSING CONTRACT: root `getChildren()` only lists files (status-map
 * lookup + findFiles; zero source parsing). Source parsing happens the first
 * time a file row is expanded; the parsed subtree is cached per file and reused
 * on subsequent expands. {@link invalidateFile} drops ONE file's cache entry so
 * Task 9's debounced save listener can refresh an edited file.
 */
export class TestsTreeProvider implements vscode.TreeDataProvider<TestTreeNode> {
  private readonly emitter = new vscode.EventEmitter<TestTreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private roots: TestFileNode[] | undefined;
  private statusMap: Map<string, StatusEntry> = new Map();
  private runningWorkspace = false;
  private runningFile: string | undefined;
  private runningTestId: string | undefined;
  /** Per-file parse cache: key = fileUri.toString(). */
  private readonly parseCache: Map<string, ParsedFile> = new Map();

  constructor(
    private readonly discovery: TestDiscoveryService,
    private readonly statusStore: TestStatusStore,
  ) {}

  /** Full refresh — drop roots, status map, and ALL parse caches. */
  refresh(): void {
    this.roots = undefined;
    this.statusMap = new Map();
    this.parseCache.clear();
    this.emitter.fire(undefined);
  }

  /**
   * Drop ONE file's parse cache entry and re-fire its subtree. Called by the
   * debounced onDidSaveTextDocument listener (Task 9) so an edited file's tree
   * is re-parsed on next expand while every other file stays cached.
   */
  invalidateFile(uri: vscode.Uri): void {
    this.parseCache.delete(uri.toString());
    const fileNode = this.roots?.find((f) => f.uri.toString() === uri.toString());
    this.emitter.fire(fileNode);
  }

  /**
   * Refresh ONE test file from the Tests panel inline action. This keeps the
   * root file list and every other file's parse cache intact; source parsing
   * remains lazy and happens only if this file row is expanded again.
   */
  async refreshFile(uri: vscode.Uri): Promise<void> {
    this.parseCache.delete(uri.toString());
    this.statusMap = await this.loadStatusMap();
    const fileNode = this.roots?.find((f) => f.uri.toString() === uri.toString());
    if (fileNode) {
      fileNode.status = this.statusForFile(fileNode.relPath, 'unknown');
    }
    this.emitter.fire(fileNode);
  }

  setRunning(target?: { workspace?: boolean; relPath?: string; testId?: string }): void {
    this.runningWorkspace = target?.workspace ?? false;
    this.runningFile = target?.relPath;
    this.runningTestId = target?.testId;
    this.updateRootStatuses();
    this.emitter.fire(undefined);
  }

  async getChildren(element?: TestTreeNode): Promise<TestTreeNode[]> {
    // Activation path: status map (index.json only) + file list (findFiles only).
    // NO source parsing happens here.
    if (!this.roots) {
      this.statusMap = await this.loadStatusMap();
      this.roots = await this.discoverRoots();
    }

    if (!element) {
      return this.roots.length > 0
        ? this.roots
        : [{ kind: 'empty', label: 'No Fliwright tests' }];
    }

    switch (element.kind) {
      case 'testFile': {
        // LAZY: parses the file ONCE on first expand, caches the result.
        const parsed = await this.parsedFileFor(element);
        const children = parsed.nodes.map((n) =>
          this.toNode(element.relPath, [], n, element.uri),
        );
        // Aggregate file status from top-level children now that they exist.
        element.status = aggregateStatus(children.map((c) => c.status));
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

  getTreeItem(element: TestTreeNode): vscode.TreeItem {
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
        item.description = element.status === 'unknown' ? undefined : element.status;
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
        const item = iconItem(
          element.label,
          statusIcon(element.status),
          hasRunnableStatus(element.status)
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
          element.status === 'running' ? 'testCaseRunning' : 'testCase',
        );
        item.description =
          element.status === 'running'
            ? 'running'
            : element.durationMs != null ? `${element.durationMs}ms` : undefined;
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

  private async parsedFileFor(file: TestFileNode): Promise<ParsedFile> {
    const key = file.uri.toString();
    const cached = this.parseCache.get(key);
    if (cached) return cached;
    const bytes = await vscode.workspace.fs.readFile(file.uri);
    const code = new TextDecoder().decode(bytes);
    const parsed = TestTreeBuilder.buildTestTree(code);
    this.parseCache.set(key, parsed);
    return parsed;
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
   * Build a tree node (and its full subtree for groups) from a parsed node.
   * Approach (a) from the brief: recurse eagerly so each TestGroupNode carries
   * its `children` array; getChildren(testGroup) then just returns it.
   */
  private toNode(
    relPath: string,
    ancestors: string[],
    parsed: ParsedNode,
    fileUri: vscode.Uri,
  ): TestGroupNode | TestCaseNode {
    const id = testNodeId(relPath, ancestors, parsed.title);

    if (parsed.kind === 'group') {
      const childAncestors = [...ancestors, parsed.title];
      const children = parsed.children.map((child) =>
        this.toNode(relPath, childAncestors, child, fileUri),
      );
      return {
        kind: 'testGroup',
        id,
        label: parsed.title,
        status: aggregateStatus(children.map((c) => c.status)),
        children,
      };
    }

    const entry = this.statusMap.get(id);
    return {
      kind: 'testCase',
      id,
      label: parsed.title,
      status: this.statusForCase(relPath, id, entry?.status ?? 'unknown'),
      durationMs: entry?.durationMs,
      fileUri,
    };
  }

  private updateRootStatuses(): void {
    if (!this.roots) return;
    for (const root of this.roots) {
      root.status = this.statusForFile(root.relPath, root.status === 'running' ? 'unknown' : root.status);
    }
  }

  private statusForFile(relPath: string, fallback: TestNodeStatus): TestNodeStatus {
    if (this.runningWorkspace) return 'running';
    if (this.runningFile === relPath) return 'running';
    return fallback;
  }

  private statusForCase(relPath: string, id: string, fallback: TestNodeStatus): TestNodeStatus {
    if (this.runningWorkspace) return 'running';
    if (this.runningTestId) return this.runningTestId === id ? 'running' : fallback;
    if (this.runningFile === relPath) return 'running';
    return fallback;
  }

  private async assertionsForCase(testCase: TestCaseNode): Promise<TestAssertionNode[]> {
    const entries = await this.statusStore.loadAssertions(testCase.id);
    return entries.map((entry) => ({
      kind: 'testAssertion' as const,
      id: `${testCase.id}::assertion/${entry.id}`,
      label: entry.label,
      status: testCase.status === 'running' ? 'running' : entry.status,
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
  icon: string,
  collapsible: vscode.TreeItemCollapsibleState,
  contextValue: string,
): vscode.TreeItem {
  const item = new vscode.TreeItem(label, collapsible);
  item.iconPath = new vscode.ThemeIcon(icon);
  item.contextValue = contextValue;
  return item;
}

function statusIcon(s: TestNodeStatus): string {
  if (s === 'passed') return 'pass';
  if (s === 'failed') return 'error';
  if (s === 'running') return 'loading~spin';
  if (s === 'skipped') return 'debug-step-over';
  return 'circle-outline';
}

function hasRunnableStatus(s: TestNodeStatus): boolean {
  return s === 'passed' || s === 'failed' || s === 'running' || s === 'skipped';
}
