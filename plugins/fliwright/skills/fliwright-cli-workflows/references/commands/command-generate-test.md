---
command: "generate-test"
group: generation
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright generate-test

Generate a test draft from Flutter source, snapshot candidates or an InteractionSpec.

## When to use

Use for a new test before hand refinement; choose red-first for an intent-driven TDD starting point.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- default mode uses supplied refs first, then parses snapshot text, then source. source and snapshot are literal content, not filenames. description does not by itself synthesize meaningful steps.
- red-first requires a valid spec. allFlows selects suite generation; flowIds restricts its flows. Generation never executes tests.
- outputFile writes source plus a .workflow.json sidecar. With --session, red-first generation also stores workflow context for later focus.
- Snapshot candidate input is converted to durable selector candidates; never save opaque live ref tokens in generated tests.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `mode` | `--mode` | "default" \| "red-first" | no | "default" | Generation mode. Use 'red-first' with spec for TDD-oriented tests. |
| `spec` | `--spec` | object | no | — | InteractionSpec from design/intention parsing for red-first TDD generation |
| `flowId` | `--flow-id` | string | no | — | Flow id to generate when mode is red-first and spec contains multiple flows |
| `allFlows` | `--all-flows` | boolean | no | false | Generate one red-first test for every selected flow in the InteractionSpec |
| `flowIds` | `--flow-ids` | array<string> | no | — | Subset of flow ids to generate when allFlows is true |
| `testNamePrefix` | `--test-name-prefix` | string | no | — | Prefix to apply to generated suite test names when allFlows is true |
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

### Generate from design intent

```sh
cat > 'fliwright-generate-test-input.json' <<'JSON'
{
  "mode": "red-first",
  "spec": {
    "app": {
      "platform": "flutter",
      "screenName": "Counter"
    },
    "elements": [
      {
        "id": "increment",
        "role": "button",
        "name": "Increment",
        "text": "Increment",
        "locatorHints": [
          {
            "strategy": "key",
            "value": "increment"
          }
        ]
      },
      {
        "id": "count",
        "role": "text",
        "name": "Counter value",
        "text": "Count: 1"
      }
    ],
    "flows": [
      {
        "id": "increment-flow",
        "name": "Increment the counter",
        "steps": [
          {
            "action": "tap",
            "target": "increment"
          }
        ],
        "expectedOutcome": [
          {
            "kind": "text",
            "target": "count",
            "equals": "Count: 1"
          }
        ]
      }
    ]
  },
  "outputFile": ".fliwright/tests/counter-red.test.ts"
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
| warnings / selectorDiagnostics / coverage | Red-first generation quality and coverage metadata when present. |
| tests / workflow | Multi-flow suite metadata or single-flow workflow context. |

## Effects and failure handling

Registry effects: `tdd-workflow`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": [
        "default",
        "red-first"
      ],
      "default": "default",
      "description": "Generation mode. Use 'red-first' with spec for TDD-oriented tests."
    },
    "spec": {
      "type": "object",
      "properties": {
        "app": {},
        "initialState": {},
        "elements": {
          "type": "array"
        },
        "flows": {
          "type": "array"
        },
        "assertions": {
          "type": "array"
        }
      },
      "required": [
        "elements",
        "flows"
      ],
      "additionalProperties": true,
      "description": "InteractionSpec from design/intention parsing for red-first TDD generation"
    },
    "flowId": {
      "type": "string",
      "description": "Flow id to generate when mode is red-first and spec contains multiple flows"
    },
    "allFlows": {
      "type": "boolean",
      "default": false,
      "description": "Generate one red-first test for every selected flow in the InteractionSpec"
    },
    "flowIds": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Subset of flow ids to generate when allFlows is true"
    },
    "testNamePrefix": {
      "type": "string",
      "description": "Prefix to apply to generated suite test names when allFlows is true"
    },
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

- [tdd validate-spec](./command-tdd.validate-spec.md) — Validate an InteractionSpec and report its executable intent coverage.
- [tdd prepare](./command-tdd.prepare.md) — Generate a red-first test, store workflow context and optionally focus it in a session.
- [run](./command-run.md) — Run selected Vitest automation tests and save canonical run evidence.
- [flow generate-test](./command-flow.generate-test.md) — Generate a TypeScript test skeleton from a saved flow.
- [Command index](./index.md)
