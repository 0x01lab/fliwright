---
command: "devassist.cycle"
group: tdd
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright devassist cycle

Coordinate a design/development request through the persistent DevAssist workflow.

## When to use

Use when a development request needs structured phases and focused TDD evidence.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- An explicit connection session is required (--session or FLIWRIGHT_SESSION).
- Requires a started TDD runtime. action is start/continue/regenerate; continue and regenerate require devAssistSessionId.
- The development-assist session id differs from the connection --session id. Preserve the returned workflow state.
- files and baseRevision describe change context; do not assume this command independently implements arbitrary source edits.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `request` | `--request` | string | no | — | Natural-language development/verification request for DevAssist. (minLength=1) |
| `devAssistSessionId` | `--dev-assist-session-id` | string | no | — | DevAssist continuation identity, distinct from the CLI connection session. (minLength=1) |
| `action` | `--action` | "start" \| "continue" \| "regenerate" | no | — | Extended interaction or DevAssist action; allowed values are derived from the schema. |
| `files` | `--files` | array<string> | no | — | Changed/relevant file paths for DevAssist context. |
| `baseRevision` | `--base-revision` | string | no | — | Git revision used to establish the DevAssist change-set baseline. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Start a bounded development request

```sh
cat > 'fliwright-devassist.cycle-input.json' <<'JSON'
{
  "action": "start",
  "request": "Verify the counter increments when Increment is tapped",
  "files": [
    "lib/counter.dart"
  ]
}
JSON
fliwright devassist cycle --input 'fliwright-devassist.cycle-input.json' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| status | DevAssist workflow outcome; blocked is a business outcome and may still exit 0. |
| devAssistSessionId | Continuation identity. |
| reason / nextCall | Why work stopped and suggested continuation input when present. |
| candidateTestPath / devAssistTracePath / timelinePath / artifacts | Generated candidate and evidence references when present. |

## Effects and failure handling

Registry effects: `tdd-workflow`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "request": {
      "type": "string",
      "minLength": 1
    },
    "devAssistSessionId": {
      "type": "string",
      "minLength": 1
    },
    "action": {
      "type": "string",
      "enum": [
        "start",
        "continue",
        "regenerate"
      ]
    },
    "files": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "baseRevision": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema devassist.cycle --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [tdd start](./command-tdd.start.md) — Start a persistent TDD runtime inside an existing connection session.
- [tdd prepare](./command-tdd.prepare.md) — Generate a red-first test, store workflow context and optionally focus it in a session.
- [tdd cycle](./command-tdd.cycle.md) — Sync the app, restore test state and rerun a focused test once.
- [Command index](./index.md)
