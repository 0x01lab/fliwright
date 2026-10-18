---
command: "mock.status"
group: mock
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright mock status

Compare local rule definitions with active Flutter routes and captured HTTP calls.

## When to use

Use when a request did not receive the expected mocked response.

## Preconditions and behavior

- A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.
- No persistent session required. See usage for finite/session variants.
- endpoint and method filter results. Requires app-side mock support; local files alone do not activate mocking.

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

### Inspect an endpoint

```sh
fliwright mock status --endpoint '/api/items' --method 'GET' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| connected | Live app connection succeeded. |
| rules | Matching local catalog entries. |
| routes | Matching routes installed in Flutter. |
| calls | Matching captured calls. |

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

Refresh the installed contract with `fliwright schema mock.status --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [mock list](./command-mock.list.md) — List locally available HTTP endpoints and named response rules.
- [mock apply](./command-mock.apply.md) — Install one named local mock response rule into Flutter.
- [mock calls](./command-mock.calls.md) — Read captured Flutter HTTP calls, optionally filtered by endpoint and method.
- [Command index](./index.md)
