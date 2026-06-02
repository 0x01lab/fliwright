---
module: "SemanticInferrer"
package: "@fliwright/core"
source: "src/SemanticInferrer.ts"
tests: "tests/SemanticInferrer.test.ts"
generated: "2026-06-02"
---

# SemanticInferrer

> Map each `FormFieldMeta` to a `SemanticType` by regex-matching `hintText`/`label` and consulting `keyboardType`.

## Overview

The inferrer has two layers:

1. **Hint patterns** — regex rules over the field's hint/label text:
   - `手机|phone|mobile` → `phone`
   - `邮箱|email|e-mail` → `email`
   - `身份证|ID.?card|身份证号` → `idCard`
   - `地址|address|addr` → `address`
   - `姓名|full.?name|真实姓名` → `fullName`
   - `密码|password|pwd` → `password`
   - `验证码|captcha|verification.?code` → `captcha`
   - `日期|date|birthday|生日` → `date`
2. **Keyboard fallback** — if no pattern matches, the field's `keyboardType` is mapped:
   - `phone`/`emailAddress`/`number`/`url`/`visiblePassword` → corresponding type
3. **Default** — `'text'`

## Constructor

```typescript
constructor()
```

## Public Methods

### `infer(fields): Map<string, SemanticType>`

Returns a map of `field.id → SemanticType`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `fields` | `FormFieldMeta[]` | All extracted form fields |

## Example

```typescript
const inferrer = new SemanticInferrer();
const types = inferrer.infer(fields);
```

## Related

- **Used by:** [FormHelper](./FormHelper.md)
- **Source:** `packages/fliwright-core/src/SemanticInferrer.ts`
