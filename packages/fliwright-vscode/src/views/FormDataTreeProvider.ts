import * as path from 'node:path';
import * as vscode from 'vscode';
import type { FormDiscoveryResult, FormRule, FormRuleEntry, FormRulesEntry, FormRunSummary, FormTreeNode } from '../types.js';
import { getWorkspaceRoot } from '../config.js';
import { FormRuleService } from '../form/FormRuleService.js';

export class FormDataTreeProvider implements vscode.TreeDataProvider<FormTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<FormTreeNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private result: FormDiscoveryResult | undefined;
  private lastSummary: FormRunSummary | undefined;
  private loaded = false;

  constructor(private readonly service: FormRuleService) {}

  setLastSummary(summary: FormRunSummary | undefined): void {
    this.lastSummary = summary;
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

  getTreeItem(element: FormTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'formRoot': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.description = element.description;
        item.iconPath = new vscode.ThemeIcon('history');
        return item;
      }
      case 'formRulesFile':
        return this.rulesFileItem(element);
      case 'formRule':
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

  async getChildren(element?: FormTreeNode): Promise<FormTreeNode[]> {
    if (!this.loaded) {
      await this.load();
    }

    if (!this.result) {
      return [{ kind: 'empty', label: 'Open a workspace to use Fliwright' }];
    }

    if (!element) {
      if (this.result.files.length === 0 && this.result.invalid.length === 0) {
        return [
          {
            kind: 'empty',
            label: 'No form rules',
            description: '.fliwright/forms/*.json',
            command: {
              command: 'fliwright.createFormRules',
              title: 'Create Form Rules',
            },
          },
        ];
      }
      const summary = this.lastSummary ? [{
        kind: 'formRoot' as const,
        label: this.lastSummary.action === 'analyze' ? 'Last analyze' : 'Last fill',
        description: summaryDescription(this.lastSummary),
      }] : [];
      return [...summary, ...this.result.invalid, ...this.result.files];
    }

    if (element.kind === 'formRulesFile') {
      return element.rulesFile.rules.map<FormRuleEntry>((rule, index) => ({
        kind: 'formRule',
        uri: element.uri,
        rule,
        index,
      }));
    }

    return [];
  }

  private rulesFileItem(element: FormRulesEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(path.basename(element.uri.path), vscode.TreeItemCollapsibleState.Collapsed);
    item.description = `${element.rulesFile.rules.length} rules${element.rulesFile.locale ? ` · ${element.rulesFile.locale}` : ''}`;
    item.tooltip = element.uri.fsPath;
    item.contextValue = 'formRulesFile';
    item.iconPath = new vscode.ThemeIcon('symbol-field');
    item.resourceUri = element.uri;
    return item;
  }

  private ruleItem(element: FormRuleEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(ruleLabel(element.rule), vscode.TreeItemCollapsibleState.None);
    item.description = element.rule.type;
    item.tooltip = JSON.stringify(element.rule, null, 2);
    item.contextValue = 'formRule';
    item.iconPath = new vscode.ThemeIcon('symbol-string');
    return item;
  }
}

function invalidItem(element: { label: string; error: string; uri: vscode.Uri }): vscode.TreeItem {
  const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
  item.description = element.error;
  item.tooltip = `${element.error}\n${element.uri.fsPath}`;
  item.contextValue = 'formInvalid';
  item.iconPath = new vscode.ThemeIcon('warning');
  item.resourceUri = element.uri;
  return item;
}

function ruleLabel(rule: FormRule): string {
  const [key, value] = Object.entries(rule.match)[0] ?? ['match', '<empty>'];
  return `${key}=${value}`;
}

function summaryDescription(summary: FormRunSummary): string {
  if (summary.action === 'analyze') return `${summary.total} fields`;
  return `${summary.filled ?? 0} filled · ${summary.skipped ?? 0} skipped · ${summary.errors ?? 0} errors`;
}
