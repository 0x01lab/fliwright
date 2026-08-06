import * as vscode from 'vscode';
import type { WebSocketMockCall, WebSocketMockRule } from '@fliwright/core';
import type {
  WebSocketMockDiscoveryResult,
  WebSocketMockProfileEntry,
  WebSocketMockTreeNode,
} from '../types.js';
import { WebSocketMockConfigService } from '../websocket/WebSocketMockConfigService.js';

export class WebSocketMockTreeProvider implements vscode.TreeDataProvider<WebSocketMockTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<WebSocketMockTreeNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private result: WebSocketMockDiscoveryResult | undefined;
  private loaded = false;
  private supported: boolean | undefined;
  private activeRules: WebSocketMockRule[] = [];
  private calls: WebSocketMockCall[] = [];

  constructor(private readonly service: WebSocketMockConfigService) {}

  get currentResult(): WebSocketMockDiscoveryResult | undefined {
    return this.result;
  }

  setSupported(supported: boolean | undefined): void {
    this.supported = supported;
    if (!supported) {
      this.activeRules = [];
      this.calls = [];
    }
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  setRuntimeState(rules: WebSocketMockRule[], calls: WebSocketMockCall[]): void {
    this.activeRules = rules;
    this.calls = calls;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  async refresh(): Promise<void> {
    await this.load();
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: WebSocketMockTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'websocketProfile': {
        const active = sameRules(element.profile.rules, this.activeRules);
        const item = new vscode.TreeItem(element.profile.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.description = `${element.profile.rules.length} topic rule(s)${active ? ' · active' : ''}`;
        item.tooltip = `${element.profile.description ?? element.uri.fsPath}\n${element.uri.fsPath}`;
        item.contextValue = active ? 'websocketProfileActive' : 'websocketProfile';
        item.iconPath = new vscode.ThemeIcon(active ? 'pass-filled' : 'radio-tower');
        item.resourceUri = element.uri;
        return item;
      }
      case 'websocketRule': {
        const item = new vscode.TreeItem(`${element.rule.connection}: ${element.rule.channel}`);
        item.description = element.rule.suppressRemote ? 'remote suppressed' : 'passthrough';
        item.tooltip = JSON.stringify(element.rule, null, 2);
        item.contextValue = 'websocketRule';
        item.iconPath = new vscode.ThemeIcon(element.rule.suppressRemote ? 'debug-disconnect' : 'debug-connect');
        return item;
      }
      case 'websocketPush': {
        const item = new vscode.TreeItem(element.push.name);
        item.description = `${element.push.connection}: ${element.push.channel}`;
        item.tooltip = JSON.stringify(element.push.payload, null, 2);
        item.contextValue = 'websocketPush';
        item.iconPath = new vscode.ThemeIcon('send');
        return item;
      }
      case 'websocketCallsRoot': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = 'websocketCallsRoot';
        item.iconPath = new vscode.ThemeIcon('output');
        return item;
      }
      case 'websocketCall': {
        const item = new vscode.TreeItem(`${element.direction}: ${element.channel ?? element.connection}`);
        item.description = element.connection;
        item.tooltip = element.mockPayload === undefined && element.payload === undefined
          ? 'Click to inspect this WebSocket call.'
          : JSON.stringify({ mockPayload: element.mockPayload, payload: element.payload }, null, 2);
        item.contextValue = 'websocketCall';
        item.iconPath = new vscode.ThemeIcon(element.direction === 'mock' ? 'debug-step-into' : 'arrow-right');
        item.command = {
          command: 'fliwright.inspectWebSocketMockCall',
          title: 'Inspect WebSocket Mock Call',
          arguments: [element],
        };
        return item;
      }
      case 'invalid': {
        const item = new vscode.TreeItem(element.label);
        item.description = element.error;
        item.tooltip = `${element.error}\n${element.uri.fsPath}`;
        item.contextValue = 'websocketInvalid';
        item.iconPath = new vscode.ThemeIcon('warning');
        item.resourceUri = element.uri;
        return item;
      }
      case 'empty': {
        const item = new vscode.TreeItem(element.label);
        item.description = element.description;
        item.command = element.command;
        item.iconPath = new vscode.ThemeIcon('info');
        return item;
      }
    }
  }

  async getChildren(element?: WebSocketMockTreeNode): Promise<WebSocketMockTreeNode[]> {
    if (!this.loaded) await this.load();
    if (this.supported === undefined) {
      return [{ kind: 'empty', label: 'Connect to inspect WebSocket mock support' }];
    }
    if (!this.supported) {
      return [{ kind: 'empty', label: 'WebSocket mock is not registered by the connected app' }];
    }
    if (!this.result) return [{ kind: 'empty', label: 'Open a workspace to use Fliwright' }];

    if (!element) {
      const entries: WebSocketMockTreeNode[] = [...this.result.invalid, ...this.result.profiles];
      if (this.calls.length > 0) entries.push({ kind: 'websocketCallsRoot', label: `Live calls (${this.calls.length})` });
      if (entries.length > 0) return entries;
      return [{
        kind: 'empty',
        label: 'No WebSocket mock profiles',
        description: '.fliwright/mocks/websocket/*.json',
        command: { command: 'fliwright.createWebSocketMockProfile', title: 'Create WebSocket Mock Profile' },
      }];
    }

    if (element.kind === 'websocketProfile') {
      return [
        ...element.profile.rules.map((rule) => ({ kind: 'websocketRule' as const, profile: element, rule })),
        ...(element.profile.pushes ?? []).map((push) => ({ kind: 'websocketPush' as const, profile: element, push })),
      ];
    }
    if (element.kind === 'websocketCallsRoot') {
      return this.calls.map((call) => ({ kind: 'websocketCall', ...call }));
    }
    return [];
  }

  private async load(): Promise<void> {
    this.result = await this.service.discover();
    this.loaded = true;
  }
}

function sameRules(profileRules: WebSocketMockProfileEntry['profile']['rules'], runtimeRules: WebSocketMockRule[]): boolean {
  return stableJson(profileRules.map(normalizeRule)) === stableJson(runtimeRules.map(normalizeRule));
}

function normalizeRule(rule: WebSocketMockRule): Record<string, unknown> {
  return {
    id: rule.id,
    connection: rule.connection,
    channel: rule.channel,
    suppressRemote: rule.suppressRemote ?? false,
    onSubscribe: (rule.onSubscribe ?? []).map((push) => ({
      payload: push.payload,
      delayMs: push.delayMs ?? 0,
    })),
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_, current) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
    return Object.fromEntries(Object.entries(current as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
  });
}
