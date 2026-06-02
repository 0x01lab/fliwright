---
module: "JsonRuleLoader"
package: "@fliwright/core"
source: "src/JsonRuleLoader.ts"
tests: "tests/JsonRuleLoader.test.ts"
generated: "2026-06-02"
---

# JsonRuleLoader

> Load `FormSkill` instances from `.fliwright/form-rules.json` files.

## Overview

The loader supports three rule types — `PRESET_SKILL`, `LLM_GENERATE`, and `REGEXP_MOCK`. Each rule specifies a `match` object whose keys are field-property names (`id`, `selector`, `type`, `hintText`, `label`, `keyboardType`, `key`, `ancestorKey`, `name`, `semanticsId`, `semanticsLabel`, `semanticsHint`, `role`, `semanticType`).

## Constructor

```typescript
constructor(projectRoot?: string)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `projectRoot` | string | `process.cwd()` | Used by `autoDiscover` |

## Public Methods

### `loadFromFile(filePath): FormSkill[]`

Returns `[]` if the file is missing or unparsable.

### `loadFromDir(dirPath): FormSkill[]`

Loads every `*.json` file in the directory.

### `autoDiscover(): FormSkill[]`

Loads `<projectRoot>/fliwright.form-rules.json` (single file) and `<projectRoot>/fliwright.form-rules/` (directory).

## File Format

```json
{
  "version": 1,
  "rules": [
    {
      "type": "PRESET_SKILL",
      "match": { "hintText": "公司名称" },
      "data": ["ACME", "Globex"]
    },
    {
      "type": "REGEXP_MOCK",
      "match": { "label": "订单号" },
      "pattern": "ORD-\\d{8}"
    }
  ]
}
```

## Example

```typescript
const loader = new JsonRuleLoader(process.cwd());
const skills = loader.autoDiscover();
const registry = new SkillRegistry();
for (const s of skills) registry.register(s);
```

## Related

- **Used by:** [FormHelper](./FormHelper.md)
- **Source:** `packages/fliwright-core/src/JsonRuleLoader.ts`
