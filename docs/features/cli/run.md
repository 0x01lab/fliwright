---
module: "runCommand"
package: "@fliwright/cli"
source: "src/commands/run.ts"
generated: "2026-06-02"
---

# `fliwright run`

> Runs Fliwright tests by spawning Vitest as a child process with the resolved VM Service URL and MCP failure-context env vars injected.

## Overview

`runCommand` is the primary CLI entry point. It loads `fliwright.config.ts`, resolves the Flutter VM Service URL (CLI flag → env var → config → auto-discovery), spawns `vitest run --reporter=json` against the configured `testDir`, parses the JSON report into a `CliRunResult`, then formats and prints it using the chosen reporter. A non-zero exit code is returned to the parent process on any failure.

## Signature

```typescript
export interface RunOptions {
  testPattern?: string;
  vmUrl?: string;
  reporter?: 'pretty' | 'json' | 'junit';
  timeout?: number;
  screenshot?: 'file' | 'base64' | 'off';
  cwd?: string;
}

export interface RunDeps {
  resolveVmUrl?: (options: { cliFlag?: string; configUrl?: string }) => Promise<string | null>;
  onVmResolved?: (url: string) => void;
}

export interface CliRunResult {
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  duration: number;
  results: CliTestResult[];
}

export async function runCommand(options: RunOptions, deps?: RunDeps): Promise<CliRunResult>;
```

## Flags

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--test <pattern>` | `string` | No | `<testDir>/**/*.test.ts` | Test file or glob pattern passed to Vitest. |
| `--vm-url <url>` | `string` | No | Resolved via [vm-discovery](./vm-discovery.md) | Dart VM Service WebSocket URL. |
| `--reporter <format>` | `'pretty' \| 'json' \| 'junit'` | No | `'pretty'` (or `config.reporter`) | Output format. See [reporter](./reporter.md). |
| `--timeout <ms>` | `number` | No | `30000` (from config) | Per-test timeout in milliseconds. |
| `--screenshot <mode>` | `'file' \| 'base64' \| 'off'` | No | `'file'` (from config) | Screenshot mode forwarded via env. |
| `--cwd` (programmatic only) | `string` | No | `process.cwd()` | Working directory for config loading. |

## Output

The command always prints the formatted result to stdout:

- **`pretty`** — colored per-test pass/fail with chalk green / red icons and a summary line.
- **`json`** — `CliRunResult` pretty-printed as 2-space-indented JSON.
- **`junit`** — well-formed `testsuites` XML with one `testsuite` named `fliwright`; failed tests get `<failure message="...">` children.

The CLI binary (`src/index.ts`) calls `process.exit(result.passed ? 0 : 1)` after the command resolves.

## Vitest Integration

Internally, `runCommand`:

1. Resolves `require.resolve('vitest/vitest.mjs')` so it works with the consumer's installed Vitest version.
2. Creates a temp dir via `mkdtemp(tmpdir(), 'fliwright-cli-failures-')` and sets `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH=<dir>/failures.json`. This is what enables the [vitest `expect()` failure-context writer](../vitest/expect.md).
3. Sets `FLIWRIGHT_VM_URL` so the [default `test` export](../vitest/test.md) picks up the resolved URL.
4. Spawns `node <vitest> run <pattern> --reporter=json`, captures stdout, parses the JSON report (see `parseVitestOutput`).
5. Cleans up the temp dir in a `finally` block — failure context is ephemeral and only kept for the duration of the run.

## Example

```bash
# Default run
npx fliwright run

# Filtered with JSON output
npx fliwright run --test "tests/login/**" --reporter json > results.json

# Pin a specific VM Service URL
npx fliwright run --vm-url ws://127.0.0.1:54321/ws
```

Programmatic:

```typescript
import { runCommand } from '@fliwright/cli';

const result = await runCommand({
  testPattern: 'tests/**/*.test.ts',
  reporter: 'json',
  cwd: '/path/to/project',
});

if (!result.passed) {
  console.error(`${result.failedTests} test(s) failed`);
  process.exit(1);
}
```

## Related

- **Depends on:** [vm-discovery](./vm-discovery.md), [config](./config.md), [reporter](./reporter.md), `vitest/vitest.mjs`
- **Spawns:** `@fliwright/vitest`-backed test files, which read `FLIWRIGHT_VM_URL` and `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH`.
- **Source:** `packages/fliwright-cli/src/commands/run.ts`
