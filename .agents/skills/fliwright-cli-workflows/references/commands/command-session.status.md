---
command: "session.status"
group: session
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright session status

Read worker state or the journal entry of one operation.

## When to use

Use for live monitoring and recovery after a lost command response.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Requires --session or FLIWRIGHT_SESSION. operationId is the envelope operationId from a routed command.
- Status can be queried during long work. Do not retry uncertain mutations until their recorded outcome is understood. Missing journal data does not prove the mutation never ran.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `operationId` | `--operation-id` | string | no | — | Session operation journal identity. Recover from a routed command envelope. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Inspect worker state

```sh
fliwright session status --session "$SESSION_ID" --json
```

### Recover an operation outcome

```sh
fliwright session status --operation-id 'OPERATION-ID' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| worker | Without operationId: sessionId/pid/generation/connected/endpoint/tdd/workflow/operations. |
| operation | With operationId: queued/running/succeeded/failed/cancelled journal state and available data/error. |

## Effects and failure handling

Registry effects: none. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "operationId": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema session.status --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [session cancel](./command-session.cancel.md) — Request cancellation of one active or queued session operation.
- [session reconnect](./command-session.reconnect.md) — Refresh the host’s app connection after queued work settles.
- [session close](./command-session.close.md) — Cancel active work, release owned runtime connections and shut down the worker.
- [Command index](./index.md)
