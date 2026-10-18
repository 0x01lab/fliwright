---
command: "flow.review-run"
group: flow
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright flow review-run

Build a bundle, capture runtime and Figma screenshots, then write a review report.

## When to use

Use for one finite review when routed app states and Figma credentials are ready.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- Requires a live app and Figma token. Runtime capture navigates routes; it does not replay interactions.
- targetIds/limit narrow runtime captures; the report is still based on the full plan, so uncollected targets can be missing.
- Failed or missing report targets exit 1. Use separate capture/report commands for manually established states or external Figma tools.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `id` | `positional id` | string | no | — | Flow id under .fliwright/flows |
| `path` | `--path` | string | no | — | Direct path to a .flow.json file |
| `pixelDiffTolerance` | `--pixel-diff-tolerance` | number | no | — | Allowed visual diff ratio, default 0.03 |
| `layoutPxTolerance` | `--layout-px-tolerance` | number | no | — | Allowed layout delta in px, default 4 |
| `outputDir` | `--output-dir` | string | no | — | Review artifact root directory. Defaults to .fliwright/reviews/<flowId>-<timestamp>. |
| `accessToken` | `--access-token` | string | no | — | Figma access token. Defaults to FIGMA_ACCESS_TOKEN or FIGMA_TOKEN. |
| `scale` | `--scale` | number | no | — | Figma image render scale. |
| `pixelRatio` | `--pixel-ratio` | number | no | 1 | Runtime screenshot pixel ratio, default 1. |
| `pixelThreshold` | `--pixel-threshold` | number | no | — | Per-pixel RGBA delta threshold used by autoCompare. Default 0. |
| `autoCompare` | `--auto-compare` | boolean | no | true | Automatically compare runtime/Figma PNG screenshots. Default true. |
| `targetIds` | `--target-ids` | array<string> | no | — | Optional subset of flow node ids to capture. |
| `limit` | `--limit` | number | no | — | Optional max number of targets to capture. |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Run a complete routed design review

```sh
fliwright flow review-run 'checkout' --vm-url "$VM_URL" --output-dir '.fliwright/reviews/checkout-ci' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| path / reportPath / report | Flow and resulting review report. |
| bundlePath | Saved bundle. |
| runtimeCapturesFile / figmaCapturesFile | Saved capture manifests. |

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
    "outputDir": {
      "type": "string",
      "description": "Review artifact root directory. Defaults to .fliwright/reviews/<flowId>-<timestamp>."
    },
    "accessToken": {
      "type": "string",
      "description": "Figma access token. Defaults to FIGMA_ACCESS_TOKEN or FIGMA_TOKEN."
    },
    "scale": {
      "type": "number",
      "description": "Figma image render scale."
    },
    "pixelRatio": {
      "type": "number",
      "default": 1,
      "description": "Runtime screenshot pixel ratio, default 1."
    },
    "pixelThreshold": {
      "type": "number",
      "description": "Per-pixel RGBA delta threshold used by autoCompare. Default 0."
    },
    "autoCompare": {
      "type": "boolean",
      "default": true,
      "description": "Automatically compare runtime/Figma PNG screenshots. Default true."
    },
    "targetIds": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Optional subset of flow node ids to capture."
    },
    "limit": {
      "type": "number",
      "description": "Optional max number of targets to capture."
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

Refresh the installed contract with `fliwright schema flow.review-run --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [flow review-bundle](./command-flow.review-bundle.md) — Write a review bundle with target tasks, artifact locations and capture instructions.
- [flow review-capture-runtime](./command-flow.review-capture-runtime.md) — Navigate review target routes and save runtime screenshots plus a capture manifest.
- [flow review-report](./command-flow.review-report.md) — Compare runtime/Figma evidence and write the design review report.
- [Command index](./index.md)
