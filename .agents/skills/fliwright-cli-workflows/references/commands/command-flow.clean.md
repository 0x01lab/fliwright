---
command: "flow.clean"
group: flow
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright flow clean

Plan or apply AI-assisted cleanup of a flow document.

## When to use

Use to remove recording noise while protecting meaningful workflow nodes.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Defaults to updating the input flow; use dryRun=true to review the plan first or outputPath to write a separate file.
- AI provider defaults to configured FLIWRIGHT_AI_PROVIDER. protectedNodeIds prevents selected nodes being removed.
- Cleanup changes the flow model, not running app state. Validate the result before generating tests.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `id` | `positional id` | string | no | — | Flow id under .fliwright/flows |
| `path` | `--path` | string | no | — | Direct path to a .flow.json file |
| `outputPath` | `--output-path` | string | no | — | Path to write cleaned flow JSON. Defaults to updating the input flow. |
| `dryRun` | `--dry-run` | boolean | no | — | Return clean plan and cleaned flow without writing. Default false. |
| `aiProvider` | `--ai-provider` | "claude" \| "codex" \| "custom-cli" \| "mock" \| "none" | no | — | AI provider used for cleaning. Defaults to FLIWRIGHT_AI_PROVIDER. |
| `aiTimeoutMs` | `--ai-timeout-ms` | number | no | — | AI invocation timeout in milliseconds. |
| `protectedNodeIds` | `--protected-node-ids` | array<string> | no | — | Flow node ids to always keep. |
| `instructions` | `--instructions` | string | no | — | Additional cleaning instructions for the AI. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Review a cleanup plan

```sh
cat > 'fliwright-flow.clean-input.json' <<'JSON'
{
  "id": "checkout",
  "dryRun": true,
  "protectedNodeIds": [
    "checkout-screen"
  ]
}
JSON
fliwright flow clean --input 'fliwright-flow.clean-input.json' --json
```

### Save a cleaned copy

```sh
fliwright flow clean 'checkout' --output-path '.fliwright/flows/checkout-clean.flow.json' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| path / outputPath | Input and intended output paths. |
| flow | Cleaned document. |
| plan | Cleanup plan and decisions. |
| dryRun | Whether writes were suppressed. |

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
    "outputPath": {
      "type": "string",
      "description": "Path to write cleaned flow JSON. Defaults to updating the input flow."
    },
    "dryRun": {
      "type": "boolean",
      "description": "Return clean plan and cleaned flow without writing. Default false."
    },
    "aiProvider": {
      "type": "string",
      "enum": [
        "claude",
        "codex",
        "custom-cli",
        "mock",
        "none"
      ],
      "description": "AI provider used for cleaning. Defaults to FLIWRIGHT_AI_PROVIDER."
    },
    "aiTimeoutMs": {
      "type": "number",
      "description": "AI invocation timeout in milliseconds."
    },
    "protectedNodeIds": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Flow node ids to always keep."
    },
    "instructions": {
      "type": "string",
      "description": "Additional cleaning instructions for the AI."
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema flow.clean --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [flow get](./command-flow.get.md) — Read one complete flow document.
- [flow validate](./command-flow.validate.md) — Validate flow structure and report design/code/runtime binding issues.
- [flow generate-test](./command-flow.generate-test.md) — Generate a TypeScript test skeleton from a saved flow.
- [Command index](./index.md)
