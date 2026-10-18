---
command: "tdd.status"
group: tdd
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright tdd status

Read TDD status from a live session or the saved local status file.

## When to use

Use to inspect focus, last result and capabilities without starting another runtime.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- A saved file can be stale and is not a liveness probe. Use session status for current worker state.

## Input

No command-specific input fields.

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Inspect the live runtime

```sh
fliwright tdd status --session "$SESSION_ID" --json
```

### Read last saved status

```sh
fliwright tdd status --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| session | With --session: host status containing connected/endpoint/tdd/workflow/closed. |
| finite | Without --session: persisted RuntimeSnapshot or null. |

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

Refresh the installed contract with `fliwright schema tdd.status --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [session status](./command-session.status.md) — Read worker state or the journal entry of one operation.
- [tdd focus](./command-tdd.focus.md) — Select the file and optional test name for persistent TDD cycles.
- [tdd cycle](./command-tdd.cycle.md) — Sync the app, restore test state and rerun a focused test once.
- [Command index](./index.md)
