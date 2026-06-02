---
module: "FakerGenerator"
package: "@fliwright/core"
source: "src/FakerGenerator.ts"
generated: "2026-06-02"
---

# FakerGenerator

> Generates fake data by semantic type using @faker-js/faker.

## Overview

Generates locale-aware fake data for each `SemanticType`: Chinese phone numbers, Chinese ID cards, emails, names, addresses, passwords, captchas, URLs, dates, and more.

## Constructor

```typescript
constructor(options?: FakerGeneratorOptions)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.locale` | `string` | No | Locale for generation (handled by preset skills) |

## Public Methods

### `generate(semanticType: SemanticType, maxLength?: number): string`

Generates a fake value for the given semantic type. Truncates to `maxLength` if specified.

## Related

- **Used by:** [FormHelper](./FormHelper.md)
- **Source:** `src/FakerGenerator.ts`
