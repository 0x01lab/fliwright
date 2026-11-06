---
command: "generate-test"
group: generation
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright generate-test

Generate an editable test draft from Flutter source or snapshot candidates.

## When to use

Use for a source/snapshot starting point; the agent owns acceptance assertions and TDD decisions.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Uses supplied refs first, then snapshot text, then source. source and snapshot are literal content, not filenames. description does not by itself synthesize meaningful steps.
- outputFile writes only the test source. Generation does not run tests or establish red/green evidence.
- Review all generated actions and assertions with write-fliwright-tests. TDD requirements and implementation changes belong to the agent.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `source` | `--source` | string | no | — | Flutter/Dart source code of the page or widget to test |
| `snapshot` | `--snapshot` | string | no | — | Agent-readable snapshot text from fliwright app snapshot |
| `refs` | `--refs` | array<object> | no | — | Structured refs from fliwright app snapshot |
| `description` | `--description` | string | no | — | Natural language description of what the test should verify |
| `testName` | `--test-name` | string | no | — | Name for the generated test |
| `resetToHomeBeforeEach` | `--reset-to-home-before-each` | boolean | no | true | Whether to generate a beforeEach hook that navigates to the home route before each test |
| `homeRoute` | `--home-route` | string | no | "/" | Route used by the generated beforeEach home reset hook |
| `outputFile` | `--output-file` | string | no | — | Optional path to write the generated test file |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Generate from structured UI candidates

```sh
cat > 'fliwright-generate-test-input.json' <<'JSON'
{
  "refs": [
    {
      "role": "button",
      "label": "Increment",
      "key": "increment"
    }
  ],
  "testName": "counter increments",
  "outputFile": ".fliwright/tests/counter.test.ts"
}
JSON
fliwright generate-test --input 'fliwright-generate-test-input.json' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| testCode / testName | Generated source and name. |
| testFile | Written file path when outputFile is set. |

## Effects and failure handling

Registry effects: `filesystem-write`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "source": {
      "type": "string",
      "description": "Flutter/Dart source code of the page or widget to test"
    },
    "snapshot": {
      "type": "string",
      "description": "Agent-readable snapshot text from fliwright app snapshot"
    },
    "refs": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "role": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "key": {
            "type": "string"
          },
          "type": {
            "type": "string"
          },
          "selector": {
            "type": "string"
          },
          "textField": {
            "type": "boolean"
          }
        },
        "required": [
          "role",
          "label"
        ],
        "additionalProperties": false
      },
      "description": "Structured refs from fliwright app snapshot"
    },
    "description": {
      "type": "string",
      "description": "Natural language description of what the test should verify"
    },
    "testName": {
      "type": "string",
      "description": "Name for the generated test"
    },
    "resetToHomeBeforeEach": {
      "type": "boolean",
      "default": true,
      "description": "Whether to generate a beforeEach hook that navigates to the home route before each test"
    },
    "homeRoute": {
      "type": "string",
      "default": "/",
      "description": "Route used by the generated beforeEach home reset hook"
    },
    "outputFile": {
      "type": "string",
      "description": "Optional path to write the generated test file"
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema generate-test --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [run](./command-run.md) — Run selected Vitest automation tests and save canonical run evidence.
- [flow generate-test](./command-flow.generate-test.md) — Generate a TypeScript test skeleton from a saved flow.
- [tdd focus](./command-tdd.focus.md) — Select the file and optional test name for persistent TDD cycles.
- [Command index](./index.md)
