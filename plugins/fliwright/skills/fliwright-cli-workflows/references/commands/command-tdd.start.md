---
command: "tdd.start"
group: tdd
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright tdd start

Start a persistent TDD runtime inside an existing connection session.

## When to use

Use after an attach session open and before focus/cycle. A managed session open already starts its runtime.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- An explicit connection session is required (--session or FLIWRIGHT_SESSION).
- Requires --session. By default reuses the host endpoint in attach mode. Routed commands cannot replace the session endpoint with vmUrl/deviceId; choose ownership at session open.
- Only one runtime can be active per session. TDD_ALREADY_STARTED exits 4; stop it before starting another.
- scenario must be declared in project configuration. Status is persisted to statusFile or .fliwright/tdd-status.json.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `config` | `--config` | string | no | — | TDD configuration root; resolved relative to cwd. (minLength=1) |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `deviceId` | `--device-id` | string | no | — | Flutter device id for an owned launch; mutually exclusive with vmUrl. (minLength=1) |
| `target` | `--target` | string | no | — | Flutter entrypoint for a managed launch, e.g. lib/main_fliwright.dart. (minLength=1) |
| `projectId` | `--project-id` | string | no | — | Flutter project directory passed to managed launch; defaults to cwd. (minLength=1) |
| `flutterArgs` | `--flutter-args` | array<string> | no | — | Additional flutter launch arguments as an array; repeat the flag or supply a JSON array. |
| `mode` | `--mode` | "run" \| "drive" | no | — | Command-specific execution/generation/synchronization mode; see conditions above. |
| `scenario` | `--scenario` | string | no | — | Named composed TestScenario in fliwright.config; resolve it before execution. (minLength=1) |
| `statusFile` | `--status-file` | string | no | — | TDD status snapshot file; default .fliwright/tdd-status.json under config root. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Start on an attached session

```sh
fliwright tdd start --scenario 'logged-in' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| (data) | RuntimeSnapshot returned directly: connection/launch mode, restart capability, focused test and baseline version. |

## Effects and failure handling

Registry effects: `tdd-workflow`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "config": {
      "type": "string",
      "minLength": 1
    },
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
    "mode": {
      "type": "string",
      "enum": [
        "run",
        "drive"
      ]
    },
    "scenario": {
      "type": "string",
      "minLength": 1
    },
    "statusFile": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema tdd.start --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [session open](./command-session.open.md) — Create a reusable local worker connected to an attached or managed Flutter app.
- [tdd focus](./command-tdd.focus.md) — Select the file and optional test name for persistent TDD cycles.
- [tdd status](./command-tdd.status.md) — Read TDD status from a live session or the saved local status file.
- [tdd stop](./command-tdd.stop.md) — Stop the persistent TDD runtime while leaving the connection worker available.
- [Command index](./index.md)
