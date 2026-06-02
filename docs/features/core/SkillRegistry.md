---
module: "SkillRegistry"
package: "@fliwright/core"
source: "src/SkillRegistry.ts"
generated: "2026-06-02"
---

# SkillRegistry

> Registry for form-filling skills with pattern-based matching.

## Overview

Stores `FormSkill` objects and matches form fields against them. Skills provide custom `match` predicates and `generate` functions, overriding the default FakerGenerator behavior.

## Public Methods

### `register(skill: FormSkill): void`

Registers a form skill.

### `match(field: FormFieldMeta): FormSkill | null`

Returns the first matching skill, or null.

### `clear(): void`

Removes all registered skills.

## Related

- **Used by:** [FormHelper](./FormHelper.md), [JsonRuleLoader](./JsonRuleLoader.md)
- **Source:** `src/SkillRegistry.ts`
