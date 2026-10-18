---
command: "tdd.reconnect"
group: tdd
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright tdd reconnect

Reconnect the persistent TDD runtime and refresh its host app connection.

## When to use

Use when the runtime’s driver needs reconnection after transport disruption.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- An explicit connection session is required (--session or FLIWRIGHT_SESSION).
- Requires a started TDD runtime. This differs from session reconnect, which refreshes only the host connection.
- Reconnection does not restart the app or make stale isolate refs valid. Reacquire UI refs after an actual restart.

## Input

No command-specific input fields.

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Reconnect the TDD driver

```sh
fliwright tdd reconnect --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| (data) | Runtime reconnect result, normally RuntimeSnapshot. |

## Effects and failure handling

Registry effects: `tdd-workflow`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema tdd.reconnect --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [session reconnect](./command-session.reconnect.md) — Refresh the host’s app connection after queued work settles.
- [tdd status](./command-tdd.status.md) — Read TDD status from a live session or the saved local status file.
- [app snapshot](./command-app.snapshot.md) — Capture the app’s readable widget snapshot and opaque interaction refs.
- [Command index](./index.md)
