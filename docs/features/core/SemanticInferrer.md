---
module: "SemanticInferrer"
package: "@fliwright/core"
source: "src/SemanticInferrer.ts"
generated: "2026-06-01"
---

# SemanticInferrer

> Infers semantic types from form field metadata (hint text, label, keyboard type).

## Overview

`SemanticInferrer` uses regex patterns on hint text/labels and Flutter keyboard type mappings to determine the semantic type of a form field (phone, email, address, etc.).

## Constructor

```typescript
constructor()
```

## Public Methods

### `infer(fields: FormFieldMeta[]): Map<string, SemanticType>`

Infers semantic types for all fields. Returns a map of field ID to semantic type.

## Inference Rules

### Hint Text Patterns

| Pattern | Semantic Type |
|---------|---------------|
| Phone/mobile patterns | `phone` |
| Email patterns | `email` |
| ID card patterns | `idCard` |
| Address patterns | `address` |
| Name patterns | `fullName` |
| Password patterns | `password` |
| Captcha/verification | `captcha` |
| Date patterns | `date` |

### Keyboard Type Mapping

| Flutter TextInputType | Semantic Type |
|-----------------------|---------------|
| `phone` | `phone` |
| `emailAddress` | `email` |
| `number` | `number` |
| `url` | `url` |
| `visiblePassword` | `password` |

## Related

- **Used by:** [FormHelper](./FormHelper.md)
- **Source:** `src/SemanticInferrer.ts`
