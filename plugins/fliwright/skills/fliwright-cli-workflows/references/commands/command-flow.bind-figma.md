---
command: "flow.bind-figma"
group: flow
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright flow bind-figma

Bind one flow node to a Figma file/node and optional code component.

## When to use

Use before preparing a design review when the flow lacks its design target.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Requires an existing flowNodeId and a file key from figmaUrl, fileKey or an existing binding.
- Writes the input flow in place. Explicit fileKey/figmaNodeId override parsed URL values; node ids normalize hyphens to colons.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `id` | `positional id` | string | no | — | Flow id under .fliwright/flows |
| `path` | `--path` | string | no | — | Direct path to a .flow.json file |
| `flowNodeId` | `--flow-node-id` | string | yes | — | Flow node id to bind to a Figma node |
| `figmaUrl` | `--figma-url` | string | no | — | Figma URL. When provided, fileKey and node id are parsed from it. |
| `fileKey` | `--file-key` | string | no | — | Figma file key when figmaUrl is not provided |
| `figmaNodeId` | `--figma-node-id` | string | no | — | Figma node id, e.g. 120:340 |
| `name` | `--name` | string | no | — | Readable Figma node or frame name |
| `codeConnectId` | `--code-connect-id` | string | no | — | Figma Code Connect id or local mapping key |
| `componentName` | `--component-name` | string | no | — | Expected code component name |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Bind a screen node

```sh
fliwright flow bind-figma 'checkout' --flow-node-id 'checkout-screen' --file-key 'FIGMA_FILE_KEY' --figma-node-id '120:340' --component-name 'CheckoutScreen' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| path | Updated flow file. |
| flow | Updated document. |
| node | Updated node with Figma binding. |

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
    "flowNodeId": {
      "type": "string",
      "description": "Flow node id to bind to a Figma node"
    },
    "figmaUrl": {
      "type": "string",
      "description": "Figma URL. When provided, fileKey and node id are parsed from it."
    },
    "fileKey": {
      "type": "string",
      "description": "Figma file key when figmaUrl is not provided"
    },
    "figmaNodeId": {
      "type": "string",
      "description": "Figma node id, e.g. 120:340"
    },
    "name": {
      "type": "string",
      "description": "Readable Figma node or frame name"
    },
    "codeConnectId": {
      "type": "string",
      "description": "Figma Code Connect id or local mapping key"
    },
    "componentName": {
      "type": "string",
      "description": "Expected code component name"
    }
  },
  "required": [
    "flowNodeId"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema flow.bind-figma --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [flow get](./command-flow.get.md) — Read one complete flow document.
- [flow validate](./command-flow.validate.md) — Validate flow structure and report design/code/runtime binding issues.
- [flow review-bundle](./command-flow.review-bundle.md) — Write a review bundle with target tasks, artifact locations and capture instructions.
- [Command index](./index.md)
