---
command: "catalog"
group: catalog
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright catalog

Collect configured suite files, named scenarios and dynamically registered Vitest cases without starting Flutter or running test/hook bodies.

## When to use

Use on an isolated, trusted checkout to create a commit-scoped test catalog. Module top-level code is imported by Vitest and must be treated as executable repository code.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Discovers all named scenarios from fliwright.config.ts; projects without scenario declarations still produce a browsable test catalog with an empty scenario list.
- Requires the project Vitest dependency. Collection imports test modules; hooks and test bodies are not run. Run in an isolated process with no device or service credentials.
- No VM Service, Flutter launch, reset, screenshot, or app bridge is used.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `suites` | `--suites` | object | no | — | Catalog command suite id to repository-relative Vitest glob mapping. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Collect the default project catalog

```sh
fliwright catalog --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| suites | Configured suite id, glob, file list and collected cases with stable duplicate ordinals. |
| scenarios | Configured scenario names and content fingerprints. |
| scannerVersion | Catalog collection implementation version. |

## Effects and failure handling

Registry effects: `trusted-project-import`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "suites": {
      "type": "object",
      "additionalProperties": {
        "type": "string",
        "minLength": 1
      }
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema catalog --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [run](./command-run.md) — Run selected Vitest automation tests and save canonical run evidence.
- [Command index](./index.md)
