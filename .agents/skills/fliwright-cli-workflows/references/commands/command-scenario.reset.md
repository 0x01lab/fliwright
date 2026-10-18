---
command: "scenario.reset"
group: scenario
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright scenario reset

Reapply a named baseline to restore its declared state.

## When to use

Use when exploration has changed state and the same scenario should be established again.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- This command requires name and calls the same implementation as scenario.apply. It is not a generic inverse or a universal wipe.
- Only state covered by the named layers is restored.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `name` | `positional name` | string | yes | — | Declared scenario name or recording test name, depending on the command. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Restore the declared baseline

```sh
fliwright scenario reset 'logged-in' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| scenario / mode / appliedLayers / ready | Same direct application report as scenario.apply. |

## Effects and failure handling

Registry effects: `app-state`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "vmUrl": {
      "type": "string",
      "minLength": 1
    },
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

Refresh the installed contract with `fliwright schema scenario.reset --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [scenario apply](./command-scenario.apply.md) — Apply a named composed baseline to the connected app.
- [scenario resolve](./command-scenario.resolve.md) — Resolve one named composed scenario without applying it.
- [Command index](./index.md)
