---
command: "scenario.list"
group: scenario
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright scenario list

List named scenarios declared in project configuration.

## When to use

Use to discover valid baseline names before run, record or manual setup.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Reads fliwright.config; does not connect to or mutate an app. An empty list means no named scenarios are configured.

## Input

No command-specific input fields.

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Discover baselines

```sh
fliwright scenario list --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| scenarios | Sorted names, startupIsolation and declared layer kinds. |

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

Refresh the installed contract with `fliwright schema scenario.list --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [scenario resolve](./command-scenario.resolve.md) — Resolve one named composed scenario without applying it.
- [scenario apply](./command-scenario.apply.md) — Apply a named composed baseline to the connected app.
- [run](./command-run.md) — Run selected Vitest automation tests and save canonical run evidence.
- [Command index](./index.md)
