---
command: "app.screenshot"
group: app
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright app screenshot

Save a PNG screenshot of the current app UI.

## When to use

Use when the Skill needs a visual artifact to inspect or compare.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- Creates parent directories and replaces the target file. Read the image at data.path with the agent’s image tool.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `output` | `--output` | string | no | — | PNG destination; otherwise a unique file in configured cacheRoot/inspect (default .fliwright/cache/inspect). (minLength=1) |
| `pixelRatio` | `--pixel-ratio` | number | no | — | Runtime screenshot scale. (exclusiveMinimum=0) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Save a named screenshot

```sh
fliwright app screenshot --output '.fliwright/artifacts/counter.png' --pixel-ratio '1' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| path | Written PNG path; default is a unique capture in cacheRoot/inspect (project default .fliwright/cache/inspect). |
| bytes | PNG byte length. |

## Effects and failure handling

Registry effects: `image-file`. These are coarse declarations; the behavior section explains actual reads/writes.

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
    "output": {
      "type": "string",
      "minLength": 1
    },
    "pixelRatio": {
      "type": "number",
      "exclusiveMinimum": 0
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema app.screenshot --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [app snapshot](./command-app.snapshot.md) — Capture the app’s readable widget snapshot and opaque interaction refs.
- [app debug-snapshot](./command-app.debug-snapshot.md) — Collect a structural snapshot plus independent debug evidence channels.
- [flow review-capture-runtime](./command-flow.review-capture-runtime.md) — Navigate review target routes and save runtime screenshots plus a capture manifest.
- [Command index](./index.md)
