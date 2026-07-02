import * as vscode from 'vscode';
import { FLIWRIGHT_FLOWS_DIR, type FliwrightFlowDocument } from '@fliwright/core';
import type { FlowFileEntry, FlowTreeNode } from '../types.js';

export class FlowsTreeProvider implements vscode.TreeDataProvider<FlowTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<FlowTreeNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private flows: FlowFileEntry[] | undefined;

  refresh(): void {
    this.flows = undefined;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: FlowTreeNode): vscode.TreeItem {
    if (element.kind === 'empty') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.command = element.command;
      item.iconPath = new vscode.ThemeIcon('info');
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.tooltip = [
      element.uri.fsPath,
      `${element.flow.nodes.length} node(s), ${element.flow.edges.length} edge(s)`,
      element.flow.updatedAt ? `Updated ${element.flow.updatedAt}` : undefined,
    ].filter(Boolean).join('\n');
    item.resourceUri = element.uri;
    item.contextValue = 'flowFile';
    item.iconPath = new vscode.ThemeIcon('type-hierarchy');
    item.command = {
      command: 'fliwright.openFlow',
      title: 'Open Flow',
      arguments: [element],
    };
    return item;
  }

  async getChildren(element?: FlowTreeNode): Promise<FlowTreeNode[]> {
    if (element) return [];

    if (!this.flows) {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!root) {
        return [{ kind: 'empty', label: 'Open a workspace to discover flows' }];
      }
      this.flows = await discoverFlows(root);
    }

    return this.flows.length > 0
      ? this.flows
      : [{
        kind: 'empty',
        label: 'No Fliwright flows',
        description: `${FLIWRIGHT_FLOWS_DIR}/*.flow.json`,
        command: {
          command: 'fliwright.createFlow',
          title: 'Create Flow',
        },
      }];
  }
}

async function discoverFlows(workspaceRoot: vscode.Uri): Promise<FlowFileEntry[]> {
  const flowsRoot = vscode.Uri.joinPath(workspaceRoot, ...FLIWRIGHT_FLOWS_DIR.split('/'));
  let entries: [string, unknown][];
  try {
    entries = await vscode.workspace.fs.readDirectory(flowsRoot) as [string, unknown][];
  } catch {
    return [];
  }

  const flows: FlowFileEntry[] = [];
  for (const [name] of entries) {
    if (!name.endsWith('.flow.json')) continue;
    const uri = vscode.Uri.joinPath(flowsRoot, name);
    try {
      const flow = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')) as FliwrightFlowDocument;
      if (!isFlowDocument(flow)) continue;
      flows.push({
        kind: 'flowFile',
        uri,
        label: flow.title || flow.id,
        description: flow.source?.kind ?? 'manual',
        flow,
      });
    } catch {
      // Ignore malformed or partially written flow files.
    }
  }

  flows.sort((a, b) => b.flow.updatedAt.localeCompare(a.flow.updatedAt));
  return flows;
}

function isFlowDocument(value: Partial<FliwrightFlowDocument> | null | undefined): value is FliwrightFlowDocument {
  return Boolean(
    value
    && value.version === 1
    && typeof value.id === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && Array.isArray(value.nodes)
    && Array.isArray(value.edges),
  );
}
