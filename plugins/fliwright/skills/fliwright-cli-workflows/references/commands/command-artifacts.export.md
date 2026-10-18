---
command: "artifacts.export"
group: artifacts
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright artifacts export

Export a saved run and its referenced evidence to a directory.

## When to use

Use to prepare an upload or portable offline investigation bundle.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- output is required. Incomplete evidence is rejected unless allowPartial=true.
- Destination must not already exist and must be outside the source run. Even partial export requires a valid run.json manifest. Inspect partial/missing and preserve this status with uploaded artifacts.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `runId` | `positional runId` | string | no | — | Saved run id; omission selects the latest available run where supported. (minLength=1) |
| `runsRoot` | `--runs-root` | string | no | — | Canonical run directory. Overrides config/FLIWRIGHT_RUNS_ROOT; default ~/.fliwright/projects/<project-key>/runs. (minLength=1) |
| `allowPartial` | `--allow-partial` | boolean | no | — | Tolerate unreadable report JSON when a manifest exists; export also tolerates missing references and reports them. |
| `output` | `--output` | string | yes | — | Destination directory for the run bundle. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Export a complete run

```sh
fliwright artifacts export 'RUN_ID' --output 'artifacts/exported-run' --json
```

### Recover an interrupted run explicitly

```sh
fliwright artifacts export 'RUN_ID' --output 'artifacts/recovered-run' --allow-partial 'true' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| runId / source / output | Exported run and source/destination directories. |
| partial | Whether missing evidence was tolerated. |
| missing | Missing or invalid evidence references. |

## Effects and failure handling

Registry effects: `export-files`. These are coarse declarations; the behavior section explains actual reads/writes.

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
    "output": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "output"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema artifacts.export --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [artifacts show](./command-artifacts.show.md) — Read a saved run report, manifest and the available run list.
- [artifacts failures](./command-artifacts.failures.md) — Extract saved assertion failures and runner errors from a run.
- [Command index](./index.md)
