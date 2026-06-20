import * as path from 'node:path';
import type * as vscode from 'vscode';
import type { FliwrightDriver, FormAnalyzeResult, FormFillResult, FormHelperOptions, SelectorQuery } from '@fliwright/core';
import {
  analyzeFormCapability,
  fillFormCapability,
  fillFormFieldsCapability,
} from '@fliwright/cli/capabilities/form';
import { loadConfig, resolveWorkspacePath } from '../config.js';
import type { FormRulesEntry, FormRule, FormRunSummary } from '../types.js';
import { formRuleFromAnalyzeField } from './FormRuleService.js';

export interface PreviewField {
  id: string;
  label: string;
  semanticType: string;
  generatedValue: string;
  masked: boolean;
}

export interface FormRuleSnippet {
  find: SelectorQuery;
  type: 'PRESET_SKILL';
  data: string[];
}

export class FormHelperService {
  private lastSummary: FormRunSummary | undefined;
  private lastAnalyze: FormAnalyzeResult | undefined;

  getLastSummary(): FormRunSummary | undefined {
    return this.lastSummary;
  }

  getLastAnalyze(): FormAnalyzeResult | undefined {
    return this.lastAnalyze;
  }

  async analyze(driver: FliwrightDriver, workspaceRoot: vscode.Uri, rulesFile?: FormRulesEntry, dataIndex?: number): Promise<FormAnalyzeResult> {
    const options = this.options(workspaceRoot, rulesFile, dataIndex);
    const result = await analyzeFormCapability(driver, options);
    this.lastAnalyze = result;
    this.lastSummary = {
      action: 'analyze',
      filePath: options.rulesFile,
      total: result.fields.length,
      ranAt: Date.now(),
    };
    return result;
  }

  async fill(driver: FliwrightDriver, workspaceRoot: vscode.Uri, rulesFile?: FormRulesEntry, dataIndex?: number): Promise<FormFillResult> {
    const options = this.options(workspaceRoot, rulesFile, dataIndex);
    const result = await fillFormCapability(driver, options);
    this.lastAnalyze = undefined;
    this.lastSummary = {
      action: 'fill',
      filePath: options.rulesFile,
      total: result.fields.length,
      filled: result.filled,
      skipped: result.skipped,
      errors: result.errors.length,
      ranAt: Date.now(),
    };
    return result;
  }

  async fillSelected(
    driver: FliwrightDriver,
    workspaceRoot: vscode.Uri,
    fieldHints: string[],
    rulesFile?: FormRulesEntry,
    dataIndex?: number,
  ): Promise<FormFillResult> {
    const options = this.options(workspaceRoot, rulesFile, dataIndex);
    const result = await fillFormFieldsCapability(driver, fieldHints, options);
    this.lastAnalyze = undefined;
    this.lastSummary = {
      action: 'fill',
      filePath: options.rulesFile,
      total: result.fields.length,
      filled: result.filled,
      skipped: result.skipped,
      errors: result.errors.length,
      ranAt: Date.now(),
    };
    return result;
  }

  previewFields(result: FormAnalyzeResult): PreviewField[] {
    return result.fields.map((field) => {
      const label = field.label ?? field.hintText ?? field.name ?? field.key ?? field.semanticsId ?? field.selector;
      const masked = isSensitiveField(label, field.semanticType, field.generatedValue);
      return {
        id: field.id,
        label,
        semanticType: field.semanticType,
        generatedValue: masked ? maskValue(field.generatedValue) : field.generatedValue,
        masked,
      };
    });
  }

  private options(workspaceRoot: vscode.Uri, rulesFile?: FormRulesEntry, dataIndex?: number): FormHelperOptions {
    const config = loadConfig();
    const configuredRulesFile = config.formRulesFile
      ? resolveWorkspacePath(workspaceRoot, config.formRulesFile).fsPath
      : undefined;
    const rulesDir = resolveWorkspacePath(workspaceRoot, config.formRulesDir).fsPath;
    return {
      rulesFile: rulesFile?.uri.fsPath ?? configuredRulesFile,
      rulesDir: rulesFile || configuredRulesFile ? undefined : rulesDir,
      locale: rulesFile?.rulesFile.locale ?? config.formLocale,
      skipObscureFields: true,
      requireRuleMatch: Boolean(rulesFile || configuredRulesFile),
      dataIndex,
    };
  }
}

