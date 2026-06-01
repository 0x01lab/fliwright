---
module: "fliwright_run"
package: "@fliwright/mcp"
source: "src/tools/runTest.ts"
generated: "2026-06-01"
---

# fliwright_run

> Run a Fliwright test file and return pass/fail results.

## Input Schema

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `testFile` | `string` | Yes | Path to the `.test.ts` file to run |
| `vmServiceUrl` | `string` | No | Dart VM Service WebSocket URL (falls back to `FLIWRIGHT_VM_URL` env) |
| `testName` | `string` | No | Run only the test matching this name |
| `cwd` | `string` | No | Working directory for Vitest |

## Output: RunResult

| Field | Type | Description |
|-------|------|-------------|
| `passed` | `boolean` | Whether all tests passed |
| `totalTests` | `number` | Total number of tests |
| `passedTests` | `number` | Number of passed tests |
| `failedTests` | `number` | Number of failed tests |
| `duration` | `number` | Total duration in ms |
| `results` | `{ name, passed, duration, error? }[]` | Per-test results |

## Behavior

1. Resolves VM Service URL from params or `FLIWRIGHT_VM_URL` environment variable
2. Spawns Vitest with `--reporter=json` to run the test file
3. Optionally filters by test name pattern
4. Parses JSON output and collects failure context
5. Stores results and failures in server state

## Error Handling

- Throws if `vmServiceUrl` is not provided and not in environment
- Returns `passed: false` with error details on test failure
