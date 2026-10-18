---
command: "tdd.validate-spec"
group: generation
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright tdd validate-spec

Validate an InteractionSpec and report its executable intent coverage.

## When to use

Use before red-first generation, especially when converting design requirements into structured intent.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Supply {"spec": ...} through --input. There are no separate --elements or --flows flags.
- Invalid specs exit 1 with issues. A valid spec still needs meaningful acceptance assertions and real app selectors.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `spec` | `--spec` | unknown | no | — | Structured InteractionSpec. See the nested example; validate with tdd validate-spec. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Validate a minimal intent specification

```sh
cat > 'fliwright-tdd.validate-spec-input.json' <<'JSON'
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
  }
}
JSON
fliwright tdd validate-spec --input 'fliwright-tdd.validate-spec-input.json' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| valid | Validation success. |
| issues | Validation issues; nonempty on invalid specs. |
| coverage | Coverage analysis for a valid spec. |

## Effects and failure handling

Registry effects: `tdd-workflow`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "spec": {}
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema tdd.validate-spec --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [generate-test](./command-generate-test.md) — Generate a test draft from Flutter source, snapshot candidates or an InteractionSpec.
- [tdd prepare](./command-tdd.prepare.md) — Generate a red-first test, store workflow context and optionally focus it in a session.
- [Command index](./index.md)
