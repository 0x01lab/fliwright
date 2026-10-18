---
command: "app.source-map"
group: app
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright app source-map

Map current UI elements back to Flutter source locations.

## When to use

Use to locate implementation files after observing a problematic widget.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- Source locations depend on debug instrumentation and source availability. includeFramework broadens collection.
- A missing location is not evidence that the widget does not exist.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `depth` | `--depth` | integer | no | — | Snapshot tree depth bound. app source-map accepts this field but does not forward a depth bound. (exclusiveMinimum=0) |
| `includeRects` | `--include-rects` | boolean | no | — | Include widget geometry in snapshot/source-map data. |
| `includeProperties` | `--include-properties` | boolean | no | — | Include available widget/debug properties. |
| `includeFramework` | `--include-framework` | boolean | no | — | Include Flutter framework source locations in the source map. |
| `limit` | `--limit` | integer | no | — | Maximum returned/captured items; scope depends on the command. (exclusiveMinimum=0) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Read application source mappings

```sh
fliwright app source-map --include-framework 'false' --limit '30' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| widgetCreationTracked | Whether creation locations are tracked. |
| nodes | Mapped UI/source entries. |
| candidateFiles | Candidate application source files. |
| count | Mapped item count. |
| success / error | Bridge outcome, when present; inspect error even if the wrapper succeeds. |

## Effects and failure handling

Registry effects: none. These are coarse declarations; the behavior section explains actual reads/writes.

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
    },
    "includeFramework": {
      "type": "boolean"
    },
    "limit": {
      "type": "integer",
      "exclusiveMinimum": 0
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema app.source-map --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [app snapshot](./command-app.snapshot.md) — Capture the app’s readable widget snapshot and opaque interaction refs.
- [app debug-snapshot](./command-app.debug-snapshot.md) — Collect a structural snapshot plus independent debug evidence channels.
- [Command index](./index.md)
