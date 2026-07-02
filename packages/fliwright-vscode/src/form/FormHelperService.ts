import * as path from 'node:path';
import type * as vscode from 'vscode';
import type { FliwrightDriver, FormAnalyzeResult, FormFillResult, FormHelperOptions, SelectorQuery } from '@fliwright/core';
import {
  analyzeFormCapability,
  fillFormCapability,
  fillFormFieldsCapability,
} from '@fliwright/cli/capabilities/form';
import { loadConfig, resolveWorkspacePath } from '../config.js';
import type { FormRuleDataEntry, FormRulesEntry, FormRule, FormRulesFile, FormRunSummary } from '../types.js';
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
  data: FormRuleDataEntry[];
}

export class FormHelperService {
  private lastSummary: FormRunSummary | undefined;
  private lastAnalyze: FormAnalyzeResult | undefined;
  private debugLog: ((message: string) => void) | undefined;

  setDebugLogger(logger: ((message: string) => void) | undefined): void {
    this.debugLog = logger;
  }

  getLastSummary(): FormRunSummary | undefined {
    return this.lastSummary;
  }

  getLastAnalyze(): FormAnalyzeResult | undefined {
    return this.lastAnalyze;
  }

  async analyze(driver: FliwrightDriver, workspaceRoot: vscode.Uri, rulesFile?: FormRulesEntry, dataIndex?: number): Promise<FormAnalyzeResult> {
    const options = this.options(workspaceRoot, rulesFile, dataIndex);
    const result = await this.runOperation(
      'analyze',
      options,
      () => analyzeFormCapability(driver, options),
      { rulesFile, dataIndex },
    );
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
    const result = await this.runOperation(
      'fill',
      options,
      () => fillFormCapability(driver, options),
      { rulesFile, dataIndex },
    );
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
    const result = await this.runOperation(
      'fillSelected',
      options,
      () => fillFormFieldsCapability(driver, fieldHints, options),
      { rulesFile, dataIndex, fieldHints },
    );
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
      const generatedValue = formatGeneratedValue(field.generatedValue);
      const masked = isSensitiveField(label, field.semanticType, generatedValue);
      return {
        id: field.id,
        label,
        semanticType: field.semanticType,
        generatedValue: masked ? maskValue(generatedValue) : generatedValue,
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

  private async runOperation<T>(
    operation: 'analyze' | 'fill' | 'fillSelected',
    options: FormHelperOptions,
    run: () => Promise<T>,
    context: { rulesFile?: FormRulesEntry; dataIndex?: number; fieldHints?: string[] },
  ): Promise<T> {
    const config = loadConfig();
    const timeoutMs = normalizeTimeout(config.formOperationTimeoutMs);
    const start = Date.now();
    this.logDebug(`${operation} started ${formatOperationContext(options, context)}`);

    try {
      const result = await withTimeout(run(), timeoutMs, () => (
        `FormHelper ${operation} timed out after ${timeoutMs}ms. `
        + `This usually means a VM Service extension call did not return; check the Flutter debug console for bridge logs and try narrowing the selected fields. `
        + formatOperationContext(options, context)
      ));
      this.logDebug(`${operation} finished in ${Date.now() - start}ms ${formatResultSummary(result)}`);
      return result;
    } catch (error) {
      this.logDebug(`${operation} failed after ${Date.now() - start}ms: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private logDebug(message: string): void {
    if (!loadConfig().formDebug) return;
    this.debugLog?.(`[FormHelperDebug] ${new Date().toISOString()} ${message}`);
  }
}

function normalizeTimeout(value: number): number {
  return Number.isFinite(value) && value >= 1000 ? value : 60_000;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: () => string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message())), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function formatOperationContext(
  options: FormHelperOptions,
  context: { rulesFile?: FormRulesEntry; dataIndex?: number; fieldHints?: string[] },
): string {
  const parts = [
    `rules=${context.rulesFile ? formRulesFileName(context.rulesFile) : options.rulesFile ?? options.rulesDir ?? 'auto'}`,
    `locale=${options.locale ?? 'default'}`,
    `requireRuleMatch=${options.requireRuleMatch === true}`,
  ];
  if (context.dataIndex !== undefined) parts.push(`dataIndex=${context.dataIndex}`);
  if (context.fieldHints) {
    parts.push(`selected=${context.fieldHints.length}`);
    parts.push(`hints=${context.fieldHints.map(quoteDebugValue).join(', ')}`);
  }
  return parts.join(' ');
}

function formatResultSummary(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const value = result as Partial<FormAnalyzeResult & FormFillResult>;
  if (Array.isArray(value.fields) && typeof value.filled === 'number') {
    return `fields=${value.fields.length} filled=${value.filled} skipped=${value.skipped ?? 0} errors=${value.errors?.length ?? 0}`;
  }
  if (Array.isArray(value.fields)) return `fields=${value.fields.length}`;
  return '';
}

function quoteDebugValue(value: string): string {
  const trimmed = value.length > 80 ? `${value.slice(0, 77)}...` : value;
  return JSON.stringify(trimmed);
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
  const text = formatGeneratedValue(value);
  return /^[A-Za-z0-9_-]{24,}$/.test(text) || text.split('.').length === 3;
}

function maskValue(value: string): string {
  if (!value) return '<empty>';
  return '*'.repeat(Math.min(Math.max(value.length, 6), 12));
}

export function formRulesFileName(entry?: FormRulesEntry): string {
  return entry ? path.basename(entry.uri.fsPath) : 'configured rules';
}

/**
 * Returns the number of selectable form data scenarios.
 * Prefer top-level `formData`; rule-level arrays are only used for files that have not migrated yet.
 */
export function dataSetCount(source: FormRule[] | FormRulesFile): number {
  if (!Array.isArray(source) && source.formData) return source.formData.length;
  const rules = Array.isArray(source) ? source : source.rules;
  let max = 0;
  for (const rule of rules) {
    if ((rule.type === 'PRESET_SKILL' || rule.type === 'LLM_GENERATE') && rule.data && rule.data.length > 1) {
      if (rule.data.length > max) max = rule.data.length;
    }
  }
  return max;
}

/**
 * Builds QuickPick labels for each form data scenario.
 * Top-level `formData` entries can provide human-readable names and notes.
 */
export interface DataSetLabel {
  index: number;
  label: string;
  description: string;
}

export function dataSetLabels(source: FormRule[] | FormRulesFile): DataSetLabel[] {
  if (!Array.isArray(source) && source.formData) {
    if (source.formData.length <= 1) return [];
    return source.formData.map((scenario, index) => ({
      index,
      label: scenario.name?.trim() || `Data Set ${index + 1}`,
      description: scenario.note?.trim() || scenario.description?.trim() || formDataPreview(scenario.values),
    }));
  }

  const rules = Array.isArray(source) ? source : source.rules;
  const count = dataSetCount(rules);
  if (count <= 1) return [];

  const results: DataSetLabel[] = [];
  for (let i = 0; i < count; i++) {
    const preview = rules
      .filter(r => (r.type === 'PRESET_SKILL' || r.type === 'LLM_GENERATE') && r.data && r.data[i] !== undefined)
      .map(r => r.data![i])
      .map(formatGeneratedValue)
      .join(' / ');
    results.push({
      index: i,
      label: `Data Set ${i + 1}`,
      description: preview,
    });
  }
  return results;
}

function formDataPreview(values: Record<string, unknown>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}: ${formatGeneratedValue(value)}`)
    .join(' / ');
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
    const generatedValue = formatGeneratedValue(field.generatedValue);
    const value = generatedValue ? ` value=${JSON.stringify(generatedValue)}` : '';
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

function formatGeneratedValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => formatGeneratedValue(entry)).join(',');
  if (value == null) return '';
  if (typeof value === 'object') {
    const entry = value as Record<string, unknown>;
    if (entry.value !== undefined) return formatGeneratedValue(entry.value);
    if (entry.fixed !== undefined) return formatGeneratedValue(entry.fixed);
  }
  return String(value);
}
