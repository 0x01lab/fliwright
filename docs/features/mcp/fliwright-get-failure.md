---
module: "fliwright_get_failure"
package: "@fliwright/mcp"
source: "src/tools/getFailure.ts"
generated: "2026-06-02"
---

# `fliwright_get_failure`

> Get detailed failure context from the most recent test run, including widget tree, source location, and self-healing suggestions.

## Description

After `fliwright_run` populates the server state with failure entries, an agent calls this tool to retrieve structured diagnostics. Each entry includes the failing assertion's matcher/expected/actual, the live widget tree, source file/line/snippet, and the most recent `HealingReport` (suggested selector + per-dimension confidence scores) emitted by the [self-healing pipeline](../self-healing-pipeline.md).

## Input Schema

```typescript
{
  testName?: string;  // optional filter
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `testName` | string | No | Return only failures for this test; omit to return all |

## Output

```typescript
{
  failures: Array<{
    testName: string;
    assertion: { matcher, expected, actual, timeout };
    widgetTree: object;
    source: { file, line, snippet };
    healingSuggestion?: {
      originalSelector: string;
      suggestedSelector: string;
      confidence: number;
      scores: { position, context, codeBinding, text, weighted };
    };
    timestamp: string;
  }>;
}
```

## Errors

- Returns `{ failures: [] }` (not an error) if no failures have been recorded or if `testName` doesn't match anything.

## Example

```json
{
  "name": "fliwright_get_failure",
  "arguments": { "testName": "authenticates with valid credentials" }
}
```
