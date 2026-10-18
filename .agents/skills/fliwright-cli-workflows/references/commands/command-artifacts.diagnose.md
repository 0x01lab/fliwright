---
command: "artifacts.diagnose"
group: artifacts
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright artifacts diagnose

Request optional AI diagnosis of a saved or explicitly supplied agent-visible failure.

## When to use

Use after selecting the correct attempt and reviewing its deterministic evidence.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Requires an agent-visible failure, from a timeline or input.failure. failureIndex is zero-based and defaults to 0.
- Uses configured AI runtime; may invoke an external provider. It does not apply a repair.
- An explicit failure alone does not require run artifacts. If you also provide runId/path, it loads timeline context.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `runId` | `positional runId` | string | no | — | Saved run id; omission selects the latest available run where supported. (minLength=1) |
| `runsRoot` | `--runs-root` | string | no | — | Canonical run directory. Overrides config/FLIWRIGHT_RUNS_ROOT; default ~/.fliwright/projects/<project-key>/runs. (minLength=1) |
| `allowPartial` | `--allow-partial` | boolean | no | — | Tolerate unreadable report JSON when a manifest exists; export also tolerates missing references and reports them. |
| `path` | `--path` | string | no | — | Direct timeline JSON path to use as diagnosis context. (minLength=1) |
| `testId` | `--test-id` | string | no | — | Manifest test identity used to select a timeline. (minLength=1) |
| `attemptId` | `--attempt-id` | string | no | — | Attempt identity used to select one retry timeline. (minLength=1) |
| `nodeId` | `--node-id` | string | no | — | Timeline node id for local context rather than the full timeline. (minLength=1) |
| `includeArtifacts` | `--include-artifacts` | boolean | no | — | Keep artifact references on returned timeline nodes. |
| `includeFlow` | `--include-flow` | boolean | no | — | Also derive a flow from the selected timeline. |
| `failureIndex` | `--failure-index` | integer | no | — | Zero-based agent-visible failure index in the selected timeline; default 0. (minimum=0) |
| `failure` | `--failure` | object | no | — | Explicit agent-visible failure {code,title,message,timelineNodeId?}; use --input. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Diagnose a selected attempt

```sh
fliwright artifacts diagnose 'RUN_ID' --test-id 'TEST_ID' --attempt-id 'ATTEMPT_ID' --failure-index '0' --json
```

### Diagnose supplied evidence

```sh
cat > 'fliwright-artifacts.diagnose-input.json' <<'JSON'
{
  "failure": {
    "code": "ASSERTION_FAILED",
    "title": "Counter missing",
    "message": "Expected Count: 1 after tapping Increment"
  }
}
JSON
fliwright artifacts diagnose --input 'fliwright-artifacts.diagnose-input.json' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| diagnosis | AI diagnosis when a configured provider produced one. |
| skipped | true if no diagnosis was produced; this is not a successful repair. |

## Effects and failure handling

Registry effects: `optional-ai`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1
    },
    "runsRoot": {
      "type": "string",
      "minLength": 1
    },
    "allowPartial": {
      "type": "boolean"
    },
    "path": {
      "type": "string",
      "minLength": 1
    },
    "testId": {
      "type": "string",
      "minLength": 1
    },
    "attemptId": {
      "type": "string",
      "minLength": 1
    },
    "nodeId": {
      "type": "string",
      "minLength": 1
    },
    "includeArtifacts": {
      "type": "boolean"
    },
    "includeFlow": {
      "type": "boolean"
    },
    "failureIndex": {
      "type": "integer",
      "minimum": 0
    },
    "failure": {
      "type": "object",
      "properties": {
        "code": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "message": {
          "type": "string"
        },
        "timelineNodeId": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "code",
        "title",
        "message"
      ],
      "additionalProperties": false
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema artifacts.diagnose --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [artifacts timeline](./command-artifacts.timeline.md) — Read a saved attempt timeline or inspect one node and its neighbors.
- [artifacts failures](./command-artifacts.failures.md) — Extract saved assertion failures and runner errors from a run.
- [app debug-snapshot](./command-app.debug-snapshot.md) — Collect a structural snapshot plus independent debug evidence channels.
- [Command index](./index.md)
