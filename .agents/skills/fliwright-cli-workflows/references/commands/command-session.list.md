---
command: "session.list"
group: session
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright session list

Probe sessions registered under the current project.

## When to use

Use to discover live workers and identify unreachable registrations.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Each registration is probed with a short timeout. Unreachable entries are not silently restarted or replayed.

## Input

No command-specific input fields.

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### List local project sessions

```sh
fliwright session list --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| sessions | Entries with sessionId and live status, or connected:false/status:unreachable. |

## Effects and failure handling

Registry effects: none. These are coarse declarations; the behavior section explains actual reads/writes.

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

Refresh the installed contract with `fliwright schema session.list --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [session status](./command-session.status.md) — Read worker state or the journal entry of one operation.
- [session open](./command-session.open.md) — Create a reusable local worker connected to an attached or managed Flutter app.
- [session close](./command-session.close.md) — Cancel active work, release owned runtime connections and shut down the worker.
- [Command index](./index.md)
