---
command: "flow.validate"
group: flow
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright flow validate

Validate flow structure and report design/code/runtime binding issues.

## When to use

Use before generating tests or running a visual review.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Validation errors exit 1 and retain data; warnings alone do not fail.
- requireCodeTargetForFigmaNodes and requireReviewRuntimeEntryForFigmaNodes add warnings. The currently accepted requireFigmaForFigmaNodes flag is not forwarded by the command; the validator’s own policy applies.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `id` | `positional id` | string | no | — | Flow id under .fliwright/flows |
| `path` | `--path` | string | no | — | Direct path to a .flow.json file |
| `requireFigmaForFigmaNodes` | `--require-figma-for-figma-nodes` | boolean | no | — | Require figma nodes to have fileKey/nodeId. Default true. |
| `requireCodeTargetForFigmaNodes` | `--require-code-target-for-figma-nodes` | boolean | no | — | Warn when Figma-bound nodes lack componentName/codeConnectId |
| `requireReviewRuntimeEntryForFigmaNodes` | `--require-review-runtime-entry-for-figma-nodes` | boolean | no | — | Warn when Figma-bound nodes lack route/selector/recording screenshot entry points |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Check design review readiness

```sh
fliwright flow validate 'checkout' --require-code-target-for-figma-nodes 'true' --require-review-runtime-entry-for-figma-nodes 'true' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| path | Input flow path. |
| validation | Validation issues with errorCount and warnings. |

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
    "requireFigmaForFigmaNodes": {
      "type": "boolean",
      "description": "Require figma nodes to have fileKey/nodeId. Default true."
    },
    "requireCodeTargetForFigmaNodes": {
      "type": "boolean",
      "description": "Warn when Figma-bound nodes lack componentName/codeConnectId"
    },
    "requireReviewRuntimeEntryForFigmaNodes": {
      "type": "boolean",
      "description": "Warn when Figma-bound nodes lack route/selector/recording screenshot entry points"
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema flow.validate --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [flow get](./command-flow.get.md) — Read one complete flow document.
- [flow bind-figma](./command-flow.bind-figma.md) — Bind one flow node to a Figma file/node and optional code component.
- [flow review-plan](./command-flow.review-plan.md) — Derive design review targets and tolerances without capturing images.
- [Command index](./index.md)
