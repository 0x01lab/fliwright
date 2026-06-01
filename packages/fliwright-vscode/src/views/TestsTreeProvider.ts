import * as vscode from 'vscode';
import type { TestDiscoveryService } from '../runner/TestDiscoveryService.js';
import type { TestFileEntry, TestTreeNode } from '../types.js';

export class TestsTreeProvider implements vscode.TreeDataProvider<TestTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TestTreeNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private tests: TestFileEntry[] | undefined;

  constructor(private readonly discovery: TestDiscoveryService) {}

  refresh(): void {
    this.tests = undefined;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: TestTreeNode): vscode.TreeItem {
    if (element.kind === 'empty') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.command = element.command;
      item.iconPath = new vscode.ThemeIcon('info');
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.resourceUri = element.uri;
    item.contextValue = 'testFile';
    item.iconPath = new vscode.ThemeIcon(element.lastResult?.passed === false ? 'error' : 'beaker');
    item.command = {
      command: 'fliwright.runCurrentTest',
      title: 'Run Test',
      arguments: [element],
    };
    return item;
  }

  async getChildren(element?: TestTreeNode): Promise<TestTreeNode[]> {
    if (element) return [];
    if (!this.tests) {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!root) {
        return [{ kind: 'empty', label: 'Open a workspace to discover tests' }];
      }
      this.tests = await this.discovery.discover(root);
    }
    return this.tests.length > 0
      ? this.tests
      : [{ kind: 'empty', label: 'No Fliwright tests', description: 'Configure fliwright.testGlob' }];
  }
}
