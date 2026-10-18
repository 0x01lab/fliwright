---
command: "doctor"
group: setup
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright doctor

Check local tooling, configuration and the Flutter automation connection.

## When to use

Use before live commands or as a CI preflight. --strict makes missing required checks fail the command.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Without --strict, ok:true means checks completed, not that every check passed.
- Strict mode exits 3 if a required check failed or was skipped; Riverpod observer and Mock server checks are optional. Read data.checks on failure.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `strict` | `--strict` | boolean | no | — | Fail doctor if any required check failed or was skipped. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Inspect local checks

```sh
fliwright doctor --json
```

### Require an available app in CI

```sh
fliwright doctor --strict 'true' --vm-url "$VM_URL" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| checks[] | Each check includes name, passed, message, required and status (passed/failed/skipped). |

## Effects and failure handling

Registry effects: `environment-probe`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "vmUrl": {
      "type": "string",
      "minLength": 1
    },
    "strict": {
      "type": "boolean"
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema doctor --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [init](./command-init.md) — Create project configuration, example tests/scripts and optional Flutter bridge setup.
- [app status](./command-app.status.md) — Verify a live app connection and read its Dart SDK identity.
- [run](./command-run.md) — Run selected Vitest automation tests and save canonical run evidence.
- [Command index](./index.md)
