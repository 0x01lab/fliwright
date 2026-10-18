---
command: "mock.list"
group: mock
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright mock list

List locally available HTTP endpoints and named response rules.

## When to use

Use before choosing a rule to apply. No Flutter connection is required.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Default directory is .fliwright/mocks. Files describe available rules, not necessarily the routes currently active inside Flutter.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `mockDir` | `--mock-dir` | string | no | — | Local mock rule directory; default .fliwright/mocks. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Inspect the local mock catalog

```sh
fliwright mock list --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| mockDir | Resolved rule directory. |
| rules | Endpoint catalog including named scenarios and method metadata. |

## Effects and failure handling

Registry effects: none. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "mockDir": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema mock.list --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [mock apply](./command-mock.apply.md) — Install one named local mock response rule into Flutter.
- [mock status](./command-mock.status.md) — Compare local rule definitions with active Flutter routes and captured HTTP calls.
- [Command index](./index.md)
