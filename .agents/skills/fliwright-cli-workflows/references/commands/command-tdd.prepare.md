---
command: "tdd.prepare"
group: tdd
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright tdd prepare

Generate a red-first test, store workflow context and optionally focus it in a session.

## When to use

Use to begin an intent-driven persistent TDD loop.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- An explicit connection session is required (--session or FLIWRIGHT_SESSION).
- Requires --session and a valid spec. Mode is always red-first; do not pass mode.
- focus defaults to true, but focusing happens only when outputFile produced a testFile and a runtime is started.
- Writes source and a .workflow.json sidecar when outputFile is set. Generation alone does not establish red or green evidence.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `spec` | `--spec` | unknown | no | — | Structured InteractionSpec. See the nested example; validate with tdd validate-spec. |
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
| `focus` | `--focus` | boolean | no | true | Focus the generated test if a runtime and written testFile exist. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Prepare and focus an intent-based test

```sh
cat > 'fliwright-tdd.prepare-input.json' <<'JSON'
{
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
  "outputFile": ".fliwright/tests/counter-red.test.ts",
  "focus": true
}
JSON
fliwright tdd prepare --input 'fliwright-tdd.prepare-input.json' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| testCode / testName / testFile | Generated source, name and optional written path. |
| workflow / tests / coverage / selectorDiagnostics | Generation context and diagnostics. |
| focused | Runtime snapshot when a started runtime was focused. |

## Effects and failure handling

Registry effects: `tdd-workflow`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "spec": {},
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
    },
    "focus": {
      "type": "boolean",
      "default": true
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema tdd.prepare --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [tdd validate-spec](./command-tdd.validate-spec.md) — Validate an InteractionSpec and report its executable intent coverage.
- [tdd start](./command-tdd.start.md) — Start a persistent TDD runtime inside an existing connection session.
- [tdd cycle](./command-tdd.cycle.md) — Sync the app, restore test state and rerun a focused test once.
- [generate-test](./command-generate-test.md) — Generate a test draft from Flutter source, snapshot candidates or an InteractionSpec.
- [Command index](./index.md)
