---
command: "flow.get"
group: flow
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright flow get

Read one complete flow document.

## When to use

Use to inspect node ids, routes, selectors and Figma bindings.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Pass an id positional or a direct --path. path takes precedence when both are provided.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `id` | `positional id` | string | no | — | Flow id under .fliwright/flows |
| `path` | `--path` | string | no | — | Direct path to a .flow.json file |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Read a saved flow

```sh
fliwright flow get 'checkout' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| path | Resolved input path. |
| flow | Complete Fliwright flow document. |

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
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema flow.get --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [flow list](./command-flow.list.md) — List readable flow documents saved under .fliwright/flows.
- [flow validate](./command-flow.validate.md) — Validate flow structure and report design/code/runtime binding issues.
- [flow agent-spec](./command-flow.agent-spec.md) — Convert a saved flow into a compact specification for agent reasoning.
- [Command index](./index.md)
