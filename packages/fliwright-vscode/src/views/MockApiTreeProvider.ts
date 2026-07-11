import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AppliedMockRule, MockDiscoveryResult, MockEndpointEntry, MockRuleEntry, MockTreeNode } from '../types.js';
import { getWorkspaceRoot } from '../config.js';
import { MockConfigService } from '../sandbox/MockConfigService.js';

export class MockApiTreeProvider implements vscode.TreeDataProvider<MockTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<MockTreeNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private result: MockDiscoveryResult | undefined;
  private appliedRules: AppliedMockRule[] = [];
  private loaded = false;

  constructor(private readonly service: MockConfigService) {}

  get currentResult(): MockDiscoveryResult | undefined {
    return this.result;
  }

  setAppliedRules(appliedRules: AppliedMockRule[]): void {
    this.appliedRules = normalizeAppliedRules(appliedRules);
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  removeAppliedRule(rule: Pick<MockRuleEntry, 'endpoint' | 'method' | 'rule'>): void {
    this.appliedRules = this.appliedRules.filter((entry) => !sameAppliedRule(entry, rule));
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  async refresh(): Promise<void> {
    await this.load();
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  private async load(): Promise<void> {
    const root = getWorkspaceRoot();
    this.result = root ? await this.service.discover(root) : undefined;
    this.loaded = true;
  }

  getTreeItem(element: MockTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'mockRoot': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.description = element.description;
        item.iconPath = new vscode.ThemeIcon('folder');
        return item;
      }
      case 'endpoint':
        return this.endpointItem(element);
      case 'rule':
        return this.ruleItem(element);
      case 'invalid':
        return invalidItem(element);
      case 'empty': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.description = element.description;
        item.iconPath = new vscode.ThemeIcon('info');
        item.command = element.command;
        return item;
      }
    }
  }

  async getChildren(element?: MockTreeNode): Promise<MockTreeNode[]> {
    if (!this.loaded) {
      await this.load();
    }

    if (!this.result) {
      return [{ kind: 'empty', label: 'Open a workspace to use Fliwright' }];
    }

    if (!element) {
      if (this.result.endpoints.length === 0 && this.result.invalid.length === 0) {
        return [
          {
            kind: 'empty',
            label: 'No mock configs',
            description: '.fliwright/mocks/api/*.json',
            command: {
              command: 'fliwright.createMockConfig',
              title: 'Create Mock Config',
            },
          },
        ];
      }
      return [...this.result.invalid, ...this.result.endpoints];
    }

    if (element.kind === 'endpoint') {
      const defaultRule = element.defaultRule ?? element.endpointFile.rules[0]?.name;
      return element.endpointFile.rules.map<MockRuleEntry>((rule) => {
        const applied = this.appliedRules.find((entry) => (
          entry.endpoint === element.endpointFile.endpoint
          && sameMethod(entry.method, element.endpointFile.method)
          && entry.ruleName === rule.name
        ));
        return {
          kind: 'rule',
          uri: element.uri,
          endpoint: element.endpointFile.endpoint,
          method: element.endpointFile.method,
          rule,
          isDefault: rule.name === defaultRule,
          applied: Boolean(applied),
          appliedAt: applied?.appliedAt,
        };
      });
    }

    return [];
  }

  private endpointItem(element: MockEndpointEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(
      `${element.endpointFile.method} ${element.endpointFile.endpoint}`,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    const appliedCount = this.appliedRules.filter((rule) => (
      rule.endpoint === element.endpointFile.endpoint && sameMethod(rule.method, element.endpointFile.method)
    )).length;
    item.description = `${element.endpointFile.rules.length} rules${appliedCount ? ` · ${appliedCount} active` : ''}`;
    item.tooltip = `${element.endpointFile.name}\n${element.uri.fsPath}`;
    item.contextValue = 'mockEndpoint';
    item.iconPath = new vscode.ThemeIcon(element.indexed ? 'server-process' : 'circle-outline');
    item.resourceUri = element.uri;
    return item;
  }

  private ruleItem(element: MockRuleEntry): vscode.TreeItem {
    const applied = this.findAppliedRule(element);
    const isApplied = Boolean(applied);
    const labels = [element.isDefault ? 'default' : '', isApplied ? 'active' : ''].filter(Boolean);
    const item = new vscode.TreeItem(element.rule.name, vscode.TreeItemCollapsibleState.None);
    item.description = `${element.rule.status}${labels.length ? ` · ${labels.join(' · ')}` : ''}`;
    item.tooltip = `${element.method} ${element.endpoint}\n${JSON.stringify(element.rule.body ?? {}, null, 2)}`;
    item.contextValue = isApplied ? 'mockRuleApplied' : 'mockRule';
    item.iconPath = new vscode.ThemeIcon(isApplied ? 'pass-filled' : statusIcon(element.rule.status));
    return item;
  }

  private findAppliedRule(element: MockRuleEntry): AppliedMockRule | undefined {
    return this.appliedRules.find((entry) => sameAppliedRule(entry, element));
  }
}

function sameAppliedRule(entry: AppliedMockRule, rule: Pick<MockRuleEntry, 'endpoint' | 'method' | 'rule'>): boolean {
  return entry.endpoint === rule.endpoint
    && sameMethod(entry.method, rule.method)
    && entry.ruleName === rule.rule.name;
}

function sameMethod(left: string, right: string): boolean {
  return left.toUpperCase() === right.toUpperCase();
}

function invalidItem(element: { label: string; error: string; uri: vscode.Uri }): vscode.TreeItem {
  const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
  item.description = element.error;
  item.tooltip = `${element.error}\n${element.uri.fsPath}`;
  item.contextValue = 'mockInvalid';
  item.iconPath = new vscode.ThemeIcon('warning');
  item.resourceUri = element.uri;
  return item;
}

function statusIcon(status: number): string {
  if (status >= 200 && status < 300) return 'check';
  if (status >= 400) return 'error';
  return 'circle-outline';
}

function normalizeAppliedRules(appliedRules: AppliedMockRule[]): AppliedMockRule[] {
  const latestByEndpoint = new Map<string, AppliedMockRule>();
  for (const rule of appliedRules) {
    const key = `${rule.method.toUpperCase()} ${rule.endpoint}`;
    const previous = latestByEndpoint.get(key);
    if (!previous || rule.appliedAt >= previous.appliedAt) {
      latestByEndpoint.set(key, rule);
    }
  }
  return Array.from(latestByEndpoint.values());
}

export function mockFileNameFromInput(input: string | undefined): string {
  const value = input?.trim() || 'example-api.json';
  return path.basename(value).endsWith('.json') ? path.basename(value) : `${path.basename(value)}.json`;
}
