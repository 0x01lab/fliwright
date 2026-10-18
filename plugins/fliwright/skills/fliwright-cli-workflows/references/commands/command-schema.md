---
command: "schema"
group: setup
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright schema

Discover available commands or inspect one command’s machine contract.

## When to use

Read this first when a Skill needs exact current flags or structured input. The catalog is cheap and does not connect to Flutter.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Use dotted paths such as app.snapshot, or quote a space-separated path. Unknown commands exit 2.
- Inspect the matching command page for conditional requirements that Zod alone cannot express.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `path` | `positional path` | string | no | — | Optional command path, e.g. app.snapshot; omission lists the command catalog. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### List commands

```sh
fliwright schema --json
```

### Inspect one command

```sh
fliwright schema 'app.interact' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| commands[] | Without path: command paths, summaries, effects and app/session requirements. |
| input | With path: strict JSON input schema. |
| output | JSON envelope schema; data remains command-specific and is not a complete data schema. |
| exitCodes / common | Exit meanings, cancellation behavior and common CLI flags. |

## Effects and failure handling

Registry effects: none. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema schema --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [doctor](./command-doctor.md) — Check local tooling, configuration and the Flutter automation connection.
- [app snapshot](./command-app.snapshot.md) — Capture the app’s readable widget snapshot and opaque interaction refs.
- [Command index](./index.md)
