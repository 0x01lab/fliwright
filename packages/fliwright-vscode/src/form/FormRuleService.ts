import * as path from 'node:path';
import * as vscode from 'vscode';
import { loadConfig, resolveWorkspacePath } from '../config.js';
import { jsonErrorMessage, readJson, writeJson } from '../json.js';
import type { FormAnalyzeResult } from '@fliwright/core';
import type { FormDiscoveryResult, FormRule, FormRulesEntry, FormRulesFile, InvalidFileEntry } from '../types.js';

const RULE_TYPES = new Set(['PRESET_SKILL', 'REGEXP_MOCK', 'LLM_GENERATE']);
const MATCH_KEYS = new Set([
  'id',
  'selector',
  'type',
  'hintText',
  'label',
  'keyboardType',
  'key',
  'ancestorKey',
  'name',
  'semanticsId',
  'semanticsLabel',
  'semanticsHint',
  'role',
  'semanticType',
]);
const FIND_MATCH_KEYS = new Set([
  'type',
  'key',
  'id',
  'name',
  'ancestorKey',
  'text',
  'textContains',
  'textRegex',
  'semanticIdentifier',
  'semanticsLabel',
  'semanticsHint',
  'role',
]);
const FIND_FALLBACK_KEYS = new Set(['semanticsLabel', 'semanticsHint', 'hintText', 'textContains']);

