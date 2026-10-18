---
command: "tdd.repair"
group: tdd
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright tdd repair

Run the focused cycle with bounded repair planning or guarded runtime actions.

## When to use

Use after understanding a failing focused test and choosing the requested repair mode.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- An explicit connection session is required (--session or FLIWRIGHT_SESSION).
- Requires a started runtime and focus. mode defaults to suggest, which emits a plan without applying.
- safe-apply executes only supported guarded safe actions; it does not grant arbitrary code patching. iterations bounds repair cycles (runtime default 3).
- Repair requires a planner wired into the runtime; a CLI flag does not guarantee a provider or planner exists. Inspect result and exit code; red remains exit 1.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `testName` | `--test-name` | string | no | — | Test-name selection or generated test name; see this command’s usage. (minLength=1) |
| `sync` | `--sync` | "none" \| "reload" \| "restart" \| "auto" | no | — | Cycle synchronization policy; default none. auto uses changed-file hints. |
| `fullReset` | `--full-reset` | boolean | no | — | Request full baseline reset for this cycle. |
| `changes` | `--changes` | array<string> | no | — | Changed source paths used by sync=auto. |
| `autoEscalate` | `--auto-escalate` | boolean | no | — | Allow structural reload failure to retry once with restart when supported; runtime default true. |
| `timeoutMs` | `--timeout-ms` | integer | no | — | Per-cycle wall-clock budget in milliseconds, separate from common --deadline. (exclusiveMinimum=0) |
| `mode` | `--mode` | "suggest" \| "safe-apply" | no | "suggest" | Command-specific execution/generation/synchronization mode; see conditions above. |
| `iterations` | `--iterations` | integer | no | — | Maximum guarded repair iterations; runtime default 3 for safe-apply. (exclusiveMinimum=0) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Request a repair suggestion

```sh
fliwright tdd repair --mode 'suggest' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| (data) | TddCycleResult returned directly, including repair plan/attempt evidence when available. |

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
    "mode": {
      "type": "string",
      "enum": [
        "suggest",
        "safe-apply"
      ],
      "default": "suggest"
    },
    "iterations": {
      "type": "integer",
      "exclusiveMinimum": 0
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema tdd.repair --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [tdd cycle](./command-tdd.cycle.md) — Sync the app, restore test state and rerun a focused test once.
- [artifacts failures](./command-artifacts.failures.md) — Extract saved assertion failures and runner errors from a run.
- [tdd status](./command-tdd.status.md) — Read TDD status from a live session or the saved local status file.
- [Command index](./index.md)
