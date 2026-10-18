---
command: "flow.agent-spec"
group: flow
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright flow agent-spec

Convert a saved flow into a compact specification for agent reasoning.

## When to use

Use when a Skill needs the flow’s intent and structure without the entire document.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- This is FlowAgentSpec, not the InteractionSpec required by generate-test --mode red-first. Do not pass it through without deliberate conversion.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `id` | `positional id` | string | no | — | Flow id under .fliwright/flows |
| `path` | `--path` | string | no | — | Direct path to a .flow.json file |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Extract agent context

```sh
fliwright flow agent-spec 'checkout' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| path | Input flow path. |
| spec | FlowAgentSpec derived from the flow. |

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

Refresh the installed contract with `fliwright schema flow.agent-spec --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [flow get](./command-flow.get.md) — Read one complete flow document.
- [flow generate-test](./command-flow.generate-test.md) — Generate a TypeScript test skeleton from a saved flow.
- [tdd validate-spec](./command-tdd.validate-spec.md) — Validate an InteractionSpec and report its executable intent coverage.
- [Command index](./index.md)
