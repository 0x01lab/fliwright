---
command: "tdd.sync"
group: tdd
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright tdd sync

Apply an explicit app synchronization level without running tests.

## When to use

Use to reload or restart before inspection, either through a persistent runtime or a finite attachment.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- mode is required and must be none/reload/restart. Persistent mode requires tdd start; finite mode requires vmUrl or deviceId.
- Attach mode cannot hot restart; use a managed session/device when restart is required. No assertions are executed.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `mode` | `--mode` | "none" \| "reload" \| "restart" | yes | — | Command-specific execution/generation/synchronization mode; see conditions above. |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `deviceId` | `--device-id` | string | no | — | Flutter device id for an owned launch; mutually exclusive with vmUrl. (minLength=1) |
| `target` | `--target` | string | no | — | Flutter entrypoint for a managed launch, e.g. lib/main_fliwright.dart. (minLength=1) |
| `keepAppAlive` | `--keep-app-alive` | boolean | no | — | Retain the managed app when this command releases its runtime. Does not grant ownership of an attached app. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Reload the persistent app

```sh
fliwright tdd sync --mode 'reload' --session "$SESSION_ID" --json
```

### Reload through a finite attachment

```sh
fliwright tdd sync --mode 'reload' --vm-url "$VM_URL" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| session | With session: syncApp result including lastSync and snapshot. |
| finite | Without session: snapshot, lastSync, synced and stopped runtime snapshots. |

## Effects and failure handling

Registry effects: `tdd-workflow`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": [
        "none",
        "reload",
        "restart"
      ]
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
    "keepAppAlive": {
      "type": "boolean"
    }
  },
  "required": [
    "mode"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema tdd.sync --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [app reload](./command-app.reload.md) — Hot reload Dart code and capture the resulting UI and diagnostics.
- [tdd cycle](./command-tdd.cycle.md) — Sync the app, restore test state and rerun a focused test once.
- [tdd status](./command-tdd.status.md) — Read TDD status from a live session or the saved local status file.
- [Command index](./index.md)
