---
command: "app.diagnostics"
group: app
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright app diagnostics

Read, subscribe to or clear buffered app diagnostic events.

## When to use

Use to inspect framework errors/logging around an interaction.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- Use a session to retain subscriptions and buffers across commands; finite drivers disconnect when the command ends.
- listen=true starts subscription; false/omission skips subscription setup and does not unsubscribe an existing session driver. Close the session to release it. clear=true clears the buffer; kinds/streams filter returned events. This is not an indefinite streaming command.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `listen` | `--listen` | boolean | no | — | true subscribes diagnostic streams; false/omission does not unsubscribe existing listeners. |
| `clear` | `--clear` | boolean | no | — | Clear this driver’s diagnostic event buffer before reading it. |
| `limit` | `--limit` | integer | no | — | Maximum returned/captured items; scope depends on the command. (exclusiveMinimum=0) |
| `kinds` | `--kinds` | array<string> | no | — | Diagnostic event-kind filters as an array. |
| `streams` | `--streams` | array<string> | no | — | VM diagnostic stream-id filters as an array. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Start collecting diagnostics

```sh
fliwright app diagnostics --listen 'true' --limit '20' --session "$SESSION_ID" --json
```

### Read selected event kinds

```sh
cat > 'fliwright-app.diagnostics-input.json' <<'JSON'
{
  "kinds": [
    "error"
  ],
  "limit": 50
}
JSON
fliwright app diagnostics --input 'fliwright-app.diagnostics-input.json' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| listening | Whether this invocation started listening; false does not prove a prior subscription is inactive. |
| cleared | Whether its buffered events were cleared. |
| events | Filtered diagnostic events. |
| count | Returned event count. |

## Effects and failure handling

Registry effects: `diagnostic-subscriptions`. These are coarse declarations; the behavior section explains actual reads/writes.

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
    "listen": {
      "type": "boolean"
    },
    "clear": {
      "type": "boolean"
    },
    "limit": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "kinds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "streams": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema app.diagnostics --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [app interact](./command-app.interact.md) — Perform one tap, text entry, navigation, wait, drag or extended action.
- [app debug-snapshot](./command-app.debug-snapshot.md) — Collect a structural snapshot plus independent debug evidence channels.
- [Command index](./index.md)
