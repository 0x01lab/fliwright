import * as vscode from 'vscode';
import type { ScriptDiscoveryService } from '../scripts/ScriptDiscoveryService.js';
import type { ScriptFileEntry, ScriptTreeNode } from '../types.js';

export class ScriptsTreeProvider implements vscode.TreeDataProvider<ScriptTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ScriptTreeNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private scripts: ScriptFileEntry[] | undefined;

  constructor(private readonly discovery: ScriptDiscoveryService) {}

  refresh(): void {
    this.scripts = undefined;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: ScriptTreeNode): vscode.TreeItem {
    if (element.kind === 'empty') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.command = element.command;
      item.iconPath = new vscode.ThemeIcon('info');
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.tooltip = element.uri.fsPath;
    item.resourceUri = element.uri;
    item.contextValue = 'scriptFile';
    item.iconPath = new vscode.ThemeIcon(element.lastResult?.passed === false ? 'error' : 'terminal');
    item.command = {
      command: 'fliwright.runScript',
      title: 'Run Script',
      arguments: [element],
    };
    return item;
  }

  async getChildren(element?: ScriptTreeNode): Promise<ScriptTreeNode[]> {
    if (element) return [];

    if (!this.scripts) {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!root) {
        return [{ kind: 'empty', label: 'Open a workspace to discover scripts' }];
      }
      this.scripts = await this.discovery.discover(root);
    }

    return this.scripts.length > 0
      ? this.scripts
      : [{
        kind: 'empty',
        label: 'No Fliwright scripts',
        description: '.fliwright/scripts/**/*.{js,mjs,cjs}',
      }];
  }
}
