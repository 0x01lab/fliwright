import * as path from 'node:path';
import type * as vscode from 'vscode';
import type { FliwrightDriver, FormAnalyzeResult, FormFillResult, FormHelperOptions, SelectorQuery } from '@fliwright/core';
import {
  analyzeFormCapability,
  fillFormCapability,
  fillFormFieldsCapability,
} from '@fliwright/cli/capabilities/form';
import { loadConfig, resolveWorkspacePath } from '../config.js';
import type { FormRulesEntry, FormRunSummary } from '../types.js';

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

  async analyze(driver: FliwrightDriver, workspaceRoot: vscode.Uri, rulesFile?: FormRulesEntry): Promise<FormAnalyzeResult> {
    const options = this.options(workspaceRoot, rulesFile);
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

  async fill(driver: FliwrightDriver, workspaceRoot: vscode.Uri, rulesFile?: FormRulesEntry): Promise<FormFillResult> {
    const options = this.options(workspaceRoot, rulesFile);
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
  ): Promise<FormFillResult> {
    const options = this.options(workspaceRoot, rulesFile);
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

  private options(workspaceRoot: vscode.Uri, rulesFile?: FormRulesEntry): FormHelperOptions {
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

export function formRuleSnippetForField(field: FormAnalyzeResult['fields'][number]): FormRuleSnippet {
  return {
    find: bestFindForField(field),
    type: 'PRESET_SKILL',
    data: field.generatedValue ? [field.generatedValue] : [],
  };
}

function bestFindForField(field: FormAnalyzeResult['fields'][number]): SelectorQuery {
  if (field.semanticsId) return { match: { semanticIdentifier: field.semanticsId } };
  if (field.name) return { match: { name: field.name } };
  if (field.key) return { match: { key: field.key } };
  if (field.ancestorKey) {
    return {
      match: { textContains: field.label ?? field.hintText ?? field.name ?? field.key ?? field.id },
      within: { match: { key: field.ancestorKey } },
    };
  }
  if (field.label) return { match: { textContains: field.label }, fallback: { semanticsLabel: field.label } };
  if (field.hintText) return { match: { textContains: field.hintText }, fallback: { hintText: field.hintText } };
  return { match: { id: field.id } };
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
