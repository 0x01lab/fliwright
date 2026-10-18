---
command: "session.open"
group: session
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright session open

Create a reusable local worker connected to an attached or managed Flutter app.

## When to use

Use for repeated exploration, retained diagnostics and persistent TDD.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- vmUrl and deviceId are mutually exclusive. Attach uses explicit/configured/discovered VM endpoint.
- deviceId starts a managed TDD runtime automatically; do not call tdd start again. Attach mode only opens a connection until tdd start.
- Startup budgets are 30 seconds for attach and 180 seconds for managed launch; --deadline may shorten them. Idle workers close after 30 minutes without active work.
- Sessions are project-scoped; keep the same --cwd. A connection session is not a test run or artifact runId.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `deviceId` | `--device-id` | string | no | — | Flutter device id for an owned launch; mutually exclusive with vmUrl. (minLength=1) |
| `target` | `--target` | string | no | — | Flutter entrypoint for a managed launch, e.g. lib/main_fliwright.dart. (minLength=1) |
| `config` | `--config` | string | no | — | TDD configuration root; resolved relative to cwd. (minLength=1) |
| `projectId` | `--project-id` | string | no | — | Flutter project directory passed to managed launch; defaults to cwd. (minLength=1) |
| `flutterArgs` | `--flutter-args` | array<string> | no | — | Additional flutter launch arguments as an array; repeat the flag or supply a JSON array. |
| `scenario` | `--scenario` | string | no | — | Named composed TestScenario in fliwright.config; resolve it before execution. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Open an attach session

```sh
fliwright session open --vm-url "$VM_URL" --json
```

### Open a managed app and TDD runtime

```sh
fliwright session open --device-id 'DEVICE_ID' --target 'lib/main_fliwright.dart' --scenario 'logged-in' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| sessionId | Pass this value as --session on later commands. |
| connected / endpoint | Connection state and resolved endpoint. |
| tdd / workflow | Current runtime and generation context when present. |
| pid / generation / operations | Worker identity and active operation ids. |

## Effects and failure handling

Registry effects: `local-worker`, `app-connection`. These are coarse declarations; the behavior section explains actual reads/writes.

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
    "deviceId": {
      "type": "string",
      "minLength": 1
    },
    "target": {
      "type": "string",
      "minLength": 1
    },
    "config": {
      "type": "string",
      "minLength": 1
    },
    "projectId": {
      "type": "string",
      "minLength": 1
    },
    "flutterArgs": {
      "type": "array",
      "items": {
        "type": "string"
      }
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

Refresh the installed contract with `fliwright schema session.open --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [session list](./command-session.list.md) — Probe sessions registered under the current project.
- [session status](./command-session.status.md) — Read worker state or the journal entry of one operation.
- [tdd start](./command-tdd.start.md) — Start a persistent TDD runtime inside an existing connection session.
- [session close](./command-session.close.md) — Cancel active work, release owned runtime connections and shut down the worker.
- [Command index](./index.md)
