---
command: "mock.start"
group: mock
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright mock start

Run a foreground local HTTP mock controller from the rule directory.

## When to use

Use with an HTTP mock adapter that sends structured mock requests to the controller.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- This exposes a controller protocol: clients POST a structured request to /mock; it does not serve each mocked endpoint as a normal HTTP URL. Flutter routes installed by mock apply are separate. It cannot execute inside a connection session.
- Stops on SIGINT/SIGTERM or --deadline. Configure the adapter with the logged controller URL; host defaults to 127.0.0.1, port to an available port.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `host` | `--host` | string | no | — | Local HTTP listener bind host; default 127.0.0.1. (minLength=1) |
| `port` | `--port` | integer | no | — | Local HTTP port; default 0 chooses an available port. (minimum=0, maximum=65535) |
| `mockDir` | `--mock-dir` | string | no | — | Local mock rule directory; default .fliwright/mocks. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Start a bounded localhost listener

```sh
fliwright mock start --host '127.0.0.1' --port '3001' --deadline '60000' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| (data) | No data payload. The controller URL is logged to stderr on startup; the foreground command finishes only after shutdown. |

## Effects and failure handling

Registry effects: `local-http-listener`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "host": {
      "type": "string",
      "minLength": 1
    },
    "port": {
      "type": "integer",
      "minimum": 0,
      "maximum": 65535
    },
    "mockDir": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema mock.start --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [mock list](./command-mock.list.md) — List locally available HTTP endpoints and named response rules.
- [mock apply](./command-mock.apply.md) — Install one named local mock response rule into Flutter.
- [Command index](./index.md)
