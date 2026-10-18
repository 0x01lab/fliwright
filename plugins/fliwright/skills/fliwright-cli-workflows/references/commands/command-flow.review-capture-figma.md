---
command: "flow.review-capture-figma"
group: flow
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright flow review-capture-figma

Download Figma target screenshots and save a capture manifest through the REST provider.

## When to use

Use when a Figma API token is available and targets have file/node bindings.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Reads accessToken or FIGMA_ACCESS_TOKEN/FIGMA_TOKEN. Prefer environment credentials over command-line tokens.
- Alternatively use an external Figma tool and produce the same capture-array input for review-report.
- Inspect capture errors even if the wrapper exits 0; individual REST capture errors may be represented in capture entries.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `id` | `positional id` | string | no | — | Flow id under .fliwright/flows |
| `path` | `--path` | string | no | — | Direct path to a .flow.json file |
| `pixelDiffTolerance` | `--pixel-diff-tolerance` | number | no | — | Allowed visual diff ratio, default 0.03 |
| `layoutPxTolerance` | `--layout-px-tolerance` | number | no | — | Allowed layout delta in px, default 4 |
| `outputDir` | `--output-dir` | string | no | — | Directory for Figma screenshots. Defaults to .fliwright/reviews/<flowId>/figma. |
| `capturesFile` | `--captures-file` | string | no | — | Path to write figma-captures.json. |
| `accessToken` | `--access-token` | string | no | — | Figma access token. Defaults to FIGMA_ACCESS_TOKEN or FIGMA_TOKEN. |
| `scale` | `--scale` | number | no | — | Figma image render scale. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Capture bound Figma nodes using an environment token

```sh
fliwright flow review-capture-figma 'checkout' --scale '1' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| path / outputDir | Flow path and design capture directory. |
| capturesFile | Written JSON array for review-report. |
| captures | Per-target screenshot references or errors. |

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
      "description": "Directory for Figma screenshots. Defaults to .fliwright/reviews/<flowId>/figma."
    },
    "capturesFile": {
      "type": "string",
      "description": "Path to write figma-captures.json."
    },
    "accessToken": {
      "type": "string",
      "description": "Figma access token. Defaults to FIGMA_ACCESS_TOKEN or FIGMA_TOKEN."
    },
    "scale": {
      "type": "number",
      "description": "Figma image render scale."
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema flow.review-capture-figma --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [flow bind-figma](./command-flow.bind-figma.md) — Bind one flow node to a Figma file/node and optional code component.
- [flow review-bundle](./command-flow.review-bundle.md) — Write a review bundle with target tasks, artifact locations and capture instructions.
- [flow review-report](./command-flow.review-report.md) — Compare runtime/Figma evidence and write the design review report.
- [Command index](./index.md)
