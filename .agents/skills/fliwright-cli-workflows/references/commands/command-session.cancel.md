---
command: "session.cancel"
group: session
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright session cancel

Request cancellation of one active or queued session operation.

## When to use

Use to stop long work while retaining the worker for outcome inspection.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Requires --session and operationId. Cancellation acknowledgement is not completion; poll session status for its final journal state.
- Cancellation waits for owned work to settle before later mutations execute. false may mean the operation already completed; inspect its status.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `operationId` | `--operation-id` | string | yes | — | Session operation journal identity. Recover from a routed command envelope. (pattern=^[a-zA-Z0-9-]{1,64}$) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Cancel a known operation

```sh
fliwright session cancel --operation-id 'OPERATION-ID' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| operationId | Requested operation identity. |
| cancellationRequested | Whether that operation was still active when the request arrived. |

## Effects and failure handling

Registry effects: `session-state`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "operationId": {
      "type": "string",
      "pattern": "^[a-zA-Z0-9-]{1,64}$"
    }
  },
  "required": [
    "operationId"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema session.cancel --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [session status](./command-session.status.md) — Read worker state or the journal entry of one operation.
- [session close](./command-session.close.md) — Cancel active work, release owned runtime connections and shut down the worker.
- [Command index](./index.md)
