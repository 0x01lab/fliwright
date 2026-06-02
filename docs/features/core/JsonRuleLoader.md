---
module: "JsonRuleLoader"
package: "@fliwright/core"
source: "src/JsonRuleLoader.ts"
generated: "2026-06-02"
---

# JsonRuleLoader

> Loads form-filling rules from JSON files (PRESET_SKILL, REGEXP_MOCK, LLM_GENERATE).

## Overview

Reads `fliwright.form-rules.json` or `fliwright.form-rules/*.json` files. Each rule defines a `match` object (field attribute patterns), a `type` (PRESET_SKILL, REGEXP_MOCK, or LLM_GENERATE), and type-specific `data` or `pattern`. Uses `randexp` for regex-based generation.

## Constructor

```typescript
constructor(projectRoot?: string)
```

## Public Methods

### `loadFromFile(filePath: string): FormSkill[]`

Loads skills from a single JSON file.

### `loadFromDir(dirPath: string): FormSkill[]`

Loads skills from all `.json` files in a directory.

### `autoDiscover(): FormSkill[]`

Auto-discovers rules from `fliwright.form-rules.json` and `fliwright.form-rules/` directory.

## Related

- **Used by:** [FormHelper](./FormHelper.md)
- **Source:** `src/JsonRuleLoader.ts`
