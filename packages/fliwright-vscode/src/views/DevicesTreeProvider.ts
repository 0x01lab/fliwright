import * as vscode from 'vscode';
import type { DeviceConnectionState, DeviceTreeNode } from '../types.js';

export class DevicesTreeProvider implements vscode.TreeDataProvider<DeviceTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<DeviceTreeNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private state: DeviceConnectionState = { status: 'disconnected' };

  setState(state: DeviceConnectionState): void {
    this.state = state;
    this.refresh();
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: DeviceTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'deviceStatus':
        return this.statusItem(element.state);
      case 'deviceCapability': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.description = element.description;
        item.iconPath = new vscode.ThemeIcon(element.available ? 'check' : 'circle-slash');
        return item;
      }
      case 'empty': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.description = element.description;
        item.iconPath = new vscode.ThemeIcon('info');
        item.command = element.command;
        return item;
      }
    }
  }

  getChildren(element?: DeviceTreeNode): DeviceTreeNode[] {
    if (element) return [];
    const nodes: DeviceTreeNode[] = [{ kind: 'deviceStatus', state: this.state }];
    if (this.state.status === 'connected') {
      nodes.push(
        {
          kind: 'deviceCapability',
          label: 'Mock APIs',
          description: 'runtime commands available',
          available: true,
        },
        {
          kind: 'deviceCapability',
          label: 'Form Helper',
          description: 'runtime commands available',
          available: true,
        },
      );
    }
    return nodes;
  }

  private statusItem(state: DeviceConnectionState): vscode.TreeItem {
    const label = statusLabel(state);
    const item = new vscode.TreeItem(label, state.status === 'connected'
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None);
    item.description = statusDescription(state);
    item.tooltip = statusTooltip(state);
    item.contextValue = `device-${state.status}`;
    item.iconPath = new vscode.ThemeIcon(statusIcon(state));
    if (state.status === 'disconnected' || state.status === 'error') {
      item.command = {
        command: 'fliwright.connect',
        title: 'Connect to VM Service',
      };
    }
    return item;
  }
}

function statusLabel(state: DeviceConnectionState): string {
  if (state.status === 'connected') return 'Connected';
  if (state.status === 'connecting') return 'Connecting';
  if (state.status === 'error') return 'Connection Error';
  return 'No VM Service';
}

function statusDescription(state: DeviceConnectionState): string | undefined {
  if (state.status === 'connected' || state.status === 'connecting') return state.url;
  if (state.status === 'error') return state.message;
  return 'Click to connect';
}

function statusTooltip(state: DeviceConnectionState): string | undefined {
  if (state.status === 'connected') return `${state.url}\nConnected ${new Date(state.connectedAt).toLocaleString()}`;
  if (state.status === 'connecting') return state.url;
  if (state.status === 'error') return `${state.url ? `${state.url}\n` : ''}${state.message}`;
  return undefined;
}

function statusIcon(state: DeviceConnectionState): string {
  if (state.status === 'connected') return 'vm-active';
  if (state.status === 'connecting') return 'sync~spin';
  if (state.status === 'error') return 'error';
  return 'circle-outline';
}
