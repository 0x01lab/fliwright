---
module: "FormHelper"
package: "@fliwright/core"
source: "src/FormHelper.ts"
generated: "2026-06-02"
---

# FormHelper

> Auto-fills Flutter forms by extracting fields, inferring semantic types, generating fake data, and filling via Locator actions.

## Overview

`FormHelper` orchestrates the full form-filling pipeline: extract fields via `ext.fliwright.extractForm`, infer semantic types via `SemanticInferrer`, generate values via `FakerGenerator` or `SkillRegistry`, and fill via `Locator.fill/click`. Supports text inputs, checkboxes, radio buttons, and select dropdowns with fallback selector strategies.

## Constructor

```typescript
constructor(sendRequest: SendRequest)
```

## Public Methods

### `fill(options?: FormHelperOptions): Promise<FormFillResult>`

Extracts all form fields, generates values, and fills them. Returns counts of filled/skipped/errors and per-field details.

### `analyze(options?: FormHelperOptions): Promise<FormAnalyzeResult>`

Extracts fields and generates values without filling. Useful for preview.

### `fillFields(fieldHints: string[], options?: FormHelperOptions): Promise<FormFillResult>`

Fills only fields whose hintText or label matches one of the provided hints.

## Related

- **Depends on:** [SemanticInferrer](./SemanticInferrer.md), [FakerGenerator](./FakerGenerator.md), [SkillRegistry](./SkillRegistry.md), [JsonRuleLoader](./JsonRuleLoader.md), [Locator](./Locator.md)
- **Source:** `src/FormHelper.ts`
