---
module: "AssertionSuggester"
package: "@fliwright/core"
source: "src/AssertionSuggester.ts"
generated: "2026-06-01"
---

# AssertionSuggester

> Suggests assertions based on patterns in recorded operations.

## Overview

`AssertionSuggester` analyzes a sequence of recorded operations and identifies points where assertions would be valuable. It uses heuristic rules to detect navigation, form submission, and list selection patterns.

## Constructor

```typescript
constructor()
```

## Public Methods

### `suggest(operations: RecordedOperation[]): AssertionSuggestion[]`

Returns an array of assertion suggestions.

**Returns:** `AssertionSuggestion[]`

## AssertionSuggestion

| Field | Type | Description |
|-------|------|-------------|
| `afterIndex` | `number` | Operation index after which to insert assertion |
| `reason` | `string` | Human-readable reason for the suggestion |
| `template` | `string` | Code template for the assertion |

## Detection Rules

| Rule | Pattern | Suggestion |
|------|---------|------------|
| 1 | Tap at top of screen (y < 100) | Navigation assertion |
| 2 | Tap after recent type input (< 10s) | Form submit assertion |
| 3 | Tap after drag | List item selection assertion |
| 4 | Large Y position drop (> 200px) | Navigation assertion |

## Related

- **Used by:** Recording pipeline
- **Source:** `src/AssertionSuggester.ts`
