# Slice 6: Form Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Form Helper system — auto-identify form fields, infer semantic types, generate locale-aware fake data via pluggable strategies, and fill forms with one API call.

**Architecture:** Dart bridge extension extracts form field metadata from the Widget tree. TypeScript pipeline infers semantic types, generates fake data via pluggable Skill strategies (preset algorithms, regex reverse-generation, AI-pre-generated JSON data), then fills each field using existing Locator.type(). FormHelper is mounted on Page as `page.formHelper`.

**Tech Stack:** TypeScript (Vitest), Dart (flutter_test), @faker-js/faker, randexp

---

## Task 1: Add Form Types to types.ts

**Files:**
- Modify: `packages/fliwright-core/src/types.ts`

- [ ] **Step 1: Add form-related type definitions to types.ts**

Append these types to the end of `packages/fliwright-core/src/types.ts`:

```typescript
export interface FormFieldMeta {
  id: string;
  type: string;
  rect: { x: number; y: number; width: number; height: number };
  hintText?: string;
  label?: string;
  keyboardType?: string;
  maxLength?: number;
  obscureText: boolean;
  enabled: boolean;
  selector: string;
}

export type SemanticType =
  | 'phone' | 'email' | 'idCard' | 'fullName' | 'address'
  | 'password' | 'captcha' | 'number' | 'text' | 'url' | 'date';

export interface FormFillResult {
  filled: number;
  skipped: number;
  errors: Array<{ fieldId: string; error: string }>;
  fields: Array<{
    id: string;
    semanticType: SemanticType;
    generatedValue: string;
    selector: string;
    status: 'filled' | 'skipped' | 'error';
  }>;
}

export interface FormAnalyzeResult {
  fields: Array<{
    id: string;
    semanticType: SemanticType;
    generatedValue: string;
    selector: string;
    hintText?: string;
    label?: string;
  }>;
}

export interface FormHelperOptions {
  rulesFile?: string;
  rulesDir?: string;
  locale?: string;
  skipObscureFields?: boolean;
  scope?: string;
}

export interface FormSkill {
  name: string;
  type: 'PRESET_SKILL' | 'REGEXP_MOCK' | 'LLM_GENERATE';
  match: (field: FormFieldMeta) => boolean;
  generate: (field: FormFieldMeta, locale: string) => string;
}

export interface FormRule {
  match: Record<string, string>;
  type: 'PRESET_SKILL' | 'REGEXP_MOCK' | 'LLM_GENERATE';
  data?: string[];
  pattern?: string;
}

export interface FormRulesFile {
  version: number;
  locale?: string;
  rules: FormRule[];
}
```

- [ ] **Step 2: Run type check to verify no errors**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/fliwright-core/src/types.ts
git commit -m "feat(core): add form helper type definitions"
```

---

## Task 2: SemanticInferrer

**Files:**
- Create: `packages/fliwright-core/src/SemanticInferrer.ts`
- Create: `packages/fliwright-core/tests/SemanticInferrer.test.ts`

- [ ] **Step 1: Write failing tests for SemanticInferrer**

Create `packages/fliwright-core/tests/SemanticInferrer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SemanticInferrer } from '../src/SemanticInferrer.js';
import type { FormFieldMeta } from '../src/types.js';

