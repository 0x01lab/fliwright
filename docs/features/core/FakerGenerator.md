---
module: "FakerGenerator"
package: "@fliwright/core"
source: "src/FakerGenerator.ts"
generated: "2026-06-01"
---

# FakerGenerator

> Generates realistic fake data for form fields based on semantic type.

## Overview

`FakerGenerator` uses `@faker-js/faker` to generate locale-aware fake data. Each semantic type maps to a specific generation strategy (phone numbers, emails, addresses, etc.).

## Constructor

```typescript
constructor(options?: FakerGeneratorOptions)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `options.locale` | `string` | Faker locale (default: system locale) |

## Public Methods

### `generate(semanticType: SemanticType, maxLength?: number): string`

Generates fake data for the given semantic type.

## Generation Strategies

| Semantic Type | Strategy |
|---------------|----------|
| `phone` | Chinese mobile format |
| `email` | Faker email |
| `idCard` | Chinese 18-digit ID with checksum |
| `fullName` | Faker full name |
| `address` | Faker street address |
| `password` | Random alphanumeric (8-16 chars) |
| `captcha` | 4-6 digit number |
| `number` | Random number |
| `text` | Faker lorem word |
| `url` | Faker URL |
| `date` | Date string |

## Related

- **Used by:** [FormHelper](./FormHelper.md)
- **Source:** `src/FakerGenerator.ts`
