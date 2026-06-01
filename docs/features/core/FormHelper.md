---
module: "FormHelper"
package: "@fliwright/core"
source: "src/FormHelper.ts"
generated: "2026-06-01"
---

# FormHelper

> Auto-fills forms using semantic inference and Faker-generated data.

## Overview

`FormHelper` extracts form fields from the Flutter app, infers their semantic types, generates appropriate fake data, and fills the fields. It supports custom rules via JSON files and a skill registry for extensibility.

## Constructor

```typescript
constructor(sendRequest: SendRequest)
```

## Public Methods

### `fill(options?: FormHelperOptions): Promise<FormFillResult>`

Extracts fields, infers types, generates data, and fills all form fields.

### `analyze(options?: FormHelperOptions): Promise<FormAnalyzeResult>`

Analyzes the form without filling — returns inferred types and generated values for each field.

### `fillFields(fieldHints: string[], options?: FormHelperOptions): Promise<FormFillResult>`

Fills only the fields matching the given hint strings.

## FormHelperOptions

| Field | Type | Description |
|-------|------|-------------|
| `rulesFile` | `string` | Path to a JSON rules file |
| `rulesDir` | `string` | Path to a directory of JSON rules files |
| `locale` | `string` | Locale for data generation |
| `skipObscureFields` | `boolean` | Skip password/obscured fields |
| `scope` | `string` | Scope selector to limit form extraction |

## Related

- **Depends on:** [SemanticInferrer](./SemanticInferrer.md), [FakerGenerator](./FakerGenerator.md), [SkillRegistry](./SkillRegistry.md), [JsonRuleLoader](./JsonRuleLoader.md)
- **Used by:** [Page](./Page.md)
- **Source:** `src/FormHelper.ts`
