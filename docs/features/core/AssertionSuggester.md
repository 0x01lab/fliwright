---
module: "AssertionSuggester"
package: "@fliwright/core"
source: "src/AssertionSuggester.ts"
tests: "tests/AssertionSuggester.test.ts"
generated: "2026-06-02"
---

# AssertionSuggester

> Heuristics that propose follow-up `expect()` calls after a sequence of recorded operations.

## Overview

After `RecorderController.stop()` produces generated code, the suggester scans the operation list for patterns that imply a state change worth asserting (navigation tap, form submit, list-item selection, large Y-position change).

## Constructor

```typescript
constructor()
```

## Public Methods

### `suggest(operations): AssertionSuggestion[]`

Each suggestion is `{ afterIndex, reason, template }`.

| Rule | Trigger |
|------|---------|
| Top-of-screen tap | `op.kind === 'tap' && op.position.y < 100` |
| Form submit | `tap` following a `type` within 10s |
| List item selection | `tap` immediately after a `drag` |
| Large Y change | Next op's Y is at least 200px lower than current tap |

**Returns:** `AssertionSuggestion[]` — suggestions, each containing a `template` like `// TODO: Assert expected page content`.

## Example

```typescript
const suggestions = new AssertionSuggester().suggest(operations);
for (const s of suggestions) {
  console.log(`after op ${s.afterIndex}: ${s.reason}`);
}
```

## Related

- **Source:** `packages/fliwright-core/src/AssertionSuggester.ts`
