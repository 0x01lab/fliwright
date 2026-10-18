---
command: "tdd.stop"
group: tdd
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright tdd stop

Stop the persistent TDD runtime while leaving the connection worker available.

## When to use

Use when finishing the focused loop or before starting a new runtime.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- An explicit connection session is required (--session or FLIWRIGHT_SESSION).
- Requires an active runtime. keepAppAlive controls managed app retention; session close also releases the worker.
- If a managed app is stopped, the remaining host connection may no longer be usable.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `keepAppAlive` | `--keep-app-alive` | boolean | no | — | Retain the managed app when this command releases its runtime. Does not grant ownership of an attached app. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Stop TDD and retain the app

```sh
fliwright tdd stop --keep-app-alive 'true' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| (data) | Stopped RuntimeSnapshot returned directly. |

## Effects and failure handling

Registry effects: `tdd-workflow`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "keepAppAlive": {
      "type": "boolean"
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema tdd.stop --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [tdd start](./command-tdd.start.md) — Start a persistent TDD runtime inside an existing connection session.
- [session close](./command-session.close.md) — Cancel active work, release owned runtime connections and shut down the worker.
- [Command index](./index.md)
