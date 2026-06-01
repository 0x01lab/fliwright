---
module: "fliwright_get_failure"
package: "@fliwright/mcp"
source: "src/tools/getFailure.ts"
generated: "2026-06-01"
---

# fliwright_get_failure

> Get detailed failure context from the most recent test run, including widget tree, source location, and self-healing suggestions.

## Input Schema

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `testName` | `string` | No | Filter to a specific test name |

## Output: GetFailureResult

| Field | Type | Description |
|-------|------|-------------|
| `failures` | `FailureEntry[]` | Array of failure entries |

## FailureEntry

| Field | Type | Description |
|-------|------|-------------|
| `testName` | `string` | Test name |
| `assertion` | `{ matcher, expected, actual, timeout }` | Assertion details |
| `widgetTree` | `object` | Widget tree at failure point |
| `source` | `{ file, line, snippet }` | Source code location |
| `healingSuggestion` | `{ originalSelector, suggestedSelector, confidence, scores }?` | Self-healing suggestion |
| `timestamp` | `string` | ISO timestamp |
