---
command: "flow.review-bundle"
group: flow
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright flow review-bundle

Write a review bundle with target tasks, artifact locations and capture instructions.

## When to use

Use to coordinate runtime capture and external Figma export through separate tools.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Default root is .fliwright/reviews/<flowId>. This command prepares tasks; it does not execute screenshots or a review.
- The bundle’s figmaMcp field describes external Figma tasks, not a Fliwright MCP server.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `id` | `positional id` | string | no | — | Flow id under .fliwright/flows |
| `path` | `--path` | string | no | — | Direct path to a .flow.json file |
| `pixelDiffTolerance` | `--pixel-diff-tolerance` | number | no | — | Allowed visual diff ratio, default 0.03 |
| `layoutPxTolerance` | `--layout-px-tolerance` | number | no | — | Allowed layout delta in px, default 4 |
| `outputDir` | `--output-dir` | string | no | — | Review artifact root directory. Defaults to .fliwright/reviews/<flowId>. |
| `outputPath` | `--output-path` | string | no | — | Optional path to write the review bundle JSON. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Prepare review artifacts

```sh
fliwright flow review-bundle 'checkout' --output-dir '.fliwright/reviews/checkout' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| path | Input flow path. |
| outputPath | Written bundle JSON. |
| bundle | Review tasks and runtime/Figma/report artifact locations. |

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
      "description": "Review artifact root directory. Defaults to .fliwright/reviews/<flowId>."
    },
    "outputPath": {
      "type": "string",
      "description": "Optional path to write the review bundle JSON."
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema flow.review-bundle --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [flow review-capture-runtime](./command-flow.review-capture-runtime.md) — Navigate review target routes and save runtime screenshots plus a capture manifest.
- [flow review-capture-figma](./command-flow.review-capture-figma.md) — Download Figma target screenshots and save a capture manifest through the REST provider.
- [flow review-report](./command-flow.review-report.md) — Compare runtime/Figma evidence and write the design review report.
- [Command index](./index.md)
