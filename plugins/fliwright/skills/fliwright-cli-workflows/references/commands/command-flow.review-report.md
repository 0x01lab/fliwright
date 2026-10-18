---
command: "flow.review-report"
group: flow
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright flow review-report

Compare runtime/Figma evidence and write the design review report.

## When to use

Use offline after both capture sources are available, including exports from external tools.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- runtimeCaptures and figmaCaptures are arrays of flowNodeId/screenshotPath/error records. File alternatives must contain JSON arrays, not CLI envelopes.
- Each array is mutually exclusive with its matching *CapturesFile field. autoCompare defaults to true; comparisons can add layout/text/token/component metrics.
- Failed or missing report targets exit 1 with data retained. autoCompare=false disables pixel comparison only; inspect report coverage before claiming a review passed.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `id` | `positional id` | string | no | — | Flow id under .fliwright/flows |
| `path` | `--path` | string | no | — | Direct path to a .flow.json file |
| `pixelDiffTolerance` | `--pixel-diff-tolerance` | number | no | — | Allowed visual diff ratio, default 0.03 |
| `layoutPxTolerance` | `--layout-px-tolerance` | number | no | — | Allowed layout delta in px, default 4 |
| `runtimeCapturesFile` | `--runtime-captures-file` | string | no | — | JSON array file of runtime captures; exclusive with runtimeCaptures |
| `figmaCapturesFile` | `--figma-captures-file` | string | no | — | JSON array file of Figma captures; exclusive with figmaCaptures |
| `runtimeCaptures` | `--runtime-captures` | array<object> | no | — | Runtime screenshots produced by fliwright flow review-capture-runtime |
| `figmaCaptures` | `--figma-captures` | array<object> | no | — | Figma screenshots produced by Figma MCP or other design export |
| `comparisons` | `--comparisons` | array<object> | no | — | Optional visual/text/token comparison metrics from a diff engine |
| `autoCompare` | `--auto-compare` | boolean | no | true | Automatically compare runtime/Figma PNG screenshots when both paths are available. Default true. |
| `pixelThreshold` | `--pixel-threshold` | number | no | — | Per-pixel RGBA delta threshold used by autoCompare. Default 0. |
| `outputPath` | `--output-path` | string | no | — | Path to write the review report JSON. Defaults to .fliwright/reviews/<flowId>-report.json |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Compare saved capture manifests

```sh
fliwright flow review-report 'checkout' --runtime-captures-file '.fliwright/reviews/checkout/runtime/runtime-captures.json' --figma-captures-file '.fliwright/reviews/checkout/figma/figma-captures.json' --output-path '.fliwright/reviews/checkout/report.json' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| path | Input flow path. |
| reportPath | Written report JSON. |
| report | Per-target review findings and summary, including failed/missing counts. |

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
    "runtimeCapturesFile": {
      "type": "string",
      "description": "JSON array file of runtime captures; exclusive with runtimeCaptures"
    },
    "figmaCapturesFile": {
      "type": "string",
      "description": "JSON array file of Figma captures; exclusive with figmaCaptures"
    },
    "runtimeCaptures": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "flowNodeId": {
            "type": "string"
          },
          "screenshotPath": {
            "type": "string"
          },
          "error": {
            "type": "string"
          }
        },
        "required": [
          "flowNodeId"
        ],
        "additionalProperties": false
      },
      "description": "Runtime screenshots produced by fliwright flow review-capture-runtime"
    },
    "figmaCaptures": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "flowNodeId": {
            "type": "string"
          },
          "screenshotPath": {
            "type": "string"
          },
          "error": {
            "type": "string"
          }
        },
        "required": [
          "flowNodeId"
        ],
        "additionalProperties": false
      },
      "description": "Figma screenshots produced by Figma MCP or other design export"
    },
    "comparisons": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "flowNodeId": {
            "type": "string"
          },
          "pixelDiff": {
            "type": "number"
          },
          "layoutPx": {
            "type": "number"
          },
          "textMismatches": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "tokenMismatches": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "componentMismatches": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "error": {
            "type": "string"
          },
          "notes": {
            "type": "string"
          }
        },
        "required": [
          "flowNodeId"
        ],
        "additionalProperties": false
      },
      "description": "Optional visual/text/token comparison metrics from a diff engine"
    },
    "autoCompare": {
      "type": "boolean",
      "default": true,
      "description": "Automatically compare runtime/Figma PNG screenshots when both paths are available. Default true."
    },
    "pixelThreshold": {
      "type": "number",
      "description": "Per-pixel RGBA delta threshold used by autoCompare. Default 0."
    },
    "outputPath": {
      "type": "string",
      "description": "Path to write the review report JSON. Defaults to .fliwright/reviews/<flowId>-report.json"
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema flow.review-report --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [flow review-capture-runtime](./command-flow.review-capture-runtime.md) — Navigate review target routes and save runtime screenshots plus a capture manifest.
- [flow review-capture-figma](./command-flow.review-capture-figma.md) — Download Figma target screenshots and save a capture manifest through the REST provider.
- [flow review-plan](./command-flow.review-plan.md) — Derive design review targets and tolerances without capturing images.
- [Command index](./index.md)
