---
command: "flow.generate-test"
group: flow
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright flow generate-test

Generate a TypeScript test skeleton from a saved flow.

## When to use

Use to turn a reviewed flow into an editable starting point for durable tests.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Writes only when outputFile is supplied. The skeleton is not executed or verified; review selectors, assertions and scenario setup.
- useFlowSteps defaults to true. This differs from top-level generate-test, which accepts source/snapshot/InteractionSpec.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `id` | `positional id` | string | no | — | Flow id under .fliwright/flows |
| `path` | `--path` | string | no | — | Direct path to a .flow.json file |
| `testName` | `--test-name` | string | no | — | Generated test name. Defaults to flow title or id. |
| `outputFile` | `--output-file` | string | no | — | Optional path to write the generated test skeleton |
| `resetToHomeBeforeEach` | `--reset-to-home-before-each` | boolean | no | — | Generate a beforeEach page.resetToHome hook |
| `homeRoute` | `--home-route` | string | no | — | Home route used by the beforeEach reset hook |
| `useFlowSteps` | `--use-flow-steps` | boolean | no | — | Wrap each flow node in flow.step calls; default true |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Write an editable skeleton

```sh
fliwright flow generate-test 'checkout' --output-file '.fliwright/tests/checkout.test.ts' --use-flow-steps 'true' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| path | Input flow path. |
| code | Generated test skeleton. |
| outputFile | Written target path when requested. |

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
    "testName": {
      "type": "string",
      "description": "Generated test name. Defaults to flow title or id."
    },
    "outputFile": {
      "type": "string",
      "description": "Optional path to write the generated test skeleton"
    },
    "resetToHomeBeforeEach": {
      "type": "boolean",
      "description": "Generate a beforeEach page.resetToHome hook"
    },
    "homeRoute": {
      "type": "string",
      "description": "Home route used by the beforeEach reset hook"
    },
    "useFlowSteps": {
      "type": "boolean",
      "description": "Wrap each flow node in flow.step calls; default true"
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema flow.generate-test --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [flow validate](./command-flow.validate.md) — Validate flow structure and report design/code/runtime binding issues.
- [generate-test](./command-generate-test.md) — Generate a test draft from Flutter source, snapshot candidates or an InteractionSpec.
- [run](./command-run.md) — Run selected Vitest automation tests and save canonical run evidence.
- [Command index](./index.md)
