---
module: "AssertionSuggester"
package: "@fliwright/core"
source: "src/AssertionSuggester.ts"
generated: "2026-06-02"
---

# AssertionSuggester

> Suggests assertion placements after recording user interactions.

## Overview

Analyzes recorded operations and identifies points where assertions should be added based on heuristics: navigation taps (top of screen), form submissions, list item selections, and large Y-position changes.

## Public Methods

### `suggest(operations: RecordedOperation[]): AssertionSuggestion[]`

Returns suggestion objects with `afterIndex`, `reason`, and `template` fields.

## Heuristic Rules

| Rule | Trigger | Suggestion |
|------|---------|------------|
| Navigation tap | Tap at y < 100 | Assert expected page content |
| Form submit | Tap after recent type input | Assert submission result |
| List selection | Tap after drag | Assert detail page content |
| Page change | Large Y-position jump | Assert expected page loaded |

## Related

- **Used by:** CLI `record` command
- **Source:** `src/AssertionSuggester.ts`
