---
command: "app.find"
group: app
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright app find

Find snapshot refs matching text, Key, semantics, role or widget type.

## When to use

Use when the desired target is known but its current ref is not.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- Multiple filters narrow the query. Check count and disambiguate before mutating the app.
- text matches exactly; containsText performs substring matching.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `text` | `--text` | string | no | — | Exact text match for a snapshot query or interaction target. (minLength=1) |
| `containsText` | `--contains-text` | string | no | — | Substring text filter for app find. (minLength=1) |
| `key` | `--key` | string | no | — | Stable Flutter Key selector. (minLength=1) |
| `semanticsLabel` | `--semantics-label` | string | no | — | Semantics-label filter for app find. (minLength=1) |
| `role` | `--role` | string | no | — | Snapshot role filter, e.g. button or textbox. (minLength=1) |
| `type` | `--type` | string | no | — | Flutter widget type filter/target. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Find a stable Key

```sh
fliwright app find --key 'increment' --session "$SESSION_ID" --json
```

### Find buttons by visible text

```sh
fliwright app find --role 'button' --contains-text 'Save' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| matches | All matching snapshot refs. |
| count | Number of matches; zero matches is a successful query. |

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
    "text": {
      "type": "string",
      "minLength": 1
    },
    "containsText": {
      "type": "string",
      "minLength": 1
    },
    "key": {
      "type": "string",
      "minLength": 1
    },
    "semanticsLabel": {
      "type": "string",
      "minLength": 1
    },
    "role": {
      "type": "string",
      "minLength": 1
    },
    "type": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema app.find --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [app snapshot](./command-app.snapshot.md) — Capture the app’s readable widget snapshot and opaque interaction refs.
- [app interact](./command-app.interact.md) — Perform one tap, text entry, navigation, wait, drag or extended action.
- [Command index](./index.md)
