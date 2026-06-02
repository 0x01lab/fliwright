---
module: "FakerGenerator"
package: "@fliwright/core"
source: "src/FakerGenerator.ts"
tests: "tests/FakerGenerator.test.ts"
generated: "2026-06-02"
---

# FakerGenerator

> Generate a localized, length-bounded value for a `SemanticType` using `@faker-js/faker`.

## Overview

Used as the fallback generator when no `SkillRegistry` rule matches. Each semantic type has its own generator method; values are truncated to `maxLength` when supplied.

## Constructor

```typescript
constructor(options?: { locale?: string })
```

## Public Methods

### `generate(semanticType, maxLength?): string`

| Parameter | Type | Description |
|-----------|------|-------------|
| `semanticType` | `SemanticType` | One of: phone/email/idCard/fullName/address/password/captcha/number/text/url/date |
| `maxLength` | number | Optional truncation length |

**Returns:** `string` — generated value.

## Per-Type Behavior

| Type | Generator |
|------|-----------|
| `phone` | `1` + digit `[3-9]` + 9 random digits (Chinese mobile) |
| `email` | `faker.internet.email()` |
| `idCard` | 18-digit Chinese ID with valid checksum |
| `fullName` | `faker.person.fullName()` |
| `address` | `faker.location.streetAddress({ useFullAddress: true })` |
| `password` | Mixed-case letters + digits + symbols, shuffled |
| `captcha` | 4–6 random digits |
| `number` | 1–5 random digits |
| `text` | `faker.lorem.sentence()` |
| `url` | `faker.internet.url()` |
| `date` | ISO date within the recent past (yyyy-mm-dd) |

## Example

```typescript
const gen = new FakerGenerator();
gen.generate('email');      // e.g. 'foo@example.com'
gen.generate('phone');      // e.g. '13812345678'
gen.generate('idCard');     // 18-digit valid Chinese ID
gen.generate('password', 16);
```

## Related

- **Used by:** [FormHelper](./FormHelper.md)
- **Source:** `packages/fliwright-core/src/FakerGenerator.ts`
