---
command: "tdd.scenario"
group: tdd
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright tdd scenario

Select the named scenario used by subsequent focused test attempts.

## When to use

Use to change the baseline while keeping a persistent runtime open.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- An explicit connection session is required (--session or FLIWRIGHT_SESSION).
- Requires a started runtime and a declared scenario. It selects future fixture setup; it does not run a test or immediately apply a baseline.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `name` | `--name` | string | yes | — | Declared scenario name or recording test name, depending on the command. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Select a declared baseline

```sh
fliwright tdd scenario --name 'logged-in' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| (data) | Updated RuntimeSnapshot returned directly after the executor is rebooted with the selected scenario. |

## Effects and failure handling

Registry effects: `tdd-workflow`. These are coarse declarations; the behavior section explains actual reads/writes.

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

Refresh the installed contract with `fliwright schema tdd.scenario --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [scenario list](./command-scenario.list.md) — List named scenarios declared in project configuration.
- [tdd cycle](./command-tdd.cycle.md) — Sync the app, restore test state and rerun a focused test once.
- [scenario apply](./command-scenario.apply.md) — Apply a named composed baseline to the connected app.
- [Command index](./index.md)
