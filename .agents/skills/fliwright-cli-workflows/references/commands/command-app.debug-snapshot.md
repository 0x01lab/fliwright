---
command: "app.debug-snapshot"
group: app
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright app debug-snapshot

Collect a structural snapshot plus independent debug evidence channels.

## When to use

Use when a failure needs UI, diagnostics, mock state, source locations and recent run context together.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- Diagnostics and mock status are enabled unless false; screenshot and sourceMap require opt-in.
- ok:true can accompany partial:true. Inspect errors before drawing conclusions. Failure of the required structural snapshot fails the command.
- Screenshot output is a file path. App context fields are also merged into data.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `depth` | `--depth` | integer | no | — | Snapshot tree depth bound. app source-map accepts this field but does not forward a depth bound. (exclusiveMinimum=0) |
| `includeRects` | `--include-rects` | boolean | no | — | Include widget geometry in snapshot/source-map data. |
| `includeProperties` | `--include-properties` | boolean | no | — | Include available widget/debug properties. |
| `output` | `--output` | string | no | — | PNG destination when includeScreenshot=true; otherwise no image is written. (minLength=1) |
| `includeScreenshot` | `--include-screenshot` | boolean | no | — | Capture a screenshot as part of reload/debug evidence. |
| `pixelRatio` | `--pixel-ratio` | number | no | — | Runtime screenshot scale. (exclusiveMinimum=0) |
| `includeDiagnostics` | `--include-diagnostics` | boolean | no | — | Include candidate diagnostics or diagnostic events in debug evidence. |
| `diagnosticLimit` | `--diagnostic-limit` | integer | no | — | Maximum diagnostic events in a debug snapshot; effective default 20. (exclusiveMinimum=0) |
| `includeMockStatus` | `--include-mock-status` | boolean | no | — | Include local rules, active Flutter routes and recent calls; debug default true. |
| `mockRecentCallsLimit` | `--mock-recent-calls-limit` | integer | no | — | Maximum recent HTTP calls in debug evidence; effective default 20. (exclusiveMinimum=0) |
| `includeSourceMap` | `--include-source-map` | boolean | no | — | Include Flutter source locations in debug evidence; default disabled. |
| `sourceMapLimit` | `--source-map-limit` | integer | no | — | Maximum source-map entries in debug evidence. (exclusiveMinimum=0) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Capture visual and source evidence

```sh
fliwright app debug-snapshot --include-screenshot 'true' --include-source-map 'true' --output '.fliwright/artifacts/debug.png' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| snapshot | Required structural capture. |
| diagnostics / mock / sourceMap / screenshot | Optional channel results. |
| lastFailures / tdd | Saved failure context and local TDD status. |
| partial / errors | Whether optional sections failed, and which ones. |

## Effects and failure handling

Registry effects: `snapshot-refs`, `optional-image-file`. These are coarse declarations; the behavior section explains actual reads/writes.

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
    "output": {
      "type": "string",
      "minLength": 1
    },
    "includeScreenshot": {
      "type": "boolean"
    },
    "pixelRatio": {
      "type": "number",
      "exclusiveMinimum": 0
    },
    "includeDiagnostics": {
      "type": "boolean"
    },
    "diagnosticLimit": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "includeMockStatus": {
      "type": "boolean"
    },
    "mockRecentCallsLimit": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "includeSourceMap": {
      "type": "boolean"
    },
    "sourceMapLimit": {
      "type": "integer",
      "exclusiveMinimum": 0
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema app.debug-snapshot --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [app diagnostics](./command-app.diagnostics.md) — Read, subscribe to or clear buffered app diagnostic events.
- [app source-map](./command-app.source-map.md) — Map current UI elements back to Flutter source locations.
- [artifacts failures](./command-artifacts.failures.md) — Extract saved assertion failures and runner errors from a run.
- [Command index](./index.md)
