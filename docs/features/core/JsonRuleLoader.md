---
module: "JsonRuleLoader"
package: "@fliwright/core"
source: "src/JsonRuleLoader.ts"
generated: "2026-06-01"
---

# JsonRuleLoader

> Loads form-filling rules from JSON files and converts them to FormSkill entries.

## Overview

`JsonRuleLoader` discovers and parses `fliwright.form-rules.json` files and directories containing rule files. Each rule specifies match criteria, a type (preset, regexp, or LLM), and optional data patterns.

## Constructor

```typescript
constructor(projectRoot?: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectRoot` | `string` | Default: `process.cwd()` |

## Public Methods

### `loadFromFile(filePath: string): FormSkill[]`

Loads skills from a single JSON file.

### `loadFromDir(dirPath: string): FormSkill[]`

Loads skills from all `.json` files in a directory.

### `autoDiscover(): FormSkill[]`

Auto-discovers rules from `fliwright.form-rules.json` and `fliwright.form-rules/` directory in the project root.

## Discovery Paths

| Path | Description |
|------|-------------|
| `<projectRoot>/fliwright.form-rules.json` | Single rules file |
| `<projectRoot>/fliwright.form-rules/` | Directory of rule files |

## Related

- **Used by:** [FormHelper](./FormHelper.md)
- **Source:** `src/JsonRuleLoader.ts`
