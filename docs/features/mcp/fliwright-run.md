---
module: "fliwright_run"
package: "@fliwright/mcp"
source: "src/tools/runTest.ts"
generated: "2026-06-02"
---

# `fliwright_run`

> Run a single Fliwright test file (optionally a single test within it) via Vitest and return a structured pass/fail summary.

## Description

`fliwright_run` is the primary execution surface for AI agents. It resolves the VM Service URL (parameter or `FLIWRIGHT_VM_URL`), spawns Vitest in JSON-reporter mode against `testFile`, parses the result into a `RunResult`, and stores failures in the shared `ServerState` so the next `fliwright_get_failure` call can read them.

## Input Schema

```typescript
{
  testFile: string;             // required, path to .test.ts
  vmServiceUrl?: string;        // optional, falls back to FLIWRIGHT_VM_URL
  testName?: string;            // optional, run a single test by name
  cwd?: string;                 // optional, Vitest working directory
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `testFile` | string | Yes | — | Path to the test file |
| `vmServiceUrl` | string | No | `process.env.FLIWRIGHT_VM_URL` | Dart VM Service WebSocket URL |
| `testName` | string | No | — | Run only the test matching this name |
| `cwd` | string | No | server process cwd | Working directory for Vitest |

## Output

Returns a JSON-serialized `RunResult`:

| Field | Type | Description |
|-------|------|-------------|
| `passed` | boolean | True if every test passed |
| `totalTests` | number | Total tests run |
| `passedTests` | number | Number passing |
| `failedTests` | number | Number failing |
| `duration` | number | Total run duration in ms |
| `results` | array | Per-test results: `{ name, status, duration, error? }` |

## Errors

- Throws `Error('No VM Service URL provided...')` if neither `vmServiceUrl` nor `FLIWRIGHT_VM_URL` is set.
- Propagates non-zero Vitest exit codes as a `RunResult` with `passed: false` rather than throwing.

## Example

```json
{
  "name": "fliwright_run",
  "arguments": {
    "testFile": "tests/login.test.ts",
    "vmServiceUrl": "ws://127.0.0.1:54321/abc=",
    "testName": "authenticates with valid credentials"
  }
}
```
