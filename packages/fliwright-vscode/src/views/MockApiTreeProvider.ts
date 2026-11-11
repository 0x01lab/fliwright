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
  private searchFilter = '';
  private searchTerms: string[] = [];
  private activeOnlyFilter = false;

  constructor(private readonly service: MockConfigService) {}

  get currentResult(): MockDiscoveryResult | undefined {
    return this.result;
  }

  get filter(): string {
    return this.searchFilter;
  }

  get activeOnly(): boolean {
    return this.activeOnlyFilter;
  }

  setActiveOnly(value: boolean): void {
    if (value === this.activeOnlyFilter) return;
    this.activeOnlyFilter = value;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  setFilter(value: string): void {
    const filter = value.trim();
    if (filter === this.searchFilter) return;
    this.searchFilter = filter;
    this.searchTerms = filter.toLowerCase().split(/\s+/).filter(Boolean);
    this.onDidChangeTreeDataEmitter.fire(undefined);
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
      case 'runtimeRule': {
        const { activeRule } = element;
        const isApplied = this.appliedRules.some((entry) => (
          entry.endpoint === activeRule.endpoint
          && sameMethod(entry.method, activeRule.method)
          && entry.ruleName === activeRule.ruleName
        ));
        const external = activeRule.ruleName === '(external)';
        const item = new vscode.TreeItem(
          external ? 'External mock route' : activeRule.ruleName,
          vscode.TreeItemCollapsibleState.None,
        );
        item.description = `${isApplied ? 'active' : 'inactive'} · not in config`;
        item.tooltip = `${activeRule.method} ${activeRule.endpoint}\n${external
          ? 'Applied outside VS Code; the runtime route does not identify a configured rule.'
          : 'The active runtime rule is missing from this config file.'}\nUse Stop All Mock Routes to clear runtime routes.`;
        item.iconPath = new vscode.ThemeIcon(isApplied ? 'pass-filled' : 'circle-outline');
        item.contextValue = 'mockRuntimeRule';
        return item;
      }
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
      if (this.searchFilter || this.activeOnly) {
        const endpoints = this.result.endpoints.filter((endpoint) => {
          if (this.activeOnly) return this.endpointChildren(endpoint).length > 0;
          const text = this.endpointSearchText(endpoint);
          const activeRule = this.findEndpointAppliedRule(endpoint);
          return this.matches(text)
            || endpoint.endpointFile.rules.some((rule) => this.matches(`${text} ${rule.name}`))
            || Boolean(activeRule && this.matches(`${text} ${activeRule.ruleName}`));
        });
        const invalid = this.activeOnly ? [] : this.result.invalid.filter((entry) => this.matches(`${entry.label} ${entry.uri.fsPath} ${entry.error}`));
        if (!this.searchFilter) {
          return endpoints.length ? endpoints : [{ kind: 'empty', label: 'No active Mock APIs' }];
        }
        return [{
          kind: 'empty',
          label: endpoints.length + invalid.length ? 'Mock API search (click to clear)'
            : this.activeOnly ? 'No matching active Mock APIs' : 'No matching Mock APIs',
          description: this.searchFilter,
          command: { command: 'fliwright.clearMockApiSearch', title: 'Clear Mock API Search' },
        }, ...invalid, ...endpoints];
      }
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
      return this.endpointChildren(element);
    }

    return [];
  }

  private endpointChildren(element: MockEndpointEntry): MockTreeNode[] {
    const defaultRule = element.defaultRule ?? element.endpointFile.rules[0]?.name;
    const activeRule = this.findEndpointAppliedRule(element);
    const rules = element.endpointFile.rules.map<MockRuleEntry>((rule) => {
      const applied = activeRule?.ruleName === rule.name ? activeRule : undefined;
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
    // Keep the active choice visible even for endpoints with many scenarios.
    rules.sort((left, right) => Number(right.applied) - Number(left.applied));
    const children: MockTreeNode[] = activeRule && !rules.some((rule) => rule.applied)
      ? [{ kind: 'runtimeRule', activeRule }, ...rules]
      : rules;
    const text = this.endpointSearchText(element);
    return children.filter((node) => {
      const active = node.kind === 'runtimeRule' || (node.kind === 'rule' && node.applied);
      if (this.activeOnly && !active) return false;
      const ruleName = node.kind === 'rule' ? node.rule.name
        : node.kind === 'runtimeRule' ? node.activeRule.ruleName : '';
      return this.matches(`${text} ${ruleName}`);
    });
  }

  private endpointSearchText(element: MockEndpointEntry): string {
    const { method, endpoint, name } = element.endpointFile;
    return `${method} ${endpoint} ${name}`;
  }

  private matches(text: string): boolean {
    const normalized = text.toLowerCase();
    return this.searchTerms.every((term) => normalized.includes(term));
  }

  private endpointItem(element: MockEndpointEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(
      `${element.endpointFile.method} ${element.endpointFile.endpoint}`,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    const activeRule = this.findEndpointAppliedRule(element);
    const activeLabel = activeRule?.ruleName === '(external)' ? 'external route' : activeRule?.ruleName;
    item.description = `${element.endpointFile.rules.length} rules${activeRule ? ` · 1 active: ${activeLabel}` : ''}`;
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

  private findEndpointAppliedRule(element: MockEndpointEntry): AppliedMockRule | undefined {
    return this.appliedRules.find((rule) => (
      rule.endpoint === element.endpointFile.endpoint && sameMethod(rule.method, element.endpointFile.method)
    ));
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
