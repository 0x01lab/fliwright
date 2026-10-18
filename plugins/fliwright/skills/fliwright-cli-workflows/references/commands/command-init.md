---
command: "init"
group: setup
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright init

Create project configuration, example tests/scripts and optional Flutter bridge setup.

## When to use

Use once when adopting Fliwright, or to add missing scaffold files to an existing project.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- install, node and flutter default to true in the implementation. Use --install false to inspect scaffold changes before installing.
- Existing scaffold files are preserved. package.json and ignore rules may be amended. Flutter setup requires pubspec.yaml.
- Review generated app integration and replace example widget names before running tests.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `install` | `--install` | boolean | no | — | Run dependency installation after scaffolding; effective default true. |
| `node` | `--node` | boolean | no | — | Prepare Node package tooling; effective default true. |
| `flutter` | `--flutter` | boolean | no | — | Prepare Flutter bridge integration when pubspec.yaml exists; effective default true. |
| `pm` | `--pm` | "npm" \| "pnpm" \| "yarn" \| "bun" | no | — | Package manager for init installation. If omitted it is detected. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Scaffold without dependency installation

```sh
fliwright init --install 'false' --json
```

### Set up Node tooling only

```sh
fliwright init --flutter 'false' --pm 'pnpm' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| created | New files. |
| updated | Existing files amended by setup. |
| skipped | Existing scaffold files or disabled setup steps. |
| commands | Dependency installation commands executed. |

## Effects and failure handling

Registry effects: `project-files`, `dependency-install`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "install": {
      "type": "boolean"
    },
    "node": {
      "type": "boolean"
    },
    "flutter": {
      "type": "boolean"
    },
    "pm": {
      "type": "string",
      "enum": [
        "npm",
        "pnpm",
        "yarn",
        "bun"
      ]
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema init --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [doctor](./command-doctor.md) — Check local tooling, configuration and the Flutter automation connection.
- [scenario list](./command-scenario.list.md) — List named scenarios declared in project configuration.
- [run](./command-run.md) — Run selected Vitest automation tests and save canonical run evidence.
- [Command index](./index.md)