export class FormRuleService {
  async discover(workspaceRoot: vscode.Uri): Promise<FormDiscoveryResult> {
    const config = loadConfig();
    const root = resolveWorkspacePath(workspaceRoot, config.formRulesDir);
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceRoot, `${config.formRulesDir.replace(/\\/g, '/')}/*.json`),
    );
    const files: FormRulesEntry[] = [];
    const invalid: InvalidFileEntry[] = [];

    for (const uri of uris) {
      try {
        const rulesFile = await readJson<FormRulesFile>(uri);
        this.validateRulesFile(rulesFile);
        files.push({ kind: 'formRulesFile', uri, rulesFile });
      } catch (error) {
        invalid.push({
          kind: 'invalid',
          uri,
          label: path.basename(uri.path),
          error: jsonErrorMessage(error),
        });
      }
    }

    files.sort((a, b) => path.basename(a.uri.path).localeCompare(path.basename(b.uri.path)));
    invalid.sort((a, b) => a.label.localeCompare(b.label));
    return { root, files, invalid };
  }

  async createTemplate(workspaceRoot: vscode.Uri, fileName = 'form-rules.json'): Promise<vscode.Uri> {
    const config = loadConfig();
    const root = resolveWorkspacePath(workspaceRoot, config.formRulesDir);
    await vscode.workspace.fs.createDirectory(root);
    const uri = vscode.Uri.joinPath(root, ensureJsonFileName(fileName));
    await writeJson(uri, {
      version: 1,
      locale: 'zh-CN',
      formData: [
        {
          name: 'Default QA account',
          note: 'Happy path form fill values',
          values: {
            email: 'test.user@example.com',
          },
        },
        {
          name: 'Alternate QA account',
          note: 'Use when the default account is already registered',
          values: {
            email: 'qa.user@example.com',
          },
        },
      ],
      rules: [
        {
          find: {
            match: {
              textContains: '手机号',
            },
            fallback: {
              hintText: '手机号',
            },
          },
          type: 'REGEXP_MOCK',
          pattern: '1[3-9][0-9]{9}',
        },
        {
          find: {
            match: {
              textContains: '邮箱',
            },
            fallback: {
              hintText: '邮箱',
              semanticsLabel: '邮箱',
            },
          },
          type: 'PRESET_SKILL',
          dataKey: 'email',
        },
      ],
    });
    return uri;
  }

  async createFromAnalyzeFields(
    workspaceRoot: vscode.Uri,
    fileName: string,
    fields: FormAnalyzeResult['fields'],
  ): Promise<vscode.Uri> {
    const uri = await this.createEmptyRulesFile(workspaceRoot, fileName);
    await this.appendAnalyzeFields(uri, fields);
    return uri;
  }

  async appendAnalyzeFields(
    uri: vscode.Uri,
    fields: FormAnalyzeResult['fields'],
  ): Promise<number> {
    const file = await readJson<FormRulesFile>(uri);
    this.validateRulesFile(file);
    const existing = new Set(file.rules.map(ruleIdentity));
    const nextRules = fields
      .map(formRuleFromAnalyzeField)
      .filter((rule) => !existing.has(ruleIdentity(rule)));
    file.rules.push(...nextRules);
    await writeJson(uri, file);
    return nextRules.length;
  }

  private async createEmptyRulesFile(workspaceRoot: vscode.Uri, fileName: string): Promise<vscode.Uri> {
    const config = loadConfig();
    const root = resolveWorkspacePath(workspaceRoot, config.formRulesDir);
    await vscode.workspace.fs.createDirectory(root);
    const uri = vscode.Uri.joinPath(root, ensureJsonFileName(fileName));
    await writeJson(uri, {
      version: 1,
      locale: config.formLocale,
      rules: [],
    });
    return uri;
  }

  private validateRulesFile(file: FormRulesFile): void {
    if (file.version !== 1) throw new Error('version must be 1');
    if (file.formData !== undefined) this.validateFormData(file.formData);
    if (!Array.isArray(file.rules)) throw new Error('rules must be an array');
    file.rules.forEach((rule, index) => {
      if (!rule.find && !rule.match) {
        throw new Error(`rules[${index}].find or match is required`);
      }
      if (rule.find !== undefined) {
        this.validateFind(rule.find, index);
      }
      if (rule.match !== undefined) {
        if (typeof rule.match !== 'object' || Array.isArray(rule.match)) {
          throw new Error(`rules[${index}].match must be an object`);
        }
        for (const [key, value] of Object.entries(rule.match)) {
          if (!MATCH_KEYS.has(key)) {
            throw new Error(`rules[${index}].match.${key} is not supported`);
          }
          if (typeof value !== 'string') {
            throw new Error(`rules[${index}].match.${key} must be a string`);
          }
        }
      }
      if (!RULE_TYPES.has(rule.type)) {
        throw new Error(`rules[${index}].type must be PRESET_SKILL, REGEXP_MOCK, or LLM_GENERATE`);
      }
      if (rule.dataKey !== undefined && typeof rule.dataKey !== 'string') {
        throw new Error(`rules[${index}].dataKey must be a string`);
      }
      if (rule.type === 'REGEXP_MOCK' && typeof rule.pattern !== 'string') {
        throw new Error(`rules[${index}].pattern is required for REGEXP_MOCK`);
      }
      if ((rule.type === 'PRESET_SKILL' || rule.type === 'LLM_GENERATE') && rule.data !== undefined && !Array.isArray(rule.data)) {
        throw new Error(`rules[${index}].data must be an array`);
      }
      if (rule.action !== undefined) {
        this.validateAction(rule.action, index);
      }
    });
  }

  private validateFormData(formData: unknown): void {
    if (!Array.isArray(formData)) throw new Error('formData must be an array');
    formData.forEach((scenario, index) => {
      if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
        throw new Error(`formData[${index}] must be an object`);
      }
      const value = scenario as Record<string, unknown>;
      for (const key of ['name', 'description', 'note']) {
        if (value[key] !== undefined && typeof value[key] !== 'string') {
          throw new Error(`formData[${index}].${key} must be a string`);
        }
      }
      if (!value.values || typeof value.values !== 'object' || Array.isArray(value.values)) {
        throw new Error(`formData[${index}].values must be an object`);
      }
    });
  }

  private validateAction(action: unknown, index: number): void {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      throw new Error(`rules[${index}].action must be an object`);
    }
    const value = action as Record<string, unknown>;
    if (typeof value.script !== 'string' || value.script.length === 0) {
      throw new Error(`rules[${index}].action.script must be a string`);
    }
    if (value.args !== undefined && (!value.args || typeof value.args !== 'object' || Array.isArray(value.args))) {
      throw new Error(`rules[${index}].action.args must be an object`);
    }
  }

  private validateFind(find: unknown, index: number): void {
    if (!find || typeof find !== 'object' || Array.isArray(find)) {
      throw new Error(`rules[${index}].find must be an object`);
    }
    const query = find as Record<string, unknown>;
    if (query.match !== undefined) {
      this.validateStringObject(query.match, FIND_MATCH_KEYS, `rules[${index}].find.match`);
    }
    if (query.fallback !== undefined) {
      this.validateStringObject(query.fallback, FIND_FALLBACK_KEYS, `rules[${index}].find.fallback`);
    }
    if (query.within !== undefined) {
      this.validateFind(query.within, index);
    }
    if (query.or !== undefined) {
      if (!Array.isArray(query.or)) throw new Error(`rules[${index}].find.or must be an array`);
      for (const entry of query.or) this.validateFind(entry, index);
    }
    if (query.and !== undefined) {
      if (!Array.isArray(query.and)) throw new Error(`rules[${index}].find.and must be an array`);
      for (const entry of query.and) this.validateFind(entry, index);
    }
    if (query.position !== undefined && (typeof query.position !== 'object' || Array.isArray(query.position))) {
      throw new Error(`rules[${index}].find.position must be an object`);
    }
  }

  private validateStringObject(value: unknown, keys: Set<string>, path: string): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${path} must be an object`);
    }
    for (const [key, entry] of Object.entries(value)) {
      if (!keys.has(key)) {
        throw new Error(`${path}.${key} is not supported`);
      }
      if (typeof entry !== 'string') {
        throw new Error(`${path}.${key} must be a string`);
      }
    }
  }
}

export function formRuleFromAnalyzeField(field: FormAnalyzeResult['fields'][number]): FormRule {
  const rule: FormRule = {
    find: bestFindForField(field),
    type: 'PRESET_SKILL',
    data: field.generatedValue ? [field.generatedValue] : [],
  };
  const action = actionForAnalyzeField(field);
  if (action) rule.action = action;
  return rule;
}

function actionForAnalyzeField(field: FormAnalyzeResult['fields'][number]) {
  if (field.controlType !== 'select' || !field.semanticsId) return undefined;
  const optionSemanticId = optionSemanticIdTemplate(field);
  if (!optionSemanticId) return undefined;
  return {
    script: isLikelyMultiSelectField(field) ? 'multiSelect.byOptionSemantics' : 'select.byOptionSemantics',
    args: {
      open: { match: { semanticIdentifier: field.semanticsId } },
      optionSemanticId,
      ...(isLikelyMultiSelectField(field) ? { done: { match: { text: 'Done' } } } : {}),
    },
  };
}

function optionSemanticIdTemplate(field: FormAnalyzeResult['fields'][number]): string | undefined {
  const generated = field.generatedValue?.trim();
  const exact = generated
    ? field.options?.find((option) => option.value === generated || option.label === generated)
    : undefined;
  const sample = exact?.semanticsId ?? field.options?.find((option) => option.semanticsId)?.semanticsId;
  if (!sample) return undefined;
  const sampleValue = exact?.value ?? field.options?.find((option) => option.semanticsId === sample)?.value;
  if (sampleValue && sample.endsWith(`.${sampleValue}`)) {
    return `${sample.slice(0, -sampleValue.length)}\${value}`;
  }
  const sampleLabel = exact?.label ?? field.options?.find((option) => option.semanticsId === sample)?.label;
  if (sampleLabel && sample.endsWith(`.${sampleLabel}`)) {
    return `${sample.slice(0, -sampleLabel.length)}\${value}`;
  }
  return undefined;
}

function isLikelyMultiSelectField(field: FormAnalyzeResult['fields'][number]): boolean {
  const text = [
    field.name,
    field.label,
    field.hintText,
    field.semanticsId,
    field.semanticsLabel,
    field.semanticsHint,
  ].filter(Boolean).join(' ').toLowerCase();
  return text.includes('multiselect')
    || text.includes('multi select')
    || text.includes('multiple')
    || text.includes('jurisdictions');
}

function bestFindForField(field: FormAnalyzeResult['fields'][number]) {
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

function ruleIdentity(rule: FormRule): string {
  return JSON.stringify(rule.find ?? rule.match ?? {});
}

function ensureJsonFileName(fileName: string): string {
  const trimmed = path.basename(fileName.trim() || 'form-rules.json');
  return trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`;
}
