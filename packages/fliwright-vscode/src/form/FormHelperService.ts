import * as path from 'node:path';
import type * as vscode from 'vscode';
import type { FliwrightDriver, FormAnalyzeResult, FormFillResult, FormHelperOptions } from '@fliwright/core';
import { loadConfig, resolveWorkspacePath } from '../config.js';
import type { FormRulesEntry, FormRunSummary } from '../types.js';

export interface PreviewField {
  id: string;
  label: string;
  semanticType: string;
  generatedValue: string;
  masked: boolean;
}

export class FormHelperService {
  private lastSummary: FormRunSummary | undefined;

  getLastSummary(): FormRunSummary | undefined {
    return this.lastSummary;
  }

  async analyze(driver: FliwrightDriver, workspaceRoot: vscode.Uri, rulesFile?: FormRulesEntry): Promise<FormAnalyzeResult> {
    const options = this.options(workspaceRoot, rulesFile);
    const result = await driver.page.formHelper.analyze(options);
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
    const result = await driver.page.formHelper.fill(options);
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
    const result = await driver.page.formHelper.fillFields(fieldHints, options);
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
      const label = field.label ?? field.hintText ?? field.selector;
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
