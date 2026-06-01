import * as vscode from 'vscode';
import type { FailureEntry, FailureTreeEntry, RunEntry, RunTreeNode, TestCaseResult } from '../types.js';

export class RunsTreeProvider implements vscode.TreeDataProvider<RunTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<RunTreeNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private runs: RunEntry[] = [];
  private failures: FailureEntry[] = [];

  setRuns(runs: RunEntry[], failures: FailureEntry[] = []): void {
    this.runs = runs;
    this.failures = failures;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  prependRun(run: RunEntry, failures: FailureEntry[] = []): void {
    this.setRuns([run, ...this.runs].slice(0, 20), failures);
  }

  get failuresList(): FailureEntry[] {
    return this.failures;
  }

  getTreeItem(element: RunTreeNode): vscode.TreeItem {
    if (hasKind(element, 'empty')) {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon('history');
      return item;
    }
    if (hasKind(element, 'run')) {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${element.result.passedTests}/${element.result.totalTests} passed`;
      item.contextValue = 'run';
      item.iconPath = new vscode.ThemeIcon(element.result.passed ? 'pass' : 'error');
      return item;
    }
    if (hasKind(element, 'failure')) {
      const item = new vscode.TreeItem(element.failure.testName, vscode.TreeItemCollapsibleState.None);
      item.description = 'failure';
      item.contextValue = 'failure';
      item.iconPath = new vscode.ThemeIcon('bug');
      item.command = { command: 'fliwright.openFailure', title: 'Open Failure', arguments: [element] };
      return item;
    }

    const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
    item.description = `${element.duration}ms`;
    item.contextValue = element.passed ? 'testPassed' : 'testFailed';
    item.iconPath = new vscode.ThemeIcon(element.passed ? 'pass' : 'error');
    return item;
  }

  getChildren(element?: RunTreeNode): RunTreeNode[] {
    if (!element) {
      return this.runs.length > 0 ? this.runs : [{ kind: 'empty', label: 'No test runs yet' }];
    }
    if (hasKind(element, 'run')) {
      const failureNodes: FailureTreeEntry[] = this.failures.map((failure) => ({ kind: 'failure', failure }));
      return [...failureNodes, ...element.result.results];
    }
    return [];
  }
}

function hasKind<K extends string>(node: RunTreeNode, kind: K): node is Extract<RunTreeNode, { kind: K }> {
  return 'kind' in node && node.kind === kind;
}
