---
command: "mock.reset"
group: mock
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright mock reset

Remove Flutter mock routes, clear call history and enable passthrough.

## When to use

Use to return HTTP requests to their real destinations after a mock exploration.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- Changes network behavior and removes all installed routes. It does not delete local rule files. Use scenario reset to restore a named app baseline.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Restore HTTP passthrough

```sh
fliwright mock reset --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| cleared | true after routes/history were cleared and passthrough was enabled. |

## Effects and failure handling

Registry effects: `mock-routes`, `mock-history`, `passthrough`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "vmUrl": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema mock.reset --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [mock status](./command-mock.status.md) — Compare local rule definitions with active Flutter routes and captured HTTP calls.
- [mock apply](./command-mock.apply.md) — Install one named local mock response rule into Flutter.
- [scenario reset](./command-scenario.reset.md) — Reapply a named baseline to restore its declared state.
- [Command index](./index.md)
