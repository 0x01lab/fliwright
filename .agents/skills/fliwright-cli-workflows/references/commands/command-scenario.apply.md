---
command: "scenario.apply"
group: scenario
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright scenario apply

Apply a named composed baseline to the connected app.

## When to use

Use for manual exploration with a deterministic environment.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- Requires a declared scenario and the bridge capabilities used by its layers. Authenticated business baselines use app-owned auth.seedLoggedIn.
- Connection mode is attach unless configured otherwise. A strict startup baseline can reject attach; use a managed test workflow with waiting bootstrap.
- For tests prefer run --scenario so setup repeats before each attempt and retry.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `name` | `positional name` | string | yes | — | Declared scenario name or recording test name, depending on the command. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Prepare exploration state

```sh
fliwright scenario apply 'logged-in' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| scenario | Applied scenario name. |
| mode | Scenario execution mode. |
| appliedLayers | Layer kinds applied. |
| ready | true after all declared layers have completed. |

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

Refresh the installed contract with `fliwright schema scenario.apply --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [scenario resolve](./command-scenario.resolve.md) — Resolve one named composed scenario without applying it.
- [scenario reset](./command-scenario.reset.md) — Reapply a named baseline to restore its declared state.
- [run](./command-run.md) — Run selected Vitest automation tests and save canonical run evidence.
- [Command index](./index.md)
