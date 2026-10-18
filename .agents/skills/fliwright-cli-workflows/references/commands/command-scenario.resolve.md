---
command: "scenario.resolve"
group: scenario
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright scenario resolve

Resolve one named composed scenario without applying it.

## When to use

Use to inspect composition, configuration and isolation requirements before startup.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- name must exist in project configuration. Resolving does not verify the app can execute every layer.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `name` | `positional name` | string | yes | — | Declared scenario name or recording test name, depending on the command. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Inspect a declared baseline

```sh
fliwright scenario resolve 'logged-in' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| (data) | Resolved scenario object returned directly by ScenarioResolver. |

## Effects and failure handling

Registry effects: none. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "name"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema scenario.resolve --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [scenario list](./command-scenario.list.md) — List named scenarios declared in project configuration.
- [scenario apply](./command-scenario.apply.md) — Apply a named composed baseline to the connected app.
- [Command index](./index.md)
