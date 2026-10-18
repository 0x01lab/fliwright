---
command: "artifacts.failures"
group: artifacts
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright artifacts failures

Extract saved assertion failures and runner errors from a run.

## When to use

Use before editing application code after a failed CI run.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Can recover per-attempt failure contexts when the top-level report is missing. Empty failures may still coexist with runnerErrors or incomplete evidence.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `runId` | `positional runId` | string | no | — | Saved run id; omission selects the latest available run where supported. (minLength=1) |
| `runsRoot` | `--runs-root` | string | no | — | Canonical run directory. Overrides config/FLIWRIGHT_RUNS_ROOT; default ~/.fliwright/projects/<project-key>/runs. (minLength=1) |
| `allowPartial` | `--allow-partial` | boolean | no | — | Tolerate unreadable report JSON when a manifest exists; export also tolerates missing references and reports them. |
| `testName` | `--test-name` | string | no | — | Test-name selection or generated test name; see this command’s usage. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Read the latest failures

```sh
fliwright artifacts failures --json
```

### Filter an exact test name

```sh
fliwright artifacts failures 'RUN_ID' --test-name 'counter increments' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| runId | Selected run. |
| failures | Saved failure contexts; testName optionally filters exact names. |
| runnerErrors | Runner failures from the report. |
| evidenceStatus | Manifest completeness status when available. |

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
    "testName": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema artifacts.failures --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [artifacts show](./command-artifacts.show.md) — Read a saved run report, manifest and the available run list.
- [artifacts timeline](./command-artifacts.timeline.md) — Read a saved attempt timeline or inspect one node and its neighbors.
- [artifacts diagnose](./command-artifacts.diagnose.md) — Request optional AI diagnosis of a saved or explicitly supplied agent-visible failure.
- [Command index](./index.md)
