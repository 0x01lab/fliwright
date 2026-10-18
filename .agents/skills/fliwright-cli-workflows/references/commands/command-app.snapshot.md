---
command: "app.snapshot"
group: app
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright app snapshot

Capture the app’s readable widget snapshot and opaque interaction refs.

## When to use

Use before choosing an interaction target or inspecting current UI state.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- Refs belong to the app/isolate incarnation. Reacquire after restart; never persist opaque tokens as durable test selectors.
- Use includeRects/includeProperties when geometry or debugging properties are needed.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `depth` | `--depth` | integer | no | — | Snapshot tree depth bound. app source-map accepts this field but does not forward a depth bound. (exclusiveMinimum=0) |
| `includeRects` | `--include-rects` | boolean | no | — | Include widget geometry in snapshot/source-map data. |
| `includeProperties` | `--include-properties` | boolean | no | — | Include available widget/debug properties. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Inspect a session with geometry

```sh
fliwright app snapshot --include-rects 'true' --depth '6' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| snapshot | Readable tree text. |
| refs | Structured ref entries, with role/label and available selector or geometry metadata. |
| groupId / count | Snapshot grouping and item count. |

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
    "depth": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "includeRects": {
      "type": "boolean"
    },
    "includeProperties": {
      "type": "boolean"
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema app.snapshot --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [app find](./command-app.find.md) — Find snapshot refs matching text, Key, semantics, role or widget type.
- [app observe](./command-app.observe.md) — List current UI candidates, optionally filtered by role.
- [app interact](./command-app.interact.md) — Perform one tap, text entry, navigation, wait, drag or extended action.
- [app debug-snapshot](./command-app.debug-snapshot.md) — Collect a structural snapshot plus independent debug evidence channels.
- [Command index](./index.md)