function isSensitiveField(label: string, semanticType: string, value: string): boolean {
  const combined = `${label} ${semanticType}`.toLowerCase();
  return combined.includes('password')
    || combined.includes('passwd')
    || combined.includes('token')
    || combined.includes('secret')
    || combined.includes('密码')
    || looksLikeToken(value);
}

function looksLikeToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{24,}$/.test(value) || value.split('.').length === 3;
}

function maskValue(value: string): string {
  if (!value) return '<empty>';
  return '*'.repeat(Math.min(Math.max(value.length, 6), 12));
}

export function formRulesFileName(entry?: FormRulesEntry): string {
  return entry ? path.basename(entry.uri.fsPath) : 'configured rules';
}

/**
 * Returns the maximum data-set count across all PRESET_SKILL/LLM_GENERATE rules in a file.
 * Each rule's `data` array represents multiple data sets at the same index.
 * Returns 0 if no rules have a `data` array with more than one entry.
 */
export function dataSetCount(rules: FormRule[]): number {
  let max = 0;
  for (const rule of rules) {
    if ((rule.type === 'PRESET_SKILL' || rule.type === 'LLM_GENERATE') && rule.data && rule.data.length > 1) {
      if (rule.data.length > max) max = rule.data.length;
    }
  }
  return max;
}

/**
 * Builds QuickPick labels for each data set index.
 * Shows one line per rule that has multiple data entries, combining them into a single label.
 */
export interface DataSetLabel {
  index: number;
  label: string;
  description: string;
}

export function dataSetLabels(rules: FormRule[]): DataSetLabel[] {
  const count = dataSetCount(rules);
  if (count <= 1) return [];

  const results: DataSetLabel[] = [];
  for (let i = 0; i < count; i++) {
    const preview = rules
      .filter(r => (r.type === 'PRESET_SKILL' || r.type === 'LLM_GENERATE') && r.data && r.data[i] !== undefined)
      .map(r => r.data![i])
      .join(' / ');
    results.push({
      index: i,
      label: `Data Set ${i + 1}`,
      description: preview,
    });
  }
  return results;
}

export function formRuleSnippetForField(field: FormAnalyzeResult['fields'][number]): FormRuleSnippet {
  const rule = formRuleFromAnalyzeField(field);
  return {
    find: rule.find!,
    type: 'PRESET_SKILL',
    data: rule.data ?? [],
  };
}

export function formatFormFillDebug(result: FormFillResult): string[] {
  const lines = ['Form fill debug:'];
  for (const field of result.fields) {
    const error = result.errors.find((entry) => entry.fieldId === field.id)?.error;
    const value = field.generatedValue ? ` value=${JSON.stringify(field.generatedValue)}` : '';
    const errorText = error ? ` error=${error}` : '';
    const reason = field.reason ? ` reason=${field.reason}` : '';
    const metadata = [
      field.name ? `name=${field.name}` : '',
      field.key ? `key=${field.key}` : '',
      field.ancestorKey ? `ancestorKey=${field.ancestorKey}` : '',
      field.semanticsId ? `semanticsId=${field.semanticsId}` : '',
      field.semanticsLabel ? `semanticsLabel=${JSON.stringify(field.semanticsLabel)}` : '',
      field.role ? `role=${field.role}` : '',
    ].filter(Boolean).join(' ');
    const metadataText = metadata ? ` ${metadata}` : '';
    lines.push(
      `  - id=${field.id} selector=${field.selector} type=${field.semanticType} status=${field.status}${metadataText}${reason}${value}${errorText}`,
    );
  }
  return lines;
}
