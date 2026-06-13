# CLI: `fliwright`

The `fliwright` CLI runs tests, scaffolds config, checks your environment, records flows into code,
and hosts the mock controller. **Prefer `fliwright run` over direct `pnpm vitest`** — it emits the
AI/human report, persists screenshots, and prints a reproduce command.

```text
fliwright <command> [options]
  run          Run Fliwright tests
  init         Initialize Fliwright in the current project
  doctor       Check your Fliwright environment
  record       Record user interactions and generate test code
  mock:start   Start the Fliwright tool-side mock controller
```

## `fliwright run`

```text
fliwright run \
  --test <pattern>          Test file or glob pattern
  --test-name <pattern>     Run only tests matching this name
  --vm-url <url>            Dart VM Service WebSocket URL
  --reporter <format>       pretty | json | ai-json | junit   (default pretty)
  --timeout <ms>            Per-test timeout in ms            (default 30000)
  --screenshot <mode>       file | base64 | off              (default file)
  --output <file>           Write the AI run report JSON to this file
```

### What it does

1. Loads `fliwright.config.ts` (via jiti) for defaults — `testDir`, `vmServiceUrl`, `timeout`, `reporter`.
2. Resolves the VM URL: `--vm-url` flag ▸ `config.vmServiceUrl` ▸ auto-discovery (`vm-discovery.ts`
   scans for a running Flutter VM Service).
3. Spawns Vitest with `--reporter=json`, injecting `FLIWRIGHT_VM_URL`,
   `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH`, `FLIWRIGHT_SCREENSHOT_MODE`, `FLIWRIGHT_FAILURE_TIMEOUT_MS`.
4. Reads the failure-context JSON, persists screenshots to `.fliwright/runs/<runId>/screenshots/`.
5. Writes the full report to `.fliwright/runs/<runId>/report.json` (or `--output`).
6. Prints a `reproduceCommand` (`fliwright run --test … --test-name …`) for every run.

### Reporters

| Format | Use |
| --- | --- |
| `pretty` (default) | Human reading in a terminal |
| `json` / `ai-json` | Machine / AI consumption — full result incl. failures + artifacts |
| `junit` | CI integration (Jenkins, GitHub Actions JUnit viewers) |

`CliRunResult` shape:

```typescript
{
  passed: boolean;
  totalTests, passedTests, failedTests, duration: number;
  results: Array<{ name: string; passed: boolean; duration: number; error?: string }>;
  failures?: CliFailureEntry[];   // assertion + widgetTree + diagnostics + source + screenshot + healingSuggestion
  artifacts?: { runId, outputDir, reportPath, screenshots: string[] };
  reproduceCommand: string;
}
```

### Examples

```bash
# Run a single file against a running app
fliwright run --test e2e/form-fill-e2e.test.ts \
  --vm-url "ws://127.0.0.1:54321/abc=/ws" --reporter ai-json

# Run only tests whose name matches
fliwright run --test e2e/form-mock-e2e.test.ts --test-name "submit"

# Pretty report, no screenshots
fliwright run --test "e2e/**/*.test.ts" --reporter pretty --screenshot off

# Write the report to a fixed path for CI
fliwright run --reporter json --output reports/run.json
```

## `fliwright init`

Scaffold Fliwright in the current project: writes `fliwright.config.ts` and the `.fliwright/`
skeleton (forms/, mocks/). Run once when adding Fliwright to an app.

```bash
fliwright init
```

## `fliwright doctor`

Validate the environment: Node/Flutter versions, package resolution, config presence, and (with
`--vm-url`) live bridge capability checks (`ext.fliwright.snap`, `ext.fliwright.action`, …).

```bash
fliwright doctor
fliwright doctor --vm-url "ws://127.0.0.1:54321/abc=/ws"   # runtime bridge checks
```

Run this first when "it doesn't work" — it pinpoints missing bridge extensions.

## `fliwright record`

Record live interactions on the running app and emit a first-draft test.

```text
fliwright record \
  --vm-url <url>             Dart VM Service WebSocket URL
  --output <file>            Output file path
  --lang <ts | dart>         Output language           (default ts)
  --name <name>              Test name                 (default "recorded test")
  --home-route <route>       Navigate here before each generated TS test (default "/")
  --no-reset-home            Do NOT generate a beforeEach hook navigating to home-route
```

```bash
fliwright record --vm-url "ws://127.0.0.1:54321/abc=/ws" \
  --output e2e/recorded.test.ts --lang ts --name "checkout flow"
```

The recorder aggregates raw pointer/text events into semantic operations via `EventAggregator`,
then `CodeGenerator` (TS) or `DartCodeGenerator` (Dart integration_test) renders the file.
**Always clean up the output**: simplify selectors, replace ephemeral refs with query locators,
add assertions. See [mcp-workflow.md](./mcp-workflow.md) for the `fliwright_record` equivalent.

## `fliwright mock:start`

Host the tool-side mock controller as its own process.

```text
fliwright mock:start \
  --host <host>        default 127.0.0.1
  --port <port>        default = random free port
  --mock-dir <dir>     default .fliwright/mocks
```

Point the app at the printed WebSocket URL via `FLIWRIGHT_MOCK_CONTROLLER_URL`. See [mocks.md](./mocks.md).

## Config: `fliwright.config.ts`

`loadConfig()` reads it (via jiti). Recognized fields: `testDir` (default `e2e`), `vmServiceUrl`,
`timeout`, `reporter`. CLI flags override config values override defaults.

```typescript
// fliwright.config.ts
import { defineConfig } from '@fliwright/cli';   // or a plain export

export default defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  reporter: 'pretty',
  // vmServiceUrl: 'ws://127.0.0.1:54321/abc=/ws',
});
```

## Automation: `package.json` scripts

Add per-suite scripts so CI / teammates run the same thing. This pattern is used by the e2e package:

```json
{
  "scripts": {
    "test:form": "fliwright run --test e2e/form-fill-e2e.test.ts",
    "test:form-mock": "fliwright run --test e2e/form-mock-e2e.test.ts",
    "test:mock-e2e": "fliwright run --test e2e/mock-api-e2e.test.ts",
    "test:go-router": "fliwright run --test e2e/go-router-navigation-e2e.test.ts",
    "test:exio": "fliwright run --test e2e/exio-app-e2e.test.ts",
    "test:all": "fliwright run --test \"e2e/**/*.test.ts\""
  }
}
```

Run with the VM URL exported:

```bash
FLIWRIGHT_VM_URL="ws://127.0.0.1:54321/abc=/ws" pnpm test:form-mock
```

## Automation: CI shell sketch

```bash
# 1. start the app detached (example: macOS)
fvm flutter run -d macos --debug &
APP_PID=$!

# 2. wait for the VM Service URL to appear (parse flutter run output, or use vm-discovery)
VM_URL="$(./scripts/wait-for-vm.sh)"

# 3. run the suite, machine-readable report for CI
fliwright run --test "e2e/**/*.test.ts" \
  --vm-url "$VM_URL" --reporter junit --output reports/junit.xml \
  --screenshot file

# 4. tear down
kill $APP_PID
```

`vm-discovery.ts` auto-finds a running VM Service when no `--vm-url`/config is given, so step 2 can
often be omitted.

## Quick smoke (no report)

For a fast local check you can call Vitest directly — but you lose the persisted report:

```bash
FLIWRIGHT_VM_URL="ws://127.0.0.1:54321/abc=/ws" pnpm vitest run path/to/test.ts
```
