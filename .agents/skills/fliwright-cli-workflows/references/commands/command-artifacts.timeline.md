---
command: "artifacts.timeline"
group: artifacts
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright artifacts timeline

Read a saved attempt timeline or inspect one node and its neighbors.

## When to use

Use to trace the sequence leading to a failure without reconnecting to Flutter.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Select testId+attemptId when a run has multiple timelines, or pass path directly. Ambiguous selection fails rather than choosing an arbitrary attempt.
- Artifacts are excluded from nodes unless includeArtifacts=true. includeFlow=true also derives a flow.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `runId` | `positional runId` | string | no | — | Saved run id; omission selects the latest available run where supported. (minLength=1) |
| `runsRoot` | `--runs-root` | string | no | — | Canonical run directory. Overrides config/FLIWRIGHT_RUNS_ROOT; default <project>/.fliwright/runs. Relative paths use the project root. (minLength=1) |
| `allowPartial` | `--allow-partial` | boolean | no | — | Tolerate unreadable report JSON when a manifest exists; export also tolerates missing references and reports them. |
| `path` | `--path` | string | no | — | Direct path to timeline JSON; overrides run/test/attempt lookup. (minLength=1) |
| `testId` | `--test-id` | string | no | — | Manifest test identity used to select a timeline. (minLength=1) |
| `attemptId` | `--attempt-id` | string | no | — | Attempt identity used to select one retry timeline. (minLength=1) |
| `nodeId` | `--node-id` | string | no | — | Timeline node id for local context rather than the full timeline. (minLength=1) |
| `includeArtifacts` | `--include-artifacts` | boolean | no | — | Keep artifact references on returned timeline nodes. |
| `includeFlow` | `--include-flow` | boolean | no | — | Also derive a flow from the selected timeline. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Inspect one CI attempt

```sh
fliwright artifacts timeline 'RUN_ID' --test-id 'TEST_ID' --attempt-id 'ATTEMPT_ID' --include-artifacts 'true' --json
```

### Read an explicit timeline file

```sh
fliwright artifacts timeline --path 'artifacts/timeline.json' --include-flow 'true' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| path | Selected timeline JSON path. |
| timeline | Full timeline when nodeId is omitted. |
| node / parent / children / previous / next | Node-local context when nodeId is supplied. |
| flow | Optional flow derived from the timeline. |

## Effects and failure handling

Registry effects: none. These are coarse declarations; the behavior section explains actual reads/writes.

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
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema artifacts.timeline --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [artifacts show](./command-artifacts.show.md) — Read a saved run report, manifest and the available run list.
- [artifacts failures](./command-artifacts.failures.md) — Extract saved assertion failures and runner errors from a run.
- [artifacts diagnose](./command-artifacts.diagnose.md) — Request optional AI diagnosis of a saved or explicitly supplied agent-visible failure.
- [Command index](./index.md)
