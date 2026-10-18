---
command: "run"
group: execution
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright run

Run selected Vitest automation tests and save canonical run evidence.

## When to use

Use for finite verification and CI. Attach to an app with --vm-url, or launch and own one with --device-id.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- vmUrl and deviceId are mutually exclusive. Without either, configured endpoint resolution/discovery is used.
- The named --scenario is prepared before each attempt, including retries. Strict startup isolation needs a managed app with waiting bootstrap.
- --timeout is the test timeout in milliseconds; --deadline bounds the whole command, including launch and finalization.
- --output writes a JSON report; --junit-output writes XML independently. --json cannot be combined with a non-JSON --reporter.
- Managed apps stop at completion unless keepAppAlive is true. --session does not route run through the connection host.
- Exit 1 means failed tests; exit 3 means runner/environment/finalization failure. Upload artifacts on every CI outcome.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `deviceId` | `--device-id` | string | no | — | Flutter device id for an owned launch; mutually exclusive with vmUrl. (minLength=1) |
| `target` | `--target` | string | no | — | Flutter entrypoint for a managed launch, e.g. lib/main_fliwright.dart. (minLength=1) |
| `flutterArgs` | `--flutter-args` | array<string> | no | — | Additional flutter launch arguments as an array; repeat the flag or supply a JSON array. |
| `keepAppAlive` | `--keep-app-alive` | boolean | no | — | Retain the managed app when this command releases its runtime. Does not grant ownership of an attached app. |
| `test` | `--test` | string | no | — | Vitest file pattern to select automation tests. (minLength=1) |
| `testName` | `--test-name` | string | no | — | Test-name selection or generated test name; see this command’s usage. (minLength=1) |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `reporter` | `--reporter` | "pretty" \| "json" \| "junit" | no | — | Human/JSON/JUnit stdout rendering. With --json, only json is accepted. |
| `timeout` | `--timeout` | integer | no | — | Milliseconds for the test runner, target wait or extended action, depending on the command. (exclusiveMinimum=0) |
| `screenshot` | `--screenshot` | "file" \| "base64" \| "off" | no | — | Runner screenshot evidence policy: file, base64 or off. |
| `recordingMode` | `--recording-mode` | "standard" \| "full" \| "off" | no | — | Runner timeline/recording evidence level. |
| `output` | `--output` | string | no | — | Write the JSON run report here. Use junitOutput for XML. (minLength=1) |
| `junitOutput` | `--junit-output` | string | no | — | Path for a separate JUnit XML report, including failed runs. (minLength=1) |
| `runsRoot` | `--runs-root` | string | no | — | Canonical run directory. Overrides config/FLIWRIGHT_RUNS_ROOT; default <project>/.fliwright/runs. Relative paths use the project root. (minLength=1) |
| `scenario` | `--scenario` | string | no | — | Named composed TestScenario in fliwright.config; resolve it before execution. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Attach, run a named baseline, retain CI evidence

```sh
fliwright run --vm-url "$VM_URL" --test '.fliwright/tests/**/*.test.ts' --scenario 'logged-in' --junit-output 'artifacts/junit.xml' --runs-root 'artifacts/runs' --deadline '180000' --json
```

### Launch a device for a finite run

```sh
fliwright run --device-id 'DEVICE_ID' --target 'lib/main_fliwright.dart' --test '.fliwright/tests/counter.test.ts' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| passed / totalTests / passedTests / failedTests | Business test outcome and counts. |
| results | Per-test outcomes and durations. |
| runnerErrors | Collection, process or runtime failures, distinct from assertions. |
| failures | Assertion context and evidence. |
| artifacts | runId, outputDir and report/manifest/screenshot/timeline paths. |

## Effects and failure handling

Registry effects: `app`, `run-artifacts`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "deviceId": {
      "type": "string",
      "minLength": 1
    },
    "target": {
      "type": "string",
      "minLength": 1
    },
    "flutterArgs": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "keepAppAlive": {
      "type": "boolean"
    },
    "test": {
      "type": "string",
      "minLength": 1
    },
    "testName": {
      "type": "string",
      "minLength": 1
    },
    "vmUrl": {
      "type": "string",
      "minLength": 1
    },
    "reporter": {
      "type": "string",
      "enum": [
        "pretty",
        "json",
        "junit"
      ]
    },
    "timeout": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "screenshot": {
      "type": "string",
      "enum": [
        "file",
        "base64",
        "off"
      ]
    },
    "recordingMode": {
      "type": "string",
      "enum": [
        "standard",
        "full",
        "off"
      ]
    },
    "output": {
      "type": "string",
      "minLength": 1
    },
    "junitOutput": {
      "type": "string",
      "minLength": 1
    },
    "runsRoot": {
      "type": "string",
      "minLength": 1
    },
    "scenario": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema run --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [doctor](./command-doctor.md) — Check local tooling, configuration and the Flutter automation connection.
- [scenario list](./command-scenario.list.md) — List named scenarios declared in project configuration.
- [artifacts failures](./command-artifacts.failures.md) — Extract saved assertion failures and runner errors from a run.
- [artifacts export](./command-artifacts.export.md) — Export a saved run and its referenced evidence to a directory.
- [Command index](./index.md)
