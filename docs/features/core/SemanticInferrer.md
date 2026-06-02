---
module: "SemanticInferrer"
package: "@fliwright/core"
source: "src/SemanticInferrer.ts"
generated: "2026-06-02"
---

# SemanticInferrer

> Infers semantic types (phone, email, idCard, etc.) from form field metadata.

## Overview

Uses regex pattern matching on hintText/label and keyboard type mapping to infer the `SemanticType` of each form field. Supported types: phone, email, idCard, fullName, address, password, captcha, date, number, text, url, boolean, option.

## Public Methods

### `infer(fields: FormFieldMeta[]): Map<string, SemanticType>`

Returns a map of field ID to inferred semantic type.

## Related

- **Used by:** [FormHelper](./FormHelper.md)
- **Source:** `src/SemanticInferrer.ts`
