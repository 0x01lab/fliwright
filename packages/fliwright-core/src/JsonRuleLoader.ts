import * as fs from 'node:fs';
import * as path from 'node:path';
import RandExp from 'randexp';
import type { FormSkill, FormFieldMeta, FormRule, FormRulesFile, SemanticType } from './types.js';

export class JsonRuleLoader {
  private readonly projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
  }

  loadFromFile(filePath: string): FormSkill[] {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as FormRulesFile;
      return this.parseRules(data);
    } catch {
      return [];
    }
  }

  loadFromDir(dirPath: string): FormSkill[] {
    if (!fs.existsSync(dirPath)) return [];
    const skills: FormSkill[] = [];
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      if (entry.endsWith('.json')) {
        skills.push(...this.loadFromFile(path.join(dirPath, entry)));
      }
    }
    return skills;
  }

  autoDiscover(): FormSkill[] {
    const skills: FormSkill[] = [];
    const singleFile = path.join(this.projectRoot, 'fliwright.form-rules.json');
    skills.push(...this.loadFromFile(singleFile));
    const rulesDir = path.join(this.projectRoot, 'fliwright.form-rules');
    skills.push(...this.loadFromDir(rulesDir));
    return skills;
  }

  private parseRules(data: FormRulesFile): FormSkill[] {
    if (data.version !== 1) return [];
    return data.rules.map((rule) => this.ruleToSkill(rule));
  }

  private ruleToSkill(rule: FormRule): FormSkill {
    const matchEntries = Object.entries(rule.match);
    const name = 'rule:' + matchEntries.map(([k, v]) => `${k}=${v}`).join(',');

    if (rule.type === 'PRESET_SKILL' && rule.data && rule.data.length > 0) {
      let index = 0;
      return {
        name,
        type: 'PRESET_SKILL',
        match: (field: FormFieldMeta) => this.matchesRule(field, rule),
        generate: () => {
          const value = rule.data![index % rule.data!.length];
          index++;
          return value;
        },
      };
    }

    if (rule.type === 'LLM_GENERATE' && rule.data) {
      let index = 0;
      return {
        name,
        type: 'LLM_GENERATE',
        match: (field: FormFieldMeta) => this.matchesRule(field, rule),
        generate: () => {
          const value = rule.data![index % rule.data!.length];
          index++;
          return value;
        },
      };
    }

    if (rule.type === 'REGEXP_MOCK' && rule.pattern) {
      const randexp = new RandExp(new RegExp(rule.pattern));
      return {
        name,
        type: 'REGEXP_MOCK',
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
    for (const [key, value] of Object.entries(rule.match)) {
      const actual = this.matchValue(field, key);
      if (actual === undefined || actual !== value) return false;
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
      default:
        return undefined;
    }
  }
}
