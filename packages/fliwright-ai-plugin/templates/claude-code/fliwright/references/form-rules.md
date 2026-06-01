# Form Rules Schema

## File Location

- Form rules: `.fliwright/forms/<name>.json`
- Naming: use kebab-case describing the form, e.g. `login.json`, `registration.json`, `checkout.json`

## FormRulesFile

```typescript
interface FormRulesFile {
  version: 1;                          // Always 1
  locale?: string;                     // Locale hint, e.g. "zh-CN", "en-US"
  rules: FormRule[];                   // Array of field matching rules
}
```

### FormRule

```typescript
interface FormRule {
  match: {
    label?: string;                    // Match by form field label text
    hintText?: string;                 // Match by hint/placeholder text
    semanticType?: string;             // Match by semantic type
    // At least one key required
  };
  type: "PRESET_SKILL" | "REGEXP_MOCK" | "LLM_GENERATE";
  pattern?: string;                    // Required for REGEXP_MOCK — regex pattern string
  data?: string[];                     // Required for PRESET_SKILL — list of preset values
}
```

### Rule Types

| Type | When to use | Required fields |
|------|-------------|-----------------|
| `REGEXP_MOCK` | Fields with a known format pattern (phone, ID card, date) | `pattern` |
| `PRESET_SKILL` | Fields with a fixed set of valid values (email, password, dropdown) | `data` |
| `LLM_GENERATE` | Complex fields requiring context-aware generation (address, bio) | (none) |

### Match Key Selection Priority

1. **`label`** — preferred when the field has a visible label (most reliable)
2. **`hintText`** — use when label is absent but placeholder/hint exists
3. **`semanticType`** — fallback when neither label nor hintText is predictable

Only include one match key per rule. Multiple rules can match different fields in the same form.

## Semantic Field Mapping

Use this table to select the correct strategy for common field types:

| Field | Match by | Type | Config |
|-------|----------|------|--------|
| Phone (China) | `label: "手机号"` / `label: "联系电话"` | `REGEXP_MOCK` | `pattern: "1[3-9][0-9]{9}"` |
| Phone (US) | `label: "Phone"` / `label: "Mobile"` | `REGEXP_MOCK` | `pattern: "[2-9][0-9]{2}[2-9][0-9]{6}"` |
| Email | `label: "邮箱"` / `label: "Email"` | `PRESET_SKILL` | `data: ["test.user@example.com", "qa.user@example.com"]` |
| Password | `label: "密码"` / `label: "Password"` | `PRESET_SKILL` | `data: ["Test@123456"]` |
| Captcha (6-digit) | `hintText: "请输入验证码"` / `hintText: "Enter code"` | `REGEXP_MOCK` | `pattern: "[0-9]{6}"` |
| ID Card (China) | `label: "身份证"` / `label: "身份证号"` | `REGEXP_MOCK` | `pattern: "[1-9][0-9]{5}(19|20)[0-9]{2}[01][0-9][0123][0-9][0-9]{3}[0-9Xx]"` |
| Name | `label: "姓名"` / `label: "Name"` | `PRESET_SKILL` | `data: ["张三", "李四"]` or `["John Doe", "Jane Smith"]` |
| Address | `label: "地址"` / `label: "Address"` | `LLM_GENERATE` | (context-aware generation) |
| Amount | `label: "金额"` / `label: "Amount"` | `REGEXP_MOCK` | `pattern: "[0-9]+\\.?[0-9]{0,2}"` |
| URL | `label: "网址"` / `label: "URL"` | `PRESET_SKILL` | `data: ["https://example.com"]` |
| Date | `label: "日期"` / `label: "Date"` | `REGEXP_MOCK` | `pattern: "20[0-9]{2}-[01][0-9]-[0123][0-9]"` |
| Generic text | Any unmatched field | `LLM_GENERATE` | (fallback for uncommon fields) |

## Validation Rules

- `version` must be `1`
- Each rule must have exactly one match key (`label`, `hintText`, or `semanticType`)
- `REGEXP_MOCK` rules must include `pattern`
- `PRESET_SKILL` rules must include `data` (non-empty array)
- `LLM_GENERATE` rules need neither `pattern` nor `data`
- Match values should be in the same language as the app's locale

## Full Example

`.fliwright/forms/form-rules.json`:
```json
{
  "version": 1,
  "locale": "zh-CN",
  "rules": [
    {
      "match": { "label": "手机号" },
      "type": "REGEXP_MOCK",
      "pattern": "1[3-9][0-9]{9}"
    },
    {
      "match": { "label": "邮箱" },
      "type": "PRESET_SKILL",
      "data": ["test.user@example.com", "qa.user@example.com"]
    },
    {
      "match": { "hintText": "请输入验证码" },
      "type": "REGEXP_MOCK",
      "pattern": "[0-9]{6}"
    },
    {
      "match": { "label": "密码" },
      "type": "PRESET_SKILL",
      "data": ["Test@123456"]
    },
    {
      "match": { "label": "地址" },
      "type": "LLM_GENERATE"
    }
  ]
}
```
