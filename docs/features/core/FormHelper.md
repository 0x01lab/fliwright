---
module: "FormHelper"
package: "@fliwright/core"
source: "src/FormHelper.ts"
tests: "tests/FormHelper.test.ts"
generated: "2026-06-02"
---

# FormHelper

> Discover form fields on the current screen, infer semantic types, generate values, and type them in.

## Overview

`FormHelper` orchestrates the form-filling pipeline:

1. Extract fields via `ext.fliwright.formExtract`.
2. Build a pipeline of `SemanticInferrer`, `FakerGenerator`, and `SkillRegistry` (with rules loaded by `JsonRuleLoader`).
3. For each field: prefer a matching skill, else use Faker.

The same pipeline powers `analyze()` (preview without typing) and `fillFields(hints, options)` (only fill fields whose hint/label contains one of the given substrings).

## Constructor

```typescript
constructor(sendRequest: SendRequest)
```

## Public Methods

### `fill(options?): Promise<FormFillResult>`

Extracts fields, generates values, types each into the bridge.

| Parameter | Type | Description |
|-----------|------|-------------|
| `options.locale` | string | Locale passed to skills (e.g. `'zh_CN'`) |
| `options.scope` | `SelectorInput` | Restrict extraction to a subtree |
| `options.skills` | `FormSkill[]` | Pre-built skill list (skip JSON loader) |
| `options.rulesFile` | string | Override path to a rules JSON file |
| `options.rulesDir` | string | Override path to a rules directory |

**Returns:** `Promise<FormFillResult>` — `{ filled, skipped, errors, fields: [...] }`.

### `analyze(options?): Promise<FormAnalyzeResult>`

Same pipeline as `fill`, but does not type. Returns the proposed value per field.

### `fillFields(fieldHints, options?): Promise<FormFillResult>`

Only fill fields whose `hintText`/`label` includes one of the supplied substrings. Other fields are marked `status: 'skipped'` with `reason: 'not selected'`.

## Example

```typescript
const result = await driver.page.formHelper.fill({ locale: 'zh_CN' });
console.log(`Filled ${result.filled}, skipped ${result.skipped}`);

const analysis = await driver.page.formHelper.analyze();
for (const f of analysis.fields) {
  console.log(f.id, f.semanticType, '→', f.generatedValue);
}

await driver.page.formHelper.fillFields(['邮箱', '密码']);
```

## Related

- **Depends on:** [SemanticInferrer](./SemanticInferrer.md), [FakerGenerator](./FakerGenerator.md), [SkillRegistry](./SkillRegistry.md), [JsonRuleLoader](./JsonRuleLoader.md)
- **Pipeline:** [form-filling-pipeline.md](../form-filling-pipeline.md)
- **Source:** `packages/fliwright-core/src/FormHelper.ts`
