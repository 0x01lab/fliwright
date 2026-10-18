---
command: "app.reload"
group: app
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright app reload

Hot reload Dart code and capture the resulting UI and diagnostics.

## When to use

Use after a reload-compatible source edit while preserving app state.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- includeScreenshot defaults to false. screenshotPixelRatio controls its scale.
- Failed reload or captured exceptions exit 3 with partial data. Structural changes may require tdd sync restart with managed ownership.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `depth` | `--depth` | integer | no | — | Snapshot tree depth bound. app source-map accepts this field but does not forward a depth bound. (exclusiveMinimum=0) |
| `includeRects` | `--include-rects` | boolean | no | — | Include widget geometry in snapshot/source-map data. |
| `includeProperties` | `--include-properties` | boolean | no | — | Include available widget/debug properties. |
| `includeScreenshot` | `--include-screenshot` | boolean | no | — | Capture a screenshot as part of reload/debug evidence. |
| `screenshotPixelRatio` | `--screenshot-pixel-ratio` | number | no | — | Screenshot scale for app reload. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Reload and save an evidence image

```sh
fliwright app reload --include-screenshot 'true' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| reloaded | Whether reload succeeded. |
| durationMs | Elapsed reload/capture time. |
| exceptions | Collected failures. |
| snapshot | Post-reload snapshot when available. |
| screenshot | Optional PNG path, not base64 image data. |

## Effects and failure handling

Registry effects: `app-reload`, `snapshot-refs`. These are coarse declarations; the behavior section explains actual reads/writes.

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
    "includeScreenshot": {
      "type": "boolean"
    },
    "screenshotPixelRatio": {
      "type": "number"
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema app.reload --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [app snapshot](./command-app.snapshot.md) — Capture the app’s readable widget snapshot and opaque interaction refs.
- [tdd sync](./command-tdd.sync.md) — Apply an explicit app synchronization level without running tests.
- [app diagnostics](./command-app.diagnostics.md) — Read, subscribe to or clear buffered app diagnostic events.
- [Command index](./index.md)
