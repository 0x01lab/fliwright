---
command: "app.observe"
group: app
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright app observe

List current UI candidates, optionally filtered by role.

## When to use

Use when exploring what to click or fill, rather than checking an exact selector.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- roles is a comma-separated string, for example button,textbox. includeDiagnostics defaults to false.
- intent is diagnostic annotation only: the current implementation does not rank or filter candidates by natural-language intent. It does not execute that intent.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `intent` | `--intent` | string | no | — | Natural-language context included in candidate diagnostics; currently does not rank/filter candidates. (minLength=1) |
| `roles` | `--roles` | string | no | — | Comma-separated role filter, e.g. button,textbox. (minLength=1) |
| `limit` | `--limit` | integer | no | — | Maximum returned/captured items; scope depends on the command. (exclusiveMinimum=0) |
| `includeDiagnostics` | `--include-diagnostics` | boolean | no | — | Include candidate diagnostics or diagnostic events in debug evidence. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Inspect button candidates

```sh
fliwright app observe --intent 'save changes' --roles 'button' --limit '5' --include-diagnostics 'true' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| candidates | Snapshot refs in snapshot order, with optional per-candidate diagnostic metadata. |
| count | Returned candidate count. |

## Effects and failure handling

Registry effects: `snapshot-refs`. These are coarse declarations; the behavior section explains actual reads/writes.

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
    "intent": {
      "type": "string",
      "minLength": 1
    },
    "roles": {
      "type": "string",
      "minLength": 1
    },
    "limit": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "includeDiagnostics": {
      "type": "boolean"
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema app.observe --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [app find](./command-app.find.md) — Find snapshot refs matching text, Key, semantics, role or widget type.
- [app interact](./command-app.interact.md) — Perform one tap, text entry, navigation, wait, drag or extended action.
- [Command index](./index.md)
