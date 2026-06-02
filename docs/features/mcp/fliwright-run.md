---
module: "fliwright_run"
package: "@fliwright/mcp"
source: "src/tools/runTest.ts"
generated: "2026-06-02"
---

# fliwright_run

> Run a Fliwright test file and return structured pass/fail results.

## Input Schema

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `testFile` | `string` | Yes | Path to the .test.ts file to run |
| `vmServiceUrl` | `string` | No | Dart VM Service WebSocket URL (or set FLIWRIGHT_VM_URL) |
| `testName` | `string` | No | Run only the test matching this name |
| `cwd` | `string` | No | Working directory (defaults to server cwd) |

## Output Schema

```typescript
interface RunResult {
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  duration: number;
  results: Array<{
    name: string;
    passed: boolean;
    duration: number;
    error?: string;
  }>;
}
```

## Behavior

1. Resolves VM Service URL from parameter or env var
2. Spawns Vitest with JSON reporter
3. Sets FLIWRIGHT_VM_URL and FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH env vars
4. Reads failure context file if tests failed
5. Returns structured results

## Error Handling

- Throws if no VM Service URL is available
- Returns `passed: false` with error messages for test failures
- Handles malformed Vitest JSON output gracefully
