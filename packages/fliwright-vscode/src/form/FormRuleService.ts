import * as path from 'node:path';
import * as vscode from 'vscode';
import { loadConfig, resolveWorkspacePath } from '../config.js';
import { jsonErrorMessage, readJson, writeJson } from '../json.js';
import type { FormDiscoveryResult, FormRulesEntry, FormRulesFile, InvalidFileEntry } from '../types.js';

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
          data: ['test.user@example.com', 'qa.user@example.com'],
        },
      ],
    });
    return uri;
  }

  private validateRulesFile(file: FormRulesFile): void {
    if (file.version !== 1) throw new Error('version must be 1');
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
      if (rule.type === 'REGEXP_MOCK' && typeof rule.pattern !== 'string') {
        throw new Error(`rules[${index}].pattern is required for REGEXP_MOCK`);
      }
      if ((rule.type === 'PRESET_SKILL' || rule.type === 'LLM_GENERATE') && rule.data !== undefined && !Array.isArray(rule.data)) {
        throw new Error(`rules[${index}].data must be an array`);
      }
    });
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

function ensureJsonFileName(fileName: string): string {
  const trimmed = path.basename(fileName.trim() || 'form-rules.json');
  return trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`;
}
