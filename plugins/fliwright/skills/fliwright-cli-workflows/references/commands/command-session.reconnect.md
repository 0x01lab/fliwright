---
command: "session.reconnect"
group: session
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright session reconnect

Refresh the host’s app connection after queued work settles.

## When to use

Use after a transport disconnect when the same worker and app should be retained.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Requires --session; waits for the host queue before reconnecting. Use tdd reconnect for the persistent runtime’s own driver.
- Does not retry a previous command or restart a dead app. Version mismatch requires closing/reopening the worker.

## Input

No command-specific input fields.

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Refresh the host transport

```sh
fliwright session reconnect --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| connected / endpoint / tdd / workflow / closed | Host status returned directly. |

## Effects and failure handling

Registry effects: `session-state`. These are coarse declarations; the behavior section explains actual reads/writes.

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

Refresh the installed contract with `fliwright schema session.reconnect --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [session status](./command-session.status.md) — Read worker state or the journal entry of one operation.
- [tdd reconnect](./command-tdd.reconnect.md) — Reconnect the persistent TDD runtime and refresh its host app connection.
- [app snapshot](./command-app.snapshot.md) — Capture the app’s readable widget snapshot and opaque interaction refs.
- [Command index](./index.md)
