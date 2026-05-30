# Slice 6: Form Helper Loop — Smart Form Filling

**Date**: 2026-05-30
**Status**: Approved
**Depends on**: Slice 0 (Extensible Architecture), Slice 1 (Minimal Loop), Slice 2 (Assertion Loop)

---

## Goal

Auto-identify form field semantics from Flutter Widget metadata, generate locale-aware compliant fake data via pluggable strategies, and fill forms in one call. After Slice 6, a developer can call `page.formHelper.fill()` and have all form fields populated with realistic, compliant data.

---

## Delivery Approach: Vertical Slice Iteration

Four iterations, each delivering a demoable end-to-end capability:

| Iteration | Scope | User Gets |
|-----------|-------|-----------|
| 6-A | Dart form extraction + TS semantic inference | "Extract form fields → infer semantic types" end-to-end |
| 6-B | Faker generator + Skill/JSON rule system | "Infer → generate compliant mock data" end-to-end |
| 6-C | FormHelper pipeline + Page integration | "page.formHelper.fill()" end-to-end |
| 6-D | Integration test | Full form filling flow verification |

---

## 1. Dart: Form Field Extraction Extension

### 1.1 Extension: `ext.fliwright.extractForm`

Traverse the Widget tree to find all `EditableText` subclasses (`TextField`, `TextFormField`, etc.) and extract metadata for each.

**Protocol**:

```json
// Request
{ "scope": "text=注册表单" }  // optional: limit extraction to a container widget

// Response
{
  "fields": [
    {
      "id": "widget_42",
      "type": "TextFormField",
      "rect": { "x": 20, "y": 150, "width": 360, "height": 48 },
      "hintText": "请输入手机号",
      "label": null,
      "keyboardType": "phone",
      "maxLength": 11,
      "obscureText": false,
      "enabled": true,
      "selector": "text=请输入手机号"
    }
  ],
  "count": 1
}
```

### 1.2 Extraction Logic

- Walk the Widget tree via `InspectExtension.walkTree`
- For each `EditableText` subclass element:
  - Extract `decoration.hintText` and `decoration.labelText` from `InputDecoration`
  - Extract `keyboardType` (maps to: `text`, `number`, `phone`, `emailAddress`, `url`, `multiline`, `visiblePassword`, etc.)
  - Extract `maxLength`, `obscureText`, `enabled`
  - Generate best selector: prefer `hintText` (text selector) → `key` (key selector) → `type` (type selector)
  - Use `InspectExtension.extractWidgetInfo` for rect and id
- Optional `scope` parameter: if provided, only traverse children of the first widget matching the scope selector

**Estimate**: 2 days

---

## 2. TS: Semantic Inference Engine

### 2.1 SemanticInferrer

Receives `FormFieldMeta[]` from Dart extraction and infers each field's semantic type.

**Inference priority** (highest to lowest):

1. **JSON rule file explicit match** — if a loaded rule matches the field's `hintText` or `label` exactly
2. **HintText/label regex patterns**:
   - `/(手机|phone|mobile)/i` → `phone`
   - `/(邮箱|email|e-mail)/i` → `email`
   - `/(身份证|ID.?card|身份证号)/i` → `idCard`
   - `/(地址|address|addr)/i` → `address`
   - `/(姓名|full.?name|真实姓名)/i` → `fullName`
   - `/(密码|password|pwd)/i` → `password`
   - `/(验证码|captcha|verification.?code)/i` → `captcha`
   - `/(日期|date|birthday|生日)/i` → `date`
3. **keyboardType mapping**:
   - `phone` → `phone`
   - `emailAddress` → `email`
   - `number` → `number`
   - `url` → `url`
   - `visiblePassword` → `password`
   - `text` / `multiline` → `text` (fallback)

### 2.2 Class

```typescript
type SemanticType =
  | 'phone' | 'email' | 'idCard' | 'fullName' | 'address'
  | 'password' | 'captcha' | 'number' | 'text' | 'url' | 'date';

class SemanticInferrer {
  infer(fields: FormFieldMeta[]): Map<string, SemanticType>;
}
```

**Estimate**: 2 days (including tests)

---

## 3. TS: Faker Data Generator

### 3.1 FakerGenerator

Uses `@faker-js/faker` for multi-locale compliant data generation.

**Generation by semantic type**:

| Semantic Type | Generation Method | Example (zh_CN) |
|---------------|-------------------|-----------------|
| phone | Locale-aware mobile format | `13812345678` |
| email | faker.internet.email | `test@example.com` |
| idCard | ID number with checksum | `110101199001011234` |
| fullName | faker.person.firstName + lastName | `张三` |
| address | faker.location.streetAddress(true) | `北京市朝阳区建国路88号` |
| password | Random letters+digits+symbols, respecting maxLength | `Abc123!@` |
| captcha | 4-6 digit random number | `1234` |
| number | Random number in range | `42` |
| text | faker.lorem.sentence | `这是一段测试文本` |
| url | faker.internet.url | `https://example.com` |
| date | faker.date.recent formatted | `2026-05-30` |

