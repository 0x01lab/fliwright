---
command: "tdd.cycle"
group: tdd
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright tdd cycle

Sync the app, restore test state and rerun a focused test once.

## When to use

Use repeatedly with a session for interactive development, or with --file for a finite CI cycle.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Session mode requires tdd start and focus; finite mode requires file and starts/stops its own runtime.
- sync chooses none/reload/restart/auto. changes influences auto; autoEscalate allows one structural reload failure to escalate if restart is available.
- timeoutMs is the per-cycle budget; --deadline is the CLI budget. A timeout can return while the owned body settles; the host serializes later operations.
- A red cycle exits 1 with result evidence. repair is nested JSON with mode and optional iterations; omit it for an ordinary cycle.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `testName` | `--test-name` | string | no | — | Test-name selection or generated test name; see this command’s usage. (minLength=1) |
| `sync` | `--sync` | "none" \| "reload" \| "restart" \| "auto" | no | — | Cycle synchronization policy; default none. auto uses changed-file hints. |
| `fullReset` | `--full-reset` | boolean | no | — | Request full baseline reset for this cycle. |
| `changes` | `--changes` | array<string> | no | — | Changed source paths used by sync=auto. |
| `autoEscalate` | `--auto-escalate` | boolean | no | — | Allow structural reload failure to retry once with restart when supported; runtime default true. |
| `timeoutMs` | `--timeout-ms` | integer | no | — | Per-cycle wall-clock budget in milliseconds, separate from common --deadline. (exclusiveMinimum=0) |
| `repair` | `--repair` | object | no | — | Nested repair options {mode: suggest\|safe-apply, iterations?: positive integer}. |
| `file` | `--file` | string | no | — | Automation file to execute or focus; interpreted relative to cwd. (minLength=1) |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `deviceId` | `--device-id` | string | no | — | Flutter device id for an owned launch; mutually exclusive with vmUrl. (minLength=1) |
| `target` | `--target` | string | no | — | Flutter entrypoint for a managed launch, e.g. lib/main_fliwright.dart. (minLength=1) |
| `flutterArgs` | `--flutter-args` | array<string> | no | — | Additional flutter launch arguments as an array; repeat the flag or supply a JSON array. |
| `scenario` | `--scenario` | string | no | — | Named composed TestScenario in fliwright.config; resolve it before execution. (minLength=1) |
| `keepAppAlive` | `--keep-app-alive` | boolean | no | — | Retain the managed app when this command releases its runtime. Does not grant ownership of an attached app. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Rerun persistent focus after a source edit

```sh
fliwright tdd cycle --sync 'reload' --timeout-ms '60000' --session "$SESSION_ID" --json
```

### Run one finite cycle

```sh
fliwright tdd cycle --file '.fliwright/tests/counter.test.ts' --vm-url "$VM_URL" --scenario 'logged-in' --sync 'none' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| status | green or red. |
| file / testName / durationMs | Focused selection and elapsed cycle time. |
| lastSync / baselineVersion / syncEscalated | Synchronization and reset identity. |
| timelinePath / failureContext | Saved timeline and diagnostic failure context when available. |
| failure | Failure context when red; inspect actual result fields and repair metadata. |

## Effects and failure handling

Registry effects: `tdd-workflow`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "testName": {
      "type": "string",
      "minLength": 1
    },
    "sync": {
      "type": "string",
      "enum": [
        "none",
        "reload",
        "restart",
        "auto"
      ]
    },
    "fullReset": {
      "type": "boolean"
    },
    "changes": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "autoEscalate": {
      "type": "boolean"
    },
    "timeoutMs": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "repair": {
      "type": "object",
      "properties": {
        "mode": {
          "type": "string",
          "enum": [
            "suggest",
            "safe-apply"
          ]
        },
        "iterations": {
          "type": "integer",
          "exclusiveMinimum": 0
        }
      },
      "required": [
        "mode"
      ],
      "additionalProperties": false
    },
    "file": {
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
    "flutterArgs": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "scenario": {
      "type": "string",
      "minLength": 1
    },
    "keepAppAlive": {
      "type": "boolean"
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema tdd.cycle --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [tdd focus](./command-tdd.focus.md) — Select the file and optional test name for persistent TDD cycles.
- [tdd sync](./command-tdd.sync.md) — Apply an explicit app synchronization level without running tests.
- [tdd repair](./command-tdd.repair.md) — Run the focused cycle with bounded repair planning or guarded runtime actions.
- [artifacts failures](./command-artifacts.failures.md) — Extract saved assertion failures and runner errors from a run.
- [Command index](./index.md)
