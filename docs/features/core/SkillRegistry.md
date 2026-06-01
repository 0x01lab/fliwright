---
module: "SkillRegistry"
package: "@fliwright/core"
source: "src/SkillRegistry.ts"
generated: "2026-06-01"
---

# SkillRegistry

> Registry for custom form-filling skills that override default inference.

## Overview

`SkillRegistry` allows registering custom `FormSkill` entries that can match specific form fields and generate custom values. Skills take priority over the default `SemanticInferrer` + `FakerGenerator` pipeline.

## Constructor

```typescript
constructor()
```

## Public Methods

### `register(skill: FormSkill): void`

Registers a skill.

### `match(field: FormFieldMeta): FormSkill | null`

Finds the first skill that matches the field.

### `clear(): void`

Removes all registered skills.

## Related

- **Used by:** [FormHelper](./FormHelper.md), [JsonRuleLoader](./JsonRuleLoader.md)
- **Source:** `src/SkillRegistry.ts`
