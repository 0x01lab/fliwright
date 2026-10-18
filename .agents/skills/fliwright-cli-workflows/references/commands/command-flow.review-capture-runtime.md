---
command: "flow.review-capture-runtime"
group: flow
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright flow review-capture-runtime

Navigate review target routes and save runtime screenshots plus a capture manifest.

## When to use

Use to gather the app side of a visual review.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- Requires a live app. targetIds and limit narrow capture targets.
- Current implementation navigates each target route when present, then captures the whole app. It does not replay a recorded action sequence or activate a selector-only state.
- Targets without routes capture the current UI; establish their state yourself. Any failed capture makes the command exit 1 while preserving the manifest.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `id` | `positional id` | string | no | — | Flow id under .fliwright/flows |
| `path` | `--path` | string | no | — | Direct path to a .flow.json file |
| `pixelDiffTolerance` | `--pixel-diff-tolerance` | number | no | — | Allowed visual diff ratio, default 0.03 |
| `layoutPxTolerance` | `--layout-px-tolerance` | number | no | — | Allowed layout delta in px, default 4 |
| `pixelRatio` | `--pixel-ratio` | number | no | 1 | Runtime screenshot pixel ratio, default 1 |
| `outputDir` | `--output-dir` | string | no | — | Directory to write runtime screenshots. Defaults to .fliwright/reviews/<flowId>-<timestamp>. |
| `targetIds` | `--target-ids` | array<string> | no | — | Optional subset of flow node ids to capture |
| `limit` | `--limit` | number | no | — | Optional max number of targets to capture |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Capture one routed screen

```sh
cat > 'fliwright-flow.review-capture-runtime-input.json' <<'JSON'
{
  "id": "checkout",
  "targetIds": [
    "checkout-screen"
  ],
  "pixelRatio": 1
}
JSON
fliwright flow review-capture-runtime --input 'fliwright-flow.review-capture-runtime-input.json' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| path / outputDir | Flow path and capture directory. |
| capturesFile | Written JSON array of captures. |
| captures | Per-target flowNodeId/title/route/screenshotPath/status or error. |

## Effects and failure handling

Registry effects: `flow-artifacts`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Flow id under .fliwright/flows"
    },
    "path": {
      "type": "string",
      "description": "Direct path to a .flow.json file"
    },
    "pixelDiffTolerance": {
      "type": "number",
      "description": "Allowed visual diff ratio, default 0.03"
    },
    "layoutPxTolerance": {
      "type": "number",
      "description": "Allowed layout delta in px, default 4"
    },
    "pixelRatio": {
      "type": "number",
      "default": 1,
      "description": "Runtime screenshot pixel ratio, default 1"
    },
    "outputDir": {
      "type": "string",
      "description": "Directory to write runtime screenshots. Defaults to .fliwright/reviews/<flowId>-<timestamp>."
    },
    "targetIds": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Optional subset of flow node ids to capture"
    },
    "limit": {
      "type": "number",
      "description": "Optional max number of targets to capture"
    },
    "vmUrl": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema flow.review-capture-runtime --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [flow review-plan](./command-flow.review-plan.md) — Derive design review targets and tolerances without capturing images.
- [flow review-capture-figma](./command-flow.review-capture-figma.md) — Download Figma target screenshots and save a capture manifest through the REST provider.
- [flow review-report](./command-flow.review-report.md) — Compare runtime/Figma evidence and write the design review report.
- [Command index](./index.md)
