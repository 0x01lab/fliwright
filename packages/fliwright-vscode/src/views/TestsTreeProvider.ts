import * as vscode from 'vscode';
import { AnnotationParser } from '../editor/AnnotationParser.js';
import type { TestDiscoveryService } from '../runner/TestDiscoveryService.js';
import type { TestFileEntry, TestStepEntry, TestTreeNode } from '../types.js';

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

    if (element.kind === 'step') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(
        element.status === 'pass' ? 'check' :
        element.status === 'fail' ? 'error' :
        'circle-outline',
      );
      item.contextValue = 'testStep';
      item.command = {
        command: 'fliwright.openVisualEditor',
        arguments: [element.fileUri],
        title: 'Open in Visual Editor',
      };
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
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
    if (element?.kind === 'step') return [];

    if (element?.kind === 'testFile') {
      const content = await vscode.workspace.fs.readFile(element.uri);
      const code = new TextDecoder().decode(content);
      const parser = new AnnotationParser();
      const result = parser.parse(code);
      return result.steps.map((step, i) => ({
        kind: 'step' as const,
        label: step.annotation.name,
        status: step.annotation.status ?? 'pending',
        stepIndex: i,
        fileUri: element.uri,
      }));
    }

    if (!this.tests) {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!root) {
        return [{ kind: 'empty', label: 'Open a workspace to discover tests' }];
      }
      this.tests = await this.discovery.discover(root);
    }
    return this.tests!.length > 0
      ? this.tests!
      : [{ kind: 'empty', label: 'No Fliwright tests', description: 'Configure fliwright.testGlob' }];
  }
}