### 3.2 Class

```typescript
interface FakerGeneratorOptions {
  locale?: string;  // default: 'zh_CN'
}

class FakerGenerator {
  constructor(options?: FakerGeneratorOptions);
  generate(semanticType: SemanticType, maxLength?: number): string;
}
```

Locale is passed to `@faker-js/faker`'s `faker` constructor. Supports 60+ locales.

**Estimate**: 2 days (including preset skills + tests)

---

## 4. TS: Skill Registry

### 4.1 FormSkill Interface

Pluggable generation strategy:

```typescript
interface FormSkill {
  name: string;
  type: 'PRESET_SKILL' | 'REGEXP_MOCK' | 'LLM_GENERATE';
  match: (field: FormFieldMeta) => boolean;
  generate: (field: FormFieldMeta, locale: string) => string;
}
```

### 4.2 Strategy Types

**PRESET_SKILL**: Built-in algorithms for specific data types (e.g., Chinese mobile numbers matching `1[3-9]\d{9}`, ID card with checksum calculation, Taiwan mobile `09\d{8}`).

**REGEXP_MOCK**: Reverse-generates strings from regular expressions. E.g., `/\d{4}-\d{2}-\d{2}/` → `2026-05-30`. Uses `randexp` library.

**LLM_GENERATE**: Reads data from AI-pre-generated JSON rule files. The `generate()` method cycles through the `data` array in the rule.

### 4.3 SkillRegistry Class

```typescript
class SkillRegistry {
  private skills: FormSkill[] = [];

  register(skill: FormSkill): void;
  match(field: FormFieldMeta): FormSkill | null;
  clear(): void;
}
```

**Estimate**: 1 day (shared with JSON Rule Loader)

---

## 5. TS: JSON Rule Loader

### 5.1 Rule File Format

```json
{
  "version": 1,
  "locale": "zh-CN",
  "rules": [
    {
      "match": { "hintText": "公司名称" },
      "type": "LLM_GENERATE",
      "data": ["北京科技有限公司", "上海创新网络科技"]
    },
    {
      "match": { "semanticType": "address" },
      "type": "LLM_GENERATE",
      "data": ["北京市朝阳区建国路88号"]
    },
    {
      "match": { "hintText": "/订单号|order/i" },
      "type": "REGEXP_MOCK",
      "pattern": "ORD\\d{10}"
    }
  ]
}
```

Each rule is converted to a `FormSkill` and registered in the `SkillRegistry`.

### 5.2 File Resolution

1. Explicit path from `FormHelperOptions.rulesFile`
2. `fliwright.form-rules.json` in project root
3. All `.json` files in `fliwright.form-rules/` directory

### 5.3 Class

```typescript
class JsonRuleLoader {
  loadFromFile(filePath: string): FormSkill[];
  loadFromDir(dirPath: string): FormSkill[];
  autoDiscover(): FormSkill[];  // search default locations
}
```

**Estimate**: 1 day

---

## 6. TS: FormHelper Pipeline

### 6.1 API

```typescript
// One-shot fill entire form
const result = await page.formHelper.fill();

// With options
const result = await page.formHelper.fill({
  rulesFile: './custom-rules.json',
  locale: 'zh_CN',
});

// Analyze only (preview)
const analysis = await page.formHelper.analyze();

// Fill specific fields only (matched by hintText or label substring)
await page.formHelper.fillFields(['手机号', '邮箱']);
```

### 6.2 Fill Pipeline

```
1. extractForm (Dart ext)      → FormFieldMeta[]
2. JsonRuleLoader.autoDiscover() → FormSkill[]
3. Register skills in SkillRegistry
4. For each field:
   a. SkillRegistry.match() → FormSkill? → use skill.generate()
   b. If no skill match → SemanticInferrer → FakerGenerator
   c. Apply maxLength truncation
   d. Skip obscureText fields unless rule provides value
5. For each generated value:
   a. Create Locator from field.selector
   b. locator.click() to focus
   c. locator.type(value) to input
```

### 6.3 Generation Priority per Field

1. JSON rule file explicit match (highest)
2. Registered FormSkill (by registration order)
3. Built-in semantic inference + faker generator (fallback)

### 6.4 Classes

