---
command: "record"
group: execution
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright record

Capture user interactions and produce recording, flow and automation draft evidence.

## When to use

Use when a human demonstrates a workflow. Prefer --duration for bounded automation and CI capture.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- --duration is seconds. Without it, recording waits for an interrupt; first SIGINT stops and flushes, second cancels.
- mode defaults to script; omitted output selects a default generated target under the configured scripts/tests directory. --output overrides that target, but draft readiness blocks publishing.
- --scenario identifies the generation/replay baseline; recording does not apply it before capture. Prepare current app state before demonstrating the workflow. Test-mode readiness needs confirmed assertions and a deterministic scenario.
- --flow-output saves the flow independently. Use --verify true for replay evidence and inspect readiness/issues even with exit 0.
- Dart output requires a package URI entrypoint, e.g. package:my_app/main_fliwright.dart, compatible with integration_test. Executable verification uses --dart-verification. TypeScript and Dart readiness requirements differ.
- --session does not route recording through the host. Recordings own their connection/lease and release it before verification replay.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `output` | `--output` | string | no | — | Candidate generated automation file; draft readiness can prevent this file being written. (minLength=1) |
| `flowOutput` | `--flow-output` | string | no | — | Optional path to write the flow derived from a recording. (minLength=1) |
| `lang` | `--lang` | "ts" \| "dart" | no | — | Generated automation language for recording; effective default ts. |
| `mode` | `--mode` | "script" \| "test" | no | — | Command-specific execution/generation/synchronization mode; see conditions above. |
| `scenario` | `--scenario` | string | no | — | Named composed TestScenario in fliwright.config; resolve it before execution. (minLength=1) |
| `assertions` | `--assertions` | string | no | — | Path to recording checkpoint/assertion JSON, not inline assertion text. (minLength=1) |
| `verify` | `--verify` | boolean | no | — | Request candidate replay verification; inspect readiness and blockers afterwards. |
| `name` | `--name` | string | no | — | Generated test/script name. (minLength=1) |
| `homeRoute` | `--home-route` | string | no | — | Home route for reset/generation; commonly /. (minLength=1) |
| `resetHome` | `--reset-home` | boolean | no | — | Generate recording home-route reset hooks. |
| `duration` | `--duration` | number | no | — | Recording capture duration in seconds, can be fractional. Omit to wait for SIGINT. (exclusiveMinimum=0) |
| `dartAppEntrypoint` | `--dart-app-entrypoint` | string | no | — | Package URI for generated Dart integration-test import, e.g. package:my_app/main_fliwright.dart. (minLength=1) |
| `dartVerification` | `--dart-verification` | string | no | — | Path to Dart verification evidence JSON. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Capture a bounded TypeScript test candidate

```sh
fliwright record --vm-url "$VM_URL" --duration '20' --mode 'test' --lang 'ts' --output '.fliwright/tests/recorded.test.ts' --flow-output '.fliwright/flows/recorded.flow.json' --verify 'true' --scenario 'logged-in' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| code | Generated source; may still be a draft. |
| operations | Captured operations. |
| flow | Flow derived from the recording. |
| readiness | Readiness state, verification run identities and issues. |
| recordingPath / blockers | Saved recording path when present and reasons output is not ready. |

## Effects and failure handling

Registry effects: `app`, `recording-artifacts`, `generated-files`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "vmUrl": {
      "type": "string",
      "minLength": 1
    },
    "output": {
      "type": "string",
      "minLength": 1
    },
    "flowOutput": {
      "type": "string",
      "minLength": 1
    },
    "lang": {
      "type": "string",
      "enum": [
        "ts",
        "dart"
      ]
    },
    "mode": {
      "type": "string",
      "enum": [
        "script",
        "test"
      ]
    },
    "scenario": {
      "type": "string",
      "minLength": 1
    },
    "assertions": {
      "type": "string",
      "minLength": 1
    },
    "verify": {
      "type": "boolean"
    },
    "name": {
      "type": "string",
      "minLength": 1
    },
    "homeRoute": {
      "type": "string",
      "minLength": 1
    },
    "resetHome": {
      "type": "boolean"
    },
    "duration": {
      "type": "number",
      "exclusiveMinimum": 0
    },
    "dartAppEntrypoint": {
      "type": "string",
      "minLength": 1
    },
    "dartVerification": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema record --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [scenario list](./command-scenario.list.md) — List named scenarios declared in project configuration.
- [flow get](./command-flow.get.md) — Read one complete flow document.
- [run](./command-run.md) — Run selected Vitest automation tests and save canonical run evidence.
- [Command index](./index.md)
