---
command: "session.close"
group: session
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright session close

Cancel active work, release owned runtime connections and shut down the worker.

## When to use

Use when exploration or the TDD loop is finished.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Requires --session. keepAppAlive retains a managed app when requested; otherwise owned app resources are stopped.
- Operation records remain local evidence. Closing a session does not delete canonical test run artifacts.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `keepAppAlive` | `--keep-app-alive` | boolean | no | — | Retain the managed app when this command releases its runtime. Does not grant ownership of an attached app. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Close the worker and owned app

```sh
fliwright session close --session "$SESSION_ID" --json
```

### Close while retaining the app

```sh
fliwright session close --keep-app-alive 'true' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| closed | true once host cleanup has completed. |

## Effects and failure handling

Registry effects: `session-state`. These are coarse declarations; the behavior section explains actual reads/writes.

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

Refresh the installed contract with `fliwright schema session.close --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [session status](./command-session.status.md) — Read worker state or the journal entry of one operation.
- [session open](./command-session.open.md) — Create a reusable local worker connected to an attached or managed Flutter app.
- [Command index](./index.md)