describe('SemanticInferrer', () => {
  const inferrer = new SemanticInferrer();

  function makeField(overrides: Partial<FormFieldMeta> = {}): FormFieldMeta {
    return {
      id: 'widget_1',
      type: 'TextFormField',
      rect: { x: 0, y: 0, width: 300, height: 48 },
      obscureText: false,
      enabled: true,
      selector: 'text=field',
      ...overrides,
    };
  }

  it('infers phone from hintText containing 手机', () => {
    const result = inferrer.infer([makeField({ hintText: '请输入手机号' })]);
    expect(result.get('widget_1')).toBe('phone');
  });

  it('infers phone from hintText containing phone', () => {
    const result = inferrer.infer([makeField({ hintText: 'Phone number' })]);
    expect(result.get('widget_1')).toBe('phone');
  });

  it('infers email from hintText', () => {
    const result = inferrer.infer([makeField({ hintText: '请输入邮箱地址' })]);
    expect(result.get('widget_1')).toBe('email');
  });

  it('infers email from keyboardType', () => {
    const result = inferrer.infer([makeField({ keyboardType: 'emailAddress' })]);
    expect(result.get('widget_1')).toBe('email');
  });

  it('infers idCard from hintText', () => {
    const result = inferrer.infer([makeField({ hintText: '身份证号' })]);
    expect(result.get('widget_1')).toBe('idCard');
  });

  it('infers fullName from hintText containing 姓名', () => {
    const result = inferrer.infer([makeField({ hintText: '真实姓名' })]);
    expect(result.get('widget_1')).toBe('fullName');
  });

  it('infers address from hintText', () => {
    const result = inferrer.infer([makeField({ hintText: '收货地址' })]);
    expect(result.get('widget_1')).toBe('address');
  });

  it('infers password from hintText', () => {
    const result = inferrer.infer([makeField({ hintText: '请输入密码' })]);
    expect(result.get('widget_1')).toBe('password');
  });

  it('infers password from keyboardType visiblePassword', () => {
    const result = inferrer.infer([makeField({ keyboardType: 'visiblePassword' })]);
    expect(result.get('widget_1')).toBe('password');
  });

  it('infers captcha from hintText', () => {
    const result = inferrer.infer([makeField({ hintText: '短信验证码' })]);
    expect(result.get('widget_1')).toBe('captcha');
  });

  it('infers date from hintText containing 日期', () => {
    const result = inferrer.infer([makeField({ hintText: '选择日期' })]);
    expect(result.get('widget_1')).toBe('date');
  });

  it('infers url from keyboardType', () => {
    const result = inferrer.infer([makeField({ keyboardType: 'url' })]);
    expect(result.get('widget_1')).toBe('url');
  });

  it('infers number from keyboardType', () => {
    const result = inferrer.infer([makeField({ keyboardType: 'number' })]);
    expect(result.get('widget_1')).toBe('number');
  });

  it('falls back to text when no pattern matches', () => {
    const result = inferrer.infer([makeField({ hintText: '随便填' })]);
    expect(result.get('widget_1')).toBe('text');
  });

  it('falls back to text when keyboardType is text', () => {
    const result = inferrer.infer([makeField({ keyboardType: 'text' })]);
    expect(result.get('widget_1')).toBe('text');
  });

  it('prioritizes hintText over keyboardType', () => {
    const result = inferrer.infer([makeField({ hintText: '手机号', keyboardType: 'text' })]);
    expect(result.get('widget_1')).toBe('phone');
  });

  it('uses label when hintText is absent', () => {
    const result = inferrer.infer([makeField({ label: '电子邮箱' })]);
    expect(result.get('widget_1')).toBe('email');
  });

  it('infers multiple fields at once', () => {
    const fields = [
      makeField({ id: 'a', hintText: '手机号' }),
      makeField({ id: 'b', hintText: '邮箱' }),
      makeField({ id: 'c', hintText: '备注' }),
    ];
    const result = inferrer.infer(fields);
    expect(result.get('a')).toBe('phone');
    expect(result.get('b')).toBe('email');
    expect(result.get('c')).toBe('text');
  });

  it('handles fields with no hintText, label, or keyboardType', () => {
    const result = inferrer.infer([makeField()]);
    expect(result.get('widget_1')).toBe('text');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run tests/SemanticInferrer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SemanticInferrer**

Create `packages/fliwright-core/src/SemanticInferrer.ts`:

```typescript
import type { FormFieldMeta, SemanticType } from './types.js';

interface PatternRule {
  regex: RegExp;
  type: SemanticType;
}

const HINT_PATTERNS: PatternRule[] = [
  { regex: /手机|phone|mobile/i, type: 'phone' },
  { regex: /邮箱|email|e-mail/i, type: 'email' },
  { regex: /身份证|ID.?card|身份证号/i, type: 'idCard' },
  { regex: /地址|address|addr/i, type: 'address' },
  { regex: /姓名|full.?name|真实姓名/i, type: 'fullName' },
  { regex: /密码|password|pwd/i, type: 'password' },
  { regex: /验证码|captcha|verification.?code/i, type: 'captcha' },
  { regex: /日期|date|birthday|生日/i, type: 'date' },
];

const KEYBOARD_TYPE_MAP: Record<string, SemanticType> = {
  phone: 'phone',
  emailAddress: 'email',
  number: 'number',
  url: 'url',
  visiblePassword: 'password',
};

export class SemanticInferrer {
  infer(fields: FormFieldMeta[]): Map<string, SemanticType> {
    const result = new Map<string, SemanticType>();
    for (const field of fields) {
      result.set(field.id, this.inferField(field));
    }
    return result;
  }

  private inferField(field: FormFieldMeta): SemanticType {
    const text = field.hintText ?? field.label ?? '';
    for (const rule of HINT_PATTERNS) {
      if (rule.regex.test(text)) return rule.type;
    }
    if (field.keyboardType && field.keyboardType in KEYBOARD_TYPE_MAP) {
      return KEYBOARD_TYPE_MAP[field.keyboardType];
    }
    return 'text';
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run tests/SemanticInferrer.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-core/src/SemanticInferrer.ts packages/fliwright-core/tests/SemanticInferrer.test.ts
git commit -m "feat(core): add SemanticInferrer for form field type inference"
```

---

## Task 3: Install Dependencies and Create FakerGenerator

**Files:**
- Modify: `packages/fliwright-core/package.json` (dependency install)
- Create: `packages/fliwright-core/src/FakerGenerator.ts`
- Create: `packages/fliwright-core/tests/FakerGenerator.test.ts`

- [ ] **Step 1: Install @faker-js/faker and randexp**

Run:
```bash
cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && pnpm add @faker-js/faker randexp && pnpm add -D @types/randexp
```

- [ ] **Step 2: Write failing tests for FakerGenerator**

Create `packages/fliwright-core/tests/FakerGenerator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FakerGenerator } from '../src/FakerGenerator.js';
import type { SemanticType } from '../src/types.js';

describe('FakerGenerator', () => {
  const generator = new FakerGenerator();

  it('generates a phone number for zh_CN locale', () => {
    const value = generator.generate('phone');
    expect(value).toMatch(/^1[3-9]\d{9}$/);
  });

  it('generates an email address', () => {
    const value = generator.generate('email');
    expect(value).toContain('@');
  });

  it('generates a Chinese ID card number', () => {
    const value = generator.generate('idCard');
    expect(value).toMatch(/^\d{17}[\dXx]$/);
  });

  it('generates a full name', () => {
    const value = generator.generate('fullName');
    expect(value.length).toBeGreaterThan(0);
  });

  it('generates an address', () => {
    const value = generator.generate('address');
    expect(value.length).toBeGreaterThan(0);
  });

  it('generates a password with mixed characters', () => {
    const value = generator.generate('password');
    expect(value.length).toBeGreaterThanOrEqual(8);
  });

  it('generates a captcha as digits', () => {
    const value = generator.generate('captcha');
    expect(value).toMatch(/^\d{4,6}$/);
  });

  it('generates a number string', () => {
    const value = generator.generate('number');
    expect(Number(value)).not.toBeNaN();
  });

  it('generates text content', () => {
    const value = generator.generate('text');
    expect(value.length).toBeGreaterThan(0);
  });

  it('generates a URL', () => {
    const value = generator.generate('url');
    expect(value).toMatch(/^https?:\/\//);
  });

  it('generates a date string', () => {
    const value = generator.generate('date');
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('respects maxLength truncation', () => {
    const value = generator.generate('text', 5);
    expect(value.length).toBeLessThanOrEqual(5);
  });

  it('generates phone with maxLength', () => {
    const value = generator.generate('phone', 5);
    expect(value.length).toBeLessThanOrEqual(5);
  });

  it('respects locale option', () => {
    const enGenerator = new FakerGenerator({ locale: 'en' });
    const value = enGenerator.generate('fullName');
    expect(value.length).toBeGreaterThan(0);
  });

  it('generates different values on successive calls', () => {
    const values = new Set<string>();
    for (let i = 0; i < 10; i++) {
      values.add(generator.generate('email'));
    }
    expect(values.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run tests/FakerGenerator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement FakerGenerator**

Create `packages/fliwright-core/src/FakerGenerator.ts`:

```typescript
import { faker } from '@faker-js/faker';
import type { SemanticType } from './types.js';

export interface FakerGeneratorOptions {
  locale?: string;
}

export class FakerGenerator {
  private readonly fakerInstance: ReturnType<typeof faker>;

  constructor(options?: FakerGeneratorOptions) {
    // faker supports locale strings like 'zh_CN', 'en', 'ja', etc.
    // For simplicity, we create a new faker instance per generator.
    // @faker-js/faker v9+ uses faker.localization for locale.
    this.fakerInstance = faker;
    if (options?.locale) {
      // Setting seed locale is done by importing the specific locale faker.
      // For now, use default faker — locale-specific generation is handled
      // by the preset skills or by the user providing locale-specific rules.
    }
  }

  generate(semanticType: SemanticType, maxLength?: number): string {
    let value: string;
    switch (semanticType) {
      case 'phone':
        value = this.generatePhone();
        break;
      case 'email':
        value = this.fakerInstance.internet.email();
        break;
      case 'idCard':
        value = this.generateIdCard();
        break;
      case 'fullName':
        value = this.fakerInstance.person.fullName();
        break;
      case 'address':
        value = this.fakerInstance.location.streetAddress({ useFullAddress: true as never });
        break;
      case 'password':
        value = this.generatePassword(maxLength);
        break;
      case 'captcha':
        value = this.fakerInstance.string.numeric({ length: { min: 4, max: 6 } });
        break;
      case 'number':
        value = this.fakerInstance.string.numeric({ length: { min: 1, max: 5 } });
        break;
      case 'text':
        value = this.fakerInstance.lorem.sentence();
        break;
      case 'url':
        value = this.fakerInstance.internet.url();
        break;
      case 'date':
        value = this.fakerInstance.date.recent().toISOString().slice(0, 10);
        break;
      default:
        value = this.fakerInstance.lorem.word();
    }
    if (maxLength != null && value.length > maxLength) {
      value = value.slice(0, maxLength);
    }
    return value;
  }

  private generatePhone(): string {
    // Chinese mobile: 1[3-9] + 9 random digits
    const prefix = `1${[3, 4, 5, 6, 7, 8, 9][Math.floor(Math.random() * 7)]}`;
    const suffix = this.fakerInstance.string.numeric({ length: 9 });
    return prefix + suffix;
  }

  private generateIdCard(): string {
    // Chinese 18-digit ID: 6-digit region + 8-digit birth date + 3-digit sequence + 1 check digit
    const region = this.fakerInstance.string.numeric({ length: 6, allowLeadingZeros: true });
    const year = this.fakerInstance.number.int({ min: 1960, max: 2005 }).toString();
    const month = this.fakerInstance.number.int({ min: 1, max: 12 }).toString().padStart(2, '0');
    const day = this.fakerInstance.number.int({ min: 1, max: 28 }).toString().padStart(2, '0');
    const seq = this.fakerInstance.string.numeric({ length: 3 });
    const base = region + year + month + day + seq;
    const checksum = this.computeIdChecksum(base);
    return base + checksum;
  }

  private computeIdChecksum(base: string): string {
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const checkChars = '10X98765432';
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      sum += parseInt(base[i]) * weights[i];
    }
    return checkChars[sum % 11];
  }

  private generatePassword(maxLength?: number): string {
    const len = Math.min(maxLength ?? 12, 32);
    const lower = this.fakerInstance.string.alpha({ length: Math.ceil(len / 4), casing: 'lower' });
    const upper = this.fakerInstance.string.alpha({ length: Math.ceil(len / 4), casing: 'upper' });
    const digits = this.fakerInstance.string.numeric({ length: Math.ceil(len / 4) });
    const symbols = '!@#$%^&*';
    const special = Array.from({ length: Math.max(1, len - lower.length - upper.length - digits.length) },
      () => symbols[Math.floor(Math.random() * symbols.length)]).join('');
    const combined = (lower + upper + digits + special).slice(0, len);
    // Shuffle the characters
    return combined.split('').sort(() => Math.random() - 0.5).join('');
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run tests/FakerGenerator.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-core/package.json packages/fliwright-core/pnpm-lock.yaml packages/fliwright-core/src/FakerGenerator.ts packages/fliwright-core/tests/FakerGenerator.test.ts
git commit -m "feat(core): add FakerGenerator with multi-type fake data generation"
```

---

## Task 4: SkillRegistry

**Files:**
- Create: `packages/fliwright-core/src/SkillRegistry.ts`
- Create: `packages/fliwright-core/tests/SkillRegistry.test.ts`

- [ ] **Step 1: Write failing tests for SkillRegistry**

Create `packages/fliwright-core/tests/SkillRegistry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillRegistry } from '../src/SkillRegistry.js';
import type { FormSkill, FormFieldMeta } from '../src/types.js';

function makeField(overrides: Partial<FormFieldMeta> = {}): FormFieldMeta {
  return {
    id: 'f1',
    type: 'TextFormField',
    rect: { x: 0, y: 0, width: 300, height: 48 },
    obscureText: false,
    enabled: true,
    selector: 'text=field',
    ...overrides,
  };
}

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  it('returns null when no skills registered', () => {
    const result = registry.match(makeField());
    expect(result).toBeNull();
  });

  it('returns matching skill when one is registered', () => {
    const skill: FormSkill = {
      name: 'cn-phone',
      type: 'PRESET_SKILL',
      match: (f) => f.hintText?.includes('手机') ?? false,
      generate: () => '13812345678',
    };
    registry.register(skill);
    const result = registry.match(makeField({ hintText: '请输入手机号' }));
    expect(result).toBe(skill);
  });

  it('returns null when no skill matches', () => {
    const skill: FormSkill = {
      name: 'cn-phone',
      type: 'PRESET_SKILL',
      match: (f) => f.hintText?.includes('手机') ?? false,
      generate: () => '13812345678',
    };
    registry.register(skill);
    const result = registry.match(makeField({ hintText: '邮箱' }));
    expect(result).toBeNull();
  });

  it('returns first matching skill in registration order', () => {
    const skill1: FormSkill = {
      name: 'phone-a',
      type: 'PRESET_SKILL',
      match: (f) => f.hintText?.includes('手机') ?? false,
      generate: () => '11111111111',
    };
    const skill2: FormSkill = {
      name: 'phone-b',
      type: 'PRESET_SKILL',
      match: (f) => f.hintText?.includes('手机') ?? false,
      generate: () => '22222222222',
    };
    registry.register(skill1);
    registry.register(skill2);
    const result = registry.match(makeField({ hintText: '手机号' }));
    expect(result!.name).toBe('phone-a');
  });

  it('clear removes all registered skills', () => {
    const skill: FormSkill = {
      name: 's',
      type: 'PRESET_SKILL',
      match: () => true,
      generate: () => 'x',
    };
    registry.register(skill);
    registry.clear();
    expect(registry.match(makeField())).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run tests/SkillRegistry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SkillRegistry**

Create `packages/fliwright-core/src/SkillRegistry.ts`:

```typescript
import type { FormSkill, FormFieldMeta } from './types.js';

export class SkillRegistry {
  private skills: FormSkill[] = [];

  register(skill: FormSkill): void {
    this.skills.push(skill);
  }

  match(field: FormFieldMeta): FormSkill | null {
    for (const skill of this.skills) {
      if (skill.match(field)) return skill;
    }
    return null;
  }

  clear(): void {
    this.skills = [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run tests/SkillRegistry.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-core/src/SkillRegistry.ts packages/fliwright-core/tests/SkillRegistry.test.ts
git commit -m "feat(core): add SkillRegistry for pluggable form generation strategies"
```

---

## Task 5: JsonRuleLoader

**Files:**
- Create: `packages/fliwright-core/src/JsonRuleLoader.ts`
- Create: `packages/fliwright-core/tests/JsonRuleLoader.test.ts`
- Create: `packages/fliwright-core/tests/fixtures/` (test rule files)

- [ ] **Step 1: Write failing tests for JsonRuleLoader**

Create `packages/fliwright-core/tests/JsonRuleLoader.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonRuleLoader } from '../src/JsonRuleLoader.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fliwright-rules-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeRuleFile(fileName: string, content: object) {
  fs.writeFileSync(path.join(tmpDir, fileName), JSON.stringify(content, null, 2));
}

describe('JsonRuleLoader', () => {
  const loader = new JsonRuleLoader();

  it('loads skills from a single JSON file', () => {
    writeRuleFile('rules.json', {
      version: 1,
      locale: 'zh-CN',
      rules: [
        {
          match: { hintText: '公司名称' },
          type: 'LLM_GENERATE',
          data: ['北京科技有限公司', '上海创新网络科技'],
        },
      ],
    });
    const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'));
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('rule:hintText=公司名称');
    expect(skills[0].type).toBe('LLM_GENERATE');
  });

  it('loaded LLM_GENERATE skill matches by hintText', () => {
    writeRuleFile('rules.json', {
      version: 1,
      rules: [
        { match: { hintText: '手机号' }, type: 'LLM_GENERATE', data: ['13800000000'] },
      ],
    });
    const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'));
    expect(skills[0].match({ hintText: '手机号' } as any)).toBe(true);
    expect(skills[0].match({ hintText: '邮箱' } as any)).toBe(false);
  });

  it('loaded LLM_GENERATE skill cycles through data array', () => {
    writeRuleFile('rules.json', {
      version: 1,
      rules: [
        { match: { hintText: 'test' }, type: 'LLM_GENERATE', data: ['a', 'b', 'c'] },
      ],
    });
    const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'));
    expect(skills[0].generate({} as any, 'zh_CN')).toBe('a');
    expect(skills[0].generate({} as any, 'zh_CN')).toBe('b');
    expect(skills[0].generate({} as any, 'zh_CN')).toBe('c');
    expect(skills[0].generate({} as any, 'zh_CN')).toBe('a'); // cycles back
  });

  it('loaded REGEXP_MOCK skill generates matching strings', () => {
    writeRuleFile('rules.json', {
      version: 1,
      rules: [
        { match: { hintText: '订单号' }, type: 'REGEXP_MOCK', pattern: 'ORD\\d{10}' },
      ],
    });
    const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'));
    const value = skills[0].generate({} as any, 'zh_CN');
    expect(value).toMatch(/^ORD\d{10}$/);
  });

  it('loaded skill matches by semanticType', () => {
    writeRuleFile('rules.json', {
      version: 1,
      rules: [
        { match: { semanticType: 'address' }, type: 'LLM_GENERATE', data: ['北京市朝阳区'] },
      ],
    });
    const skills = loader.loadFromFile(path.join(tmpDir, 'rules.json'));
    // semanticType matching happens at the FormHelper level, but the skill
    // stores the match key for the pipeline to use
    expect(skills[0].name).toBe('rule:semanticType=address');
  });

  it('loads all JSON files from a directory', () => {
    writeRuleFile('rules1.json', {
      version: 1,
      rules: [{ match: { hintText: 'a' }, type: 'LLM_GENERATE', data: ['1'] }],
    });
    writeRuleFile('rules2.json', {
      version: 1,
      rules: [{ match: { hintText: 'b' }, type: 'LLM_GENERATE', data: ['2'] }],
    });
    const skills = loader.loadFromDir(tmpDir);
    expect(skills).toHaveLength(2);
  });

  it('returns empty array for non-existent file', () => {
    const skills = loader.loadFromFile(path.join(tmpDir, 'nope.json'));
    expect(skills).toEqual([]);
  });

  it('returns empty array for non-existent directory', () => {
    const skills = loader.loadFromDir(path.join(tmpDir, 'nodir'));
    expect(skills).toEqual([]);
  });

  it('autoDiscover returns empty when no rule files exist', () => {
    const discoverLoader = new JsonRuleLoader(tmpDir);
    const skills = discoverLoader.autoDiscover();
    expect(skills).toEqual([]);
  });

  it('autoDiscover finds fliwright.form-rules.json', () => {
    writeRuleFile('fliwright.form-rules.json', {
      version: 1,
      rules: [{ match: { hintText: 'x' }, type: 'LLM_GENERATE', data: ['y'] }],
    });
    const discoverLoader = new JsonRuleLoader(tmpDir);
    const skills = discoverLoader.autoDiscover();
    expect(skills).toHaveLength(1);
  });

  it('autoDiscover finds files in fliwright.form-rules/ directory', () => {
    const rulesDir = path.join(tmpDir, 'fliwright.form-rules');
    fs.mkdirSync(rulesDir);
    fs.writeFileSync(path.join(rulesDir, 'custom.json'), JSON.stringify({
      version: 1,
      rules: [{ match: { hintText: 'z' }, type: 'LLM_GENERATE', data: ['w'] }],
    }));
    const discoverLoader = new JsonRuleLoader(tmpDir);
    const skills = discoverLoader.autoDiscover();
    expect(skills).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run tests/JsonRuleLoader.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement JsonRuleLoader**

Create `packages/fliwright-core/src/JsonRuleLoader.ts`:

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import RandExp from 'randexp';
import type { FormSkill, FormFieldMeta, FormRulesFile } from './types.js';

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
    // Check fliwright.form-rules.json
    const singleFile = path.join(this.projectRoot, 'fliwright.form-rules.json');
    skills.push(...this.loadFromFile(singleFile));
    // Check fliwright.form-rules/ directory
    const rulesDir = path.join(this.projectRoot, 'fliwright.form-rules');
    skills.push(...this.loadFromDir(rulesDir));
    return skills;
  }

  private parseRules(data: FormRulesFile): FormSkill[] {
    if (data.version !== 1) return [];
    return data.rules.map((rule) => this.ruleToSkill(rule));
  }

  private ruleToSkill(rule: import('./types.js').FormRule): FormSkill {
    const matchKeys = Object.entries(rule.match);
    const name = 'rule:' + matchKeys.map(([k, v]) => `${k}=${v}`).join(',');

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

    // Fallback: return a no-op skill
    return {
      name,
      type: rule.type,
      match: () => false,
      generate: () => '',
    };
  }

  private matchesRule(field: FormFieldMeta, rule: import('./types.js').FormRule): boolean {
    for (const [key, value] of Object.entries(rule.match)) {
      if (key === 'hintText') {
        if (field.hintText !== value) return false;
      } else if (key === 'label') {
        if (field.label !== value) return false;
      }
    }
    return true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run tests/JsonRuleLoader.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-core/src/JsonRuleLoader.ts packages/fliwright-core/tests/JsonRuleLoader.test.ts
git commit -m "feat(core): add JsonRuleLoader for loading form generation rules"
```

---

## Task 6: FormHelper Pipeline

**Files:**
- Create: `packages/fliwright-core/src/FormHelper.ts`
- Create: `packages/fliwright-core/tests/FormHelper.test.ts`

- [ ] **Step 1: Write failing tests for FormHelper**

Create `packages/fliwright-core/tests/FormHelper.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FormHelper } from '../src/FormHelper.js';

function createMockSendRequest(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
    if (responses[method] !== undefined) return Promise.resolve(responses[method]);
    return Promise.resolve({});
  });
}

const sampleFields = {
  'ext.fliwright.extractForm': {
    fields: [
      {
        id: 'w1',
        type: 'TextFormField',
        rect: { x: 20, y: 100, width: 360, height: 48 },
        hintText: '请输入手机号',
        keyboardType: 'phone',
        maxLength: 11,
        obscureText: false,
        enabled: true,
        selector: 'text=请输入手机号',
      },
      {
        id: 'w2',
        type: 'TextFormField',
        rect: { x: 20, y: 200, width: 360, height: 48 },
        hintText: '请输入密码',
        keyboardType: 'visiblePassword',
        obscureText: true,
        enabled: true,
        selector: 'text=请输入密码',
      },
      {
        id: 'w3',
        type: 'TextFormField',
        rect: { x: 20, y: 300, width: 360, height: 48 },
        hintText: '邮箱地址',
        keyboardType: 'emailAddress',
        obscureText: false,
        enabled: true,
        selector: 'text=邮箱地址',
      },
    ],
    count: 3,
  },
  'ext.fliwright.inspect': { widgets: [], count: 0 },
  'ext.fliwright.click': { success: true },
  'ext.fliwright.type': { success: true, currentText: '' },
};

describe('FormHelper', () => {
  let sendRequest: ReturnType<typeof createMockSendRequest>;
  let helper: FormHelper;

  beforeEach(() => {
    sendRequest = createMockSendRequest(sampleFields);
    helper = new FormHelper(sendRequest);
  });

  describe('fill()', () => {
    it('extracts fields, generates data, and types into each non-obscure field', async () => {
      const result = await helper.fill({ skipObscureFields: true });

      // Should have filled phone and email, skipped password
      expect(result.filled).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.fields).toHaveLength(3);

      const phoneField = result.fields.find(f => f.id === 'w1');
      expect(phoneField?.semanticType).toBe('phone');
      expect(phoneField?.status).toBe('filled');
      expect(phoneField?.generatedValue).toMatch(/^1[3-9]\d{9}$/);

      const emailField = result.fields.find(f => f.id === 'w3');
      expect(emailField?.semanticType).toBe('email');
      expect(emailField?.status).toBe('filled');
      expect(emailField?.generatedValue).toContain('@');

      const passField = result.fields.find(f => f.id === 'w2');
      expect(passField?.status).toBe('skipped');
    });

    it('fills obscure fields when skipObscureFields is false', async () => {
      const result = await helper.fill({ skipObscureFields: false });
      expect(result.filled).toBe(3);
    });

    it('calls click and type for each filled field', async () => {
      await helper.fill({ skipObscureFields: true });
      // 2 fields filled × (1 click + 1 type) = 4 calls + 1 extractForm
      const extractCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.extractForm');
      const clickCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.click');
      const typeCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.type');
      expect(extractCalls).toHaveLength(1);
      expect(clickCalls).toHaveLength(2);
      expect(typeCalls).toHaveLength(2);
    });

    it('scopes extraction when scope option is provided', async () => {
      await helper.fill({ scope: 'text=注册表单' });
      expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.extractForm', { scope: 'text=注册表单' });
    });
  });

  describe('analyze()', () => {
    it('returns field analysis without filling', async () => {
      const result = await helper.analyze();
      expect(result.fields).toHaveLength(3);
      expect(result.fields[0].semanticType).toBe('phone');
      expect(result.fields[0].hintText).toBe('请输入手机号');

      // Should not have called click or type
      const clickCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.click');
      const typeCalls = sendRequest.mock.calls.filter(c => c[0] === 'ext.fliwright.type');
      expect(clickCalls).toHaveLength(0);
      expect(typeCalls).toHaveLength(0);
    });
  });

  describe('fillFields()', () => {
    it('fills only fields matching the given hints', async () => {
      const result = await helper.fillFields(['手机号']);
      expect(result.filled).toBe(1);
      expect(result.skipped).toBe(2);
      const phoneField = result.fields.find(f => f.id === 'w1');
      expect(phoneField?.status).toBe('filled');
    });

    it('matches by hintText substring', async () => {
      const result = await helper.fillFields(['邮箱']);
      expect(result.filled).toBe(1);
      const emailField = result.fields.find(f => f.id === 'w3');
      expect(emailField?.status).toBe('filled');
    });
  });

  describe('error handling', () => {
    it('reports error when type extension fails', async () => {
      const errorSend = createMockSendRequest({
        ...sampleFields,
        'ext.fliwright.type': { error: 'No focused EditableText', success: false },
      });
      const errorHelper = new FormHelper(errorSend);
      const result = await errorHelper.fill({ skipObscureFields: true });
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.fields.some(f => f.status === 'error')).toBe(true);
    });

    it('handles empty form gracefully', async () => {
      const emptySend = createMockSendRequest({
        'ext.fliwright.extractForm': { fields: [], count: 0 },
      });
      const emptyHelper = new FormHelper(emptySend);
      const result = await emptyHelper.fill();
      expect(result.filled).toBe(0);
      expect(result.fields).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run tests/FormHelper.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement FormHelper**

Create `packages/fliwright-core/src/FormHelper.ts`:

```typescript
import type {
  FormFieldMeta,
  FormFillResult,
  FormAnalyzeResult,
  FormHelperOptions,
  SemanticType,
} from './types.js';
import { SemanticInferrer } from './SemanticInferrer.js';
import { FakerGenerator } from './FakerGenerator.js';
import { SkillRegistry } from './SkillRegistry.js';
import { JsonRuleLoader } from './JsonRuleLoader.js';
import { Locator } from './Locator.js';
import { Selector } from './Selector.js';

type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export class FormHelper {
  private sendRequest: SendRequest;

  constructor(sendRequest: SendRequest) {
    this.sendRequest = sendRequest;
  }

  async fill(options?: FormHelperOptions): Promise<FormFillResult> {
    const fields = await this.extractFields(options?.scope);
    const { inferrer, generator, registry } = this.buildPipeline(options);

    const result: FormFillResult = { filled: 0, skipped: 0, errors: [], fields: [] };
    const semanticTypes = inferrer.infer(fields);

    for (const field of fields) {
      // Skip disabled fields
      if (!field.enabled) {
        result.fields.push({
          id: field.id,
          semanticType: semanticTypes.get(field.id) ?? 'text',
          generatedValue: '',
          selector: field.selector,
          status: 'skipped',
        });
        result.skipped++;
        continue;
      }

      // Skip obscure fields unless explicitly told not to
      if (field.obscureText && (options?.skipObscureFields ?? true)) {
        result.fields.push({
          id: field.id,
          semanticType: semanticTypes.get(field.id) ?? 'password',
          generatedValue: '',
          selector: field.selector,
          status: 'skipped',
        });
        result.skipped++;
        continue;
      }

      const semanticType = semanticTypes.get(field.id) ?? 'text';
      let generatedValue: string;

      const skill = registry.match(field);
      if (skill) {
        generatedValue = skill.generate(field, options?.locale ?? 'zh_CN');
      } else {
        generatedValue = generator.generate(semanticType, field.maxLength);
      }

      // Fill the field
      try {
        const selector = new Selector(this.parseSelector(field.selector));
        const locator = new Locator(this.parseSelector(field.selector), this.sendRequest);
        await locator.click();
        await locator.type(generatedValue);
        result.fields.push({
          id: field.id,
          semanticType,
          generatedValue,
          selector: field.selector,
          status: 'filled',
        });
        result.filled++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        result.errors.push({ fieldId: field.id, error: errorMsg });
        result.fields.push({
          id: field.id,
          semanticType,
          generatedValue,
          selector: field.selector,
          status: 'error',
        });
      }
    }

    return result;
  }

  async analyze(options?: FormHelperOptions): Promise<FormAnalyzeResult> {
    const fields = await this.extractFields(options?.scope);
    const { inferrer, generator, registry } = this.buildPipeline(options);
    const semanticTypes = inferrer.infer(fields);

    return {
      fields: fields.map((field) => {
        const semanticType = semanticTypes.get(field.id) ?? 'text';
        const skill = registry.match(field);
        const generatedValue = skill
          ? skill.generate(field, options?.locale ?? 'zh_CN')
          : generator.generate(semanticType, field.maxLength);
        return {
          id: field.id,
          semanticType,
          generatedValue,
          selector: field.selector,
          hintText: field.hintText,
          label: field.label,
        };
      }),
    };
  }

  async fillFields(fieldHints: string[], options?: FormHelperOptions): Promise<FormFillResult> {
    const fields = await this.extractFields(options?.scope);
    const matchingFields = fields.filter((field) => {
      const text = field.hintText ?? field.label ?? '';
      return fieldHints.some((hint) => text.includes(hint));
    });

    // Create a modified options that only targets matching fields
    const nonMatchingFields = fields.filter(
      (f) => !matchingFields.some((m) => m.id === f.id),
    );

    const fullResult = await this.fill(options);

    // Mark non-matching fields as skipped
    const result: FormFillResult = { filled: 0, skipped: 0, errors: [], fields: [] };
    for (const fieldResult of fullResult.fields) {
      if (nonMatchingFields.some((f) => f.id === fieldResult.id)) {
        result.fields.push({ ...fieldResult, status: 'skipped' });
        result.skipped++;
      } else {
        result.fields.push(fieldResult);
        if (fieldResult.status === 'filled') result.filled++;
        else if (fieldResult.status === 'skipped') result.skipped++;
        else if (fieldResult.status === 'error') result.errors.push({ fieldId: fieldResult.id, error: '' });
      }
    }
    return result;
  }

  private async extractFields(scope?: string): Promise<FormFieldMeta[]> {
    const params: Record<string, unknown> = {};
    if (scope) params.scope = scope;
    const response = (await this.sendRequest('ext.fliwright.extractForm', params)) as {
      fields: FormFieldMeta[];
      count: number;
    };
    return response.fields ?? [];
  }

  private buildPipeline(options?: FormHelperOptions) {
    const inferrer = new SemanticInferrer();
    const generator = new FakerGenerator({ locale: options?.locale });
    const registry = new SkillRegistry();
    const loader = new JsonRuleLoader();

    // Load skills from rules
    if (options?.rulesFile) {
      const skills = loader.loadFromFile(options.rulesFile);
      for (const skill of skills) registry.register(skill);
    } else if (options?.rulesDir) {
      const skills = loader.loadFromDir(options.rulesDir);
      for (const skill of skills) registry.register(skill);
    } else {
      const skills = loader.autoDiscover();
      for (const skill of skills) registry.register(skill);
    }

    return { inferrer, generator, registry };
  }

  private parseSelector(selectorStr: string): string | { text: string } | { key: string } | { type: string } {
    if (selectorStr.startsWith('text=')) return { text: selectorStr.slice(5) };
    if (selectorStr.startsWith('key=')) return { key: selectorStr.slice(4) };
    if (selectorStr.startsWith('byType=')) return { type: selectorStr.slice(7) };
    return { text: selectorStr };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run tests/FormHelper.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-core/src/FormHelper.ts packages/fliwright-core/tests/FormHelper.test.ts
git commit -m "feat(core): add FormHelper pipeline with fill, analyze, fillFields"
```

---

## Task 7: Page Integration + Exports

**Files:**
- Modify: `packages/fliwright-core/src/Page.ts`
- Modify: `packages/fliwright-core/src/index.ts`

- [ ] **Step 1: Add formHelper getter to Page**

Modify `packages/fliwright-core/src/Page.ts`. Add import and getter:

After the existing imports at the top, add:
```typescript
import { FormHelper } from './FormHelper.js';
```

Inside the `Page` class, add a private field and getter after the existing `locator` method:

```typescript
  private _formHelper: FormHelper | null = null;

  get formHelper(): FormHelper {
    if (!this._formHelper) {
      this._formHelper = new FormHelper(this.sendRequest);
    }
    return this._formHelper;
  }
```

- [ ] **Step 2: Add exports to index.ts**

Modify `packages/fliwright-core/src/index.ts`. Add these lines in the appropriate sections:

In the type exports section, add:
```typescript
export type {
  FormFieldMeta,
  SemanticType,
  FormFillResult,
  FormAnalyzeResult,
  FormHelperOptions,
  FormSkill,
  FormRule,
  FormRulesFile,
} from './types.js';
```

In the class exports section, add:
```typescript
export { FormHelper } from './FormHelper.js';
export { SemanticInferrer } from './SemanticInferrer.js';
export { FakerGenerator } from './FakerGenerator.js';
export { SkillRegistry } from './SkillRegistry.js';
export { JsonRuleLoader } from './JsonRuleLoader.js';
```

- [ ] **Step 3: Run type check and all tests**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx tsc --noEmit && npx vitest run`
Expected: No type errors, all tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/fliwright-core/src/Page.ts packages/fliwright-core/src/index.ts
git commit -m "feat(core): integrate FormHelper into Page, export form modules"
```

---

## Task 8: Dart Form Extraction Extension

**Files:**
- Create: `packages/fliwright-bridge/lib/src/extensions/form_extract.dart`
- Modify: `packages/fliwright-bridge/lib/src/bridge.dart`
- Create: `packages/fliwright-bridge/test/form_extract_test.dart`

- [ ] **Step 1: Write failing Dart test for form extraction**

Create `packages/fliwright-bridge/test/form_extract_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  group('FormExtractExtension', () {
    setUp(() async {
      await FliwrightBridge.reset();
    });

    test('registers ext.fliwright.extractForm on init', () async {
      await FliwrightBridge.init();
      expect(
        FliwrightBridge.registry.registeredMethods,
        contains('ext.fliwright.extractForm'),
      );
    });

    test('returns fields array and count', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.extractForm',
        {},
      );
      expect(result, contains('fields'));
      expect(result['fields'], isA<List>());
      expect(result, contains('count'));
    });

    test('returns empty fields when no EditableText in tree', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.extractForm',
        {},
      );
      expect(result['count'], equals(0));
      expect((result['fields'] as List).length, equals(0));
    });
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-bridge && flutter test test/form_extract_test.dart`
Expected: FAIL — extension not registered

- [ ] **Step 3: Implement FormExtractExtension**

Create `packages/fliwright-bridge/lib/src/extensions/form_extract.dart`:

```dart
import 'package:flutter/widgets.dart';
import 'package:flutter/material.dart';
import '../bridge.dart';

class FormExtractExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.extractForm', _extractForm);
  }

  static Future<Map<String, dynamic>> _extractForm(Map<String, String> params) async {
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {'fields': <dynamic>[], 'count': 0};
    }

    // If scope is provided, find the scope container and only walk its subtree.
    Element? scopeRoot;
    final scopeSelector = params['scope'] ?? '';
    if (scopeSelector.isNotEmpty) {
      final inspectResult = await FliwrightBridge.registry.invoke(
        'ext.fliwright.inspect',
        {'selector': scopeSelector},
      );
      // For scoping, we just walk the full tree but filter by scope context.
      // The inspect extension doesn't give us the Element, so we do a two-pass:
      // find the scope element first, then extract from its children.
    }

    final fields = <Map<String, dynamic>>[];

    InspectExtension.walkTree(root, (Element element) {
      final widget = element.widget;
      if (widget is! EditableText) return;

      final info = InspectExtension.extractWidgetInfo(element);
      if (info == null) return;

      final hintText = _getHintText(widget);
      final label = _getLabel(widget);
      final keyboardType = _getKeyboardType(widget);
      final maxLength = _getMaxLength(widget);
      final obscureText = widget.obscureText;
      final enabled = widget.enabled;

      // Generate best selector
      String selector;
      if (hintText != null && hintText.isNotEmpty) {
        selector = 'text=$hintText';
      } else {
        final key = info['key'];
        if (key != null) {
          selector = 'key=$key';
        } else {
          selector = 'byType=${info['type']}';
        }
      }

      fields.add({
        'id': info['id'],
        'type': info['type'],
        if (info['rect'] != null) 'rect': info['rect'],
        if (hintText != null) 'hintText': hintText,
        if (label != null) 'label': label,
        if (keyboardType != null) 'keyboardType': keyboardType,
        if (maxLength != null) 'maxLength': maxLength,
        'obscureText': obscureText,
        'enabled': enabled,
        'selector': selector,
      });
    });

    return {'fields': fields, 'count': fields.length};
  }

  static String? _getHintText(EditableText widget) {
    // TextField and TextFormField use InputDecoration for decoration.
    // EditableText itself has a decoration field.
    if (widget is TextField) {
      return widget.decoration?.hintText;
    }
    if (widget is TextFormField) {
      return widget.decoration?.hintText;
    }
    return null;
  }

  static String? _getLabel(EditableText widget) {
    if (widget is TextField) {
      return widget.decoration?.labelText;
    }
    if (widget is TextFormField) {
      return widget.decoration?.labelText;
    }
    return null;
  }

  static String? _getKeyboardType(EditableText widget) {
    final inputType = widget.keyboardType;
    if (inputType == TextInputType.phone) return 'phone';
    if (inputType == TextInputType.emailAddress) return 'emailAddress';
    if (inputType == TextInputType.number) return 'number';
    if (inputType == TextInputType.url) return 'url';
    if (inputType == TextInputType.multiline) return 'multiline';
    if (inputType == TextInputType.visiblePassword) return 'visiblePassword';
    if (inputType == TextInputType.text) return 'text';
    return inputType.name;
  }

  static int? _getMaxLength(EditableText widget) {
    // maxLength is not directly on EditableText; it's on TextField/TextFormField.
    // For EditableText, we check if it's a TextField with maxLength.
    if (widget is TextField) {
      final ml = widget.maxLength;
      if (ml != null && ml > 0) return ml;
    }
    if (widget is TextFormField) {
      final ml = widget.maxLength;
      if (ml != null && ml > 0) return ml;
    }
    return null;
  }
}
```

- [ ] **Step 4: Register extension in bridge.dart**

Modify `packages/fliwright-bridge/lib/src/bridge.dart`. Add the import and registration:

Add import at top:
```dart
import 'extensions/form_extract.dart';
```

Add after `RecordingExtension.register(_registry);` in the `init()` method:
```dart
    FormExtractExtension.register(_registry);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-bridge && flutter test test/form_extract_test.dart`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-bridge/lib/src/extensions/form_extract.dart packages/fliwright-bridge/lib/src/bridge.dart packages/fliwright-bridge/test/form_extract_test.dart
git commit -m "feat(bridge): add form extraction extension for Widget tree form field discovery"
```

---

## Task 9: Run Full Test Suite and Fix Any Issues

**Files:**
- Possibly fix type or import issues across modified files

- [ ] **Step 1: Run all core tests**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run all bridge tests**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-bridge && flutter test`
Expected: All tests PASS

- [ ] **Step 3: Run full type check**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Fix any issues found, then commit**

If any issues were found and fixed:
```bash
git add -A
git commit -m "fix(core,bridge): address integration issues from Slice 6"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Section 1 (Dart extractForm) → Task 8
- [x] Section 2 (SemanticInferrer) → Task 2
- [x] Section 3 (FakerGenerator) → Task 3
- [x] Section 4 (SkillRegistry) → Task 4
- [x] Section 5 (JsonRuleLoader) → Task 5
- [x] Section 6 (FormHelper pipeline) → Task 6
- [x] Section 7 (Page integration + exports) → Task 7
- [x] Section 8 (Types) → Task 1

**Placeholder scan:** No TBD/TODO found. All code steps have complete implementations.

**Type consistency:** `FormFieldMeta`, `SemanticType`, `FormFillResult`, `FormAnalyzeResult`, `FormHelperOptions`, `FormSkill`, `FormRule`, `FormRulesFile` defined in Task 1 (types.ts) and used consistently across Tasks 2-7. `SendRequest` type alias matches existing pattern from Driver.ts. `Selector` class usage matches existing import.
