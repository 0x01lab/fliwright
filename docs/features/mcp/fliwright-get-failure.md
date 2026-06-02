---
module: "fliwright_get_failure"
package: "@fliwright/mcp"
source: "src/tools/getFailure.ts"
generated: "2026-06-02"
---

# fliwright_get_failure

> Get detailed failure context from the most recent test run, including widget tree, source location, and self-healing suggestions.

## Input Schema

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `testName` | `string` | No | Filter to a specific test name |

## Output Schema

```typescript
interface GetFailureResult {
  failures: FailureEntry[];
}

interface FailureEntry {
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
}
```

## Behavior

Returns all failure entries from the last `fliwright_run` call, optionally filtered by test name. Each entry includes the widget tree dump, source location, and any self-healing suggestion generated during the test run.