```typescript
interface FormHelperOptions {
  rulesFile?: string;
  rulesDir?: string;
  locale?: string;              // default: 'zh_CN'
  skipObscureFields?: boolean;  // default: true
  scope?: string;               // selector to scope extraction
}

interface FormFillResult {
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

interface FormAnalyzeResult {
  fields: Array<{
    id: string;
    semanticType: SemanticType;
    generatedValue: string;
    selector: string;
    hintText?: string;
    label?: string;
  }>;
}

class FormHelper {
  constructor(sendRequest: SendRequest);

  fill(options?: FormHelperOptions): Promise<FormFillResult>;
  analyze(options?: FormHelperOptions): Promise<FormAnalyzeResult>;
  fillFields(fieldHints: string[], options?: FormHelperOptions): Promise<FormFillResult>;
}
```

**Estimate**: 2 days

---

## 7. Page Integration

### 7.1 Page Update

Add `formHelper` lazy getter to `Page`:

```typescript
export class Page {
  private _formHelper: FormHelper | null = null;

  get formHelper(): FormHelper {
    if (!this._formHelper) {
      this._formHelper = new FormHelper(this.sendRequest);
    }
    return this._formHelper;
  }
}
```

### 7.2 Types Addition

Add to `types.ts`:

- `FormFieldMeta`
- `SemanticType`
- `FormFillResult`
- `FormAnalyzeResult`
- `FormHelperOptions`
- `FormSkill`
- `FormRule` (JSON rule schema)

### 7.3 Exports

Export from `index.ts`: `FormHelper`, `SemanticInferrer`, `FakerGenerator`, `SkillRegistry`, `JsonRuleLoader`.

---

## 8. File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/fliwright-bridge/lib/src/extensions/form_extract.dart` | Dart form field extraction extension |
| `packages/fliwright-core/src/FormHelper.ts` | FormHelper pipeline orchestration |
| `packages/fliwright-core/src/SemanticInferrer.ts` | Semantic type inference from field metadata |
| `packages/fliwright-core/src/FakerGenerator.ts` | Multi-locale fake data generation |
| `packages/fliwright-core/src/SkillRegistry.ts` | Pluggable generation strategy registry |
| `packages/fliwright-core/src/JsonRuleLoader.ts` | JSON rule file loading and parsing |
| `packages/fliwright-core/src/form/presets/` | Built-in PRESET_SKILL strategies |
| `packages/fliwright-core/tests/FormHelper.test.ts` | FormHelper integration tests |
| `packages/fliwright-core/tests/SemanticInferrer.test.ts` | Inference engine tests |
| `packages/fliwright-core/tests/FakerGenerator.test.ts` | Generator tests |
| `packages/fliwright-core/tests/SkillRegistry.test.ts` | Skill registry tests |
| `packages/fliwright-core/tests/JsonRuleLoader.test.ts` | Rule loader tests |
| `packages/fliwright-bridge/test/form_extract_test.dart` | Dart form extraction tests |

### Modified Files

| File | Change |
|------|--------|
| `packages/fliwright-bridge/lib/src/bridge.dart` | Register form_extract extension |
| `packages/fliwright-core/src/Page.ts` | Add `formHelper` getter |
| `packages/fliwright-core/src/types.ts` | Add form-related types |
| `packages/fliwright-core/src/index.ts` | Export new modules |

### New Dependencies

| Package | Purpose |
|---------|---------|
| `@faker-js/faker` | Multi-locale fake data generation (60+ locales) |
| `randexp` | Reverse regex string generation for REGEXP_MOCK strategy |

---

## 9. Estimates Summary

| Task | Description | Days | Iteration |
|------|-------------|------|-----------|
| 6.1 | Dart: Form field extraction extension | 2d | 6-A |
| 6.2 | TS: SemanticInferrer | 2d | 6-A |
| 6.3 | TS: FakerGenerator + preset skills | 2d | 6-B |
| 6.4 | TS: SkillRegistry + JsonRuleLoader | 2d | 6-B |
| 6.5 | TS: FormHelper pipeline + Page integration | 2d | 6-C |
| 6.6 | Integration test | 2d | 6-D |
| **Total** | | **12d** | |

---

## 10. Dependencies

- Slice 0: PluginRegistry, Protocol, VM Service event stream
- Slice 1: FliwrightDriver, Locator, click/type extensions, inspect extension
- Slice 2: Assertion engine (test structure)

### New NPM Dependencies

- `@faker-js/faker` — multi-locale fake data generation
- `randexp` — regex reverse string generation

---

## 11. Out of Scope

- Dart-side form filling (TypeScript orchestrates all logic)
- Visual form field highlighting
- Form validation assertion (use Slice 2's Assertion for that)
- Multi-page form wizard navigation
- Form submission (user calls `page.locator({ text: '提交' }).click()` manually)
- Screenshot/video capture during form fill
