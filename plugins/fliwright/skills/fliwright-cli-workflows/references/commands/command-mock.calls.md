---
command: "mock.calls"
group: mock
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright mock calls

Read captured Flutter HTTP calls, optionally filtered by endpoint and method.

## When to use

Use to verify whether a workflow made a request or matched a mock route.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- Does not clear history. Use clear-calls to begin a new observation window without changing routes.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `vmUrl` | `--vm-url` | string | no | — | Dart VM Service websocket URL. Omit to use project/environment endpoint resolution where supported. (minLength=1) |
| `mockDir` | `--mock-dir` | string | no | — | Local mock rule directory; default .fliwright/mocks. (minLength=1) |
| `endpoint` | `--endpoint` | string | no | — | HTTP endpoint/path to query or install from the mock catalog. (minLength=1) |
| `method` | `--method` | string | no | — | HTTP verb filter/disambiguator, case-insensitive. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Inspect GET requests

```sh
fliwright mock calls --endpoint '/api/items' --method 'GET' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| calls | Captured HTTP call records. |
| count | Returned call count. |

## Effects and failure handling

Registry effects: none. These are coarse declarations; the behavior section explains actual reads/writes.

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
    "mockDir": {
      "type": "string",
      "minLength": 1
    },
    "endpoint": {
      "type": "string",
      "minLength": 1
    },
    "method": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema mock.calls --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [mock clear-calls](./command-mock.clear-calls.md) — Clear captured HTTP call history while keeping mock routes.
- [mock status](./command-mock.status.md) — Compare local rule definitions with active Flutter routes and captured HTTP calls.
- [Command index](./index.md)
