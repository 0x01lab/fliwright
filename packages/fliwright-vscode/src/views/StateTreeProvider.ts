import * as vscode from 'vscode';
import type { StateProviderEntry, StateTreeNode } from '../types.js';

export class StateTreeProvider implements vscode.TreeDataProvider<StateTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<StateTreeNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private providers: StateProviderEntry[] = [];
  private message = 'Connect to a Flutter app and refresh providers';

  setProviders(providers: StateProviderEntry[]): void {
    this.providers = providers;
    this.message = providers.length > 0 ? '' : 'No state providers found';
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getProviders(): StateProviderEntry[] {
    return [...this.providers];
  }

  updateProvider(provider: StateProviderEntry): void {
    const index = this.providers.findIndex((entry) => entry.key === provider.key);
    if (index >= 0) {
      this.providers = [
        ...this.providers.slice(0, index),
        { ...this.providers[index], ...provider },
        ...this.providers.slice(index + 1),
      ];
    } else {
      this.providers = [...this.providers, provider];
    }
    this.message = this.providers.length > 0 ? '' : this.message;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  setMessage(message: string): void {
    this.providers = [];
    this.message = message;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: StateTreeNode): vscode.TreeItem {
    if (element.kind === 'empty' || element.kind === 'stateRoot') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.iconPath = new vscode.ThemeIcon(element.kind === 'empty' ? 'info' : 'symbol-namespace');
      return item;
    }

    const item = new vscode.TreeItem(element.key, vscode.TreeItemCollapsibleState.None);
    item.description = element.error ?? element.type ?? previewValue(element.value);
    item.contextValue = 'stateProvider';
    item.iconPath = new vscode.ThemeIcon(element.error ? 'warning' : element.watching ? 'eye' : 'symbol-variable');
    item.tooltip = stateProviderTooltip(element);
    return item;
  }

  getChildren(element?: StateTreeNode): StateTreeNode[] {
    if (element) return [];
    return this.providers.length > 0 ? this.providers : [{ kind: 'empty', label: this.message }];
  }
}

function stateProviderTooltip(provider: StateProviderEntry): string {
  const lines = [
    provider.key,
    provider.type ? `Type: ${provider.type}` : undefined,
    `Readable: ${provider.readable !== false}`,
    `Overridable: ${provider.overridable === true}`,
    provider.watching ? 'Watching: true' : undefined,
    provider.error ? `Error: ${provider.error}` : undefined,
    provider.value !== undefined ? `Value: ${formatValue(provider.value)}` : undefined,
  ].filter((line): line is string => Boolean(line));
  return lines.join('\n');
}

function previewValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const text = formatValue(value);
  return text.length > 48 ? `${text.slice(0, 45)}...` : text;
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
