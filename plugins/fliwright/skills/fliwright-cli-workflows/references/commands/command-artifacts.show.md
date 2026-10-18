---
command: "artifacts.show"
group: artifacts
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright artifacts show

Read a saved run report, manifest and the available run list.

## When to use

Use as the offline evidence entry point, including after the app has stopped.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Omitting runId selects the newest available run. With no runs, report is null; this is not proof a test passed.
- Root resolution uses explicit runsRoot, FLIWRIGHT_RUNS_ROOT, project config, then <project>/.fliwright/runs. Relative roots resolve from the project config directory. Inspect evidence status before treating interrupted runs as complete.
- allowPartial tolerates an unreadable report when a manifest is available; reportIssue records the gap.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `runId` | `positional runId` | string | no | — | Saved run id; omission selects the latest available run where supported. (minLength=1) |
| `runsRoot` | `--runs-root` | string | no | — | Canonical run directory. Overrides config/FLIWRIGHT_RUNS_ROOT; default <project>/.fliwright/runs. Relative paths use the project root. (minLength=1) |
| `allowPartial` | `--allow-partial` | boolean | no | — | Tolerate unreadable report JSON when a manifest exists; export also tolerates missing references and reports them. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Read the latest run

```sh
fliwright artifacts show --json
```

### Read a CI run

```sh
fliwright artifacts show 'RUN_ID' --runs-root 'artifacts/runs' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| runsRoot / runs | Artifact root and available runs. |
| runId / reportPath / report | Selected run and report, when found. |
| manifest / reportIssue | Evidence manifest and report-read issue when present. |

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
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema artifacts.show --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [artifacts failures](./command-artifacts.failures.md) — Extract saved assertion failures and runner errors from a run.
- [artifacts timeline](./command-artifacts.timeline.md) — Read a saved attempt timeline or inspect one node and its neighbors.
- [artifacts export](./command-artifacts.export.md) — Export a saved run and its referenced evidence to a directory.
- [Command index](./index.md)
