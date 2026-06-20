import * as fs from 'node:fs';
import * as path from 'node:path';
import RandExp from 'randexp';
import { Selector } from './Selector.js';
import { generateFormDataEntry } from './FormDataDsl.js';
import type { FormSkill, FormFieldMeta, FormRule, FormRulesFile, MatchCriteria, SemanticType } from './types.js';

export class JsonRuleLoader {
  private readonly projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
  }

  loadFromFile(filePath: string, dataIndex?: number): FormSkill[] {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as FormRulesFile;
      return this.parseRules(data, dataIndex);
    } catch {
      return [];
    }
  }

  loadFromDir(dirPath: string, dataIndex?: number): FormSkill[] {
    if (!fs.existsSync(dirPath)) return [];
    const skills: FormSkill[] = [];
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      if (entry.endsWith('.json')) {
        skills.push(...this.loadFromFile(path.join(dirPath, entry), dataIndex));
      }
    }
    return skills;
  }

  autoDiscover(dataIndex?: number): FormSkill[] {
    const skills: FormSkill[] = [];
    const workspaceFormsDir = path.join(this.projectRoot, '.fliwright', 'forms');
    skills.push(...this.loadFromDir(workspaceFormsDir, dataIndex));
    const singleFile = path.join(this.projectRoot, 'fliwright.form-rules.json');
    skills.push(...this.loadFromFile(singleFile, dataIndex));
    const rulesDir = path.join(this.projectRoot, 'fliwright.form-rules');
    skills.push(...this.loadFromDir(rulesDir, dataIndex));
    return skills;
  }

  private parseRules(data: FormRulesFile, dataIndex?: number): FormSkill[] {
    if (data.version !== 1) return [];
    return data.rules.map((rule) => this.ruleToSkill(rule, dataIndex));
  }

  private ruleToSkill(rule: FormRule, dataIndex?: number): FormSkill {
    const matchEntries = Object.entries(rule.match ?? {});
    const name = 'rule:' + matchEntries.map(([k, v]) => `${k}=${v}`).join(',');
    const find = rule.find ? new Selector(rule.find).toQuery() : undefined;

    if (rule.type === 'PRESET_SKILL' && rule.data && rule.data.length > 0) {
      const auto = dataIndex === undefined;
      let index = auto ? 0 : dataIndex;
      return {
        name,
        type: 'PRESET_SKILL',
        find,
        match: (field: FormFieldMeta) => this.matchesRule(field, rule),
        generate: (field, locale, options) => {
          const entry = rule.data![index % rule.data!.length];
          if (auto) index++;
          return generateFormDataEntry(entry, { field, locale, options });
        },
      };
    }

    if (rule.type === 'LLM_GENERATE' && rule.data) {
      const auto = dataIndex === undefined;
      let index = auto ? 0 : dataIndex;
      return {
        name,
        type: 'LLM_GENERATE',
        find,
        match: (field: FormFieldMeta) => this.matchesRule(field, rule),
        generate: (field, locale, options) => {
          const entry = rule.data![index % rule.data!.length];
          if (auto) index++;
          return generateFormDataEntry(entry, { field, locale, options });
        },
      };
    }

    if (rule.type === 'REGEXP_MOCK' && rule.pattern) {
      const randexp = new RandExp(new RegExp(rule.pattern));
      return {
        name,
        type: 'REGEXP_MOCK',
        find,
        match: (field: FormFieldMeta) => this.matchesRule(field, rule),
        generate: () => randexp.gen(),
      };
    }

    return {
      name,
      type: rule.type,
      match: () => false,
      generate: () => '',
    };
  }

  private matchesRule(field: FormFieldMeta & { semanticType?: SemanticType }, rule: FormRule): boolean {
    if (rule.find?.match && !this.matchesFindCriteria(field, rule.find.match)) {
      return false;
    }
    for (const [key, value] of Object.entries(rule.match ?? {})) {
      const actual = this.matchValue(field, key);
      if (actual === undefined || actual !== value) return false;
    }
    return true;
  }

  private matchesFindCriteria(
    field: FormFieldMeta & { semanticType?: SemanticType },
    match: MatchCriteria,
  ): boolean {
    for (const [key, value] of Object.entries(match)) {
      if (typeof value !== 'string') continue;
      const actual = this.matchValue(field, key);
      if (actual === undefined) continue;
      if (key === 'textContains') {
        if (!actual.includes(value)) return false;
      } else if (key === 'textRegex') {
        if (!new RegExp(value).test(actual)) return false;
      } else if (actual !== value) {
        return false;
      }
    }
    return true;
  }

  private matchValue(
    field: FormFieldMeta & { semanticType?: SemanticType },
    key: string,
  ): string | undefined {
    switch (key) {
      case 'id':
        return field.id;
      case 'selector':
        return field.selector;
      case 'type':
        return field.type;
      case 'controlType':
        return field.controlType;
      case 'hintText':
        return field.hintText;
      case 'label':
        return field.label;
      case 'keyboardType':
        return field.keyboardType;
      case 'key':
        return field.key;
      case 'ancestorKey':
        return field.ancestorKey;
      case 'name':
        return field.name;
      case 'semanticsId':
      case 'semanticIdentifier':
        return field.semanticsId;
      case 'semanticsLabel':
        return field.semanticsLabel;
      case 'semanticsHint':
        return field.semanticsHint;
      case 'role':
        return field.role;
      case 'semanticType':
        return field.semanticType;
      case 'value':
        return field.value == null ? undefined : String(field.value);
      case 'text':
      case 'textContains':
      case 'textRegex':
        return field.label ?? field.hintText ?? field.semanticsLabel ?? field.selector;
      default:
        return undefined;
    }
  }
}
