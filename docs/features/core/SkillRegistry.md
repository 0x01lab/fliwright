---
module: "SkillRegistry"
package: "@fliwright/core"
source: "src/SkillRegistry.ts"
tests: "tests/SkillRegistry.test.ts"
generated: "2026-06-02"
---

# SkillRegistry

> Ordered list of `FormSkill` instances; first-match-wins.

## Overview

A skill is `{ name, type, match, generate }`. The registry iterates in insertion order and returns the first skill whose `match(field)` returns `true`. Skills are typically built by `JsonRuleLoader` from `.fliwright/form-rules.json` files.

## Constructor

```typescript
constructor()
```

## Public Methods

### `register(skill): void`

Append a skill.

### `match(field): FormSkill | null`

Return the first matching skill, or `null`.

### `clear(): void`

Remove all skills.

## Example

```typescript
const registry = new SkillRegistry();
registry.register({
  name: 'company-name',
  type: 'PRESET_SKILL',
  match: (f) => /公司/.test(f.hintText ?? ''),
  generate: () => 'ACME Inc.',
});
const skill = registry.match(field);
```

## Related

- **Used by:** [FormHelper](./FormHelper.md), [JsonRuleLoader](./JsonRuleLoader.md)
- **Source:** `packages/fliwright-core/src/SkillRegistry.ts`
