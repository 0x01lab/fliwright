---
command: "script"
group: execution
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright script

Execute one automation script through the same runner and evidence pipeline as run.

## When to use

Use for an app task stored as a TypeScript script, such as data setup or a repeatable navigation workflow.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- file is required; it becomes the runner test pattern. Other runner flags have the same meaning as run.
- The script can mutate arbitrary app state. Use a named scenario when a repeatable baseline is needed.
- --session does not reuse the session driver for script execution.

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
| `file` | `positional file` | string | yes | — | Automation file to execute or focus; interpreted relative to cwd. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Execute a project script

```sh
fliwright script '.fliwright/scripts/seed.script.ts' --vm-url "$VM_URL" --scenario 'logged-in' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| passed | Whether script execution passed. |
| results | Script/test entries returned by the runner. |
| artifacts | Canonical run identity and evidence locations. |
| runnerErrors | Runner failures, if any. |

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
    },
    "file": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "file"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema script --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [run](./command-run.md) — Run selected Vitest automation tests and save canonical run evidence.
- [scenario resolve](./command-scenario.resolve.md) — Resolve one named composed scenario without applying it.
- [artifacts show](./command-artifacts.show.md) — Read a saved run report, manifest and the available run list.
- [Command index](./index.md)
