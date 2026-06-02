---
module: "test_report"
package: "@fliwright/mcp"
source: "src/resources/testReport.ts"
generated: "2026-06-02"
---

# `test_report` Resource

> Read-only MCP resource exposing the most recent `RunResult` produced by `fliwright_run`.

## URI

```
fliwright://test-report/latest
```

## MIME Type

`application/json`

## Description

Reading this resource returns the same `RunResult` object that `fliwright_run` last returned (sans failures, which live on `ServerState` and are surfaced via `fliwright_get_failure`). When no run has happened yet, returns `{ "message": "No test run yet" }`.

## Output Shape

```typescript
{
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  duration: number;
  results: Array<{ name: string; status: string; duration: number; error?: string }>;
}
```

## Example

MCP `resources/read` request:

```json
{ "uri": "fliwright://test-report/latest" }
```

Response:

```json
{
  "contents": [
    {
      "uri": "fliwright://test-report/latest",
      "mimeType": "application/json",
      "text": "{\"passed\":true,\"totalTests\":1,...}"
    }
  ]
}
```
