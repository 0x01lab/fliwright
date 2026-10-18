---
command: "tdd.focus"
group: tdd
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright tdd focus

Select the file and optional test name for persistent TDD cycles.

## When to use

Use after tdd start, or after generating a different test file.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- An explicit connection session is required (--session or FLIWRIGHT_SESSION).
- Requires a started runtime. file can be omitted only if workflow context has a testFile from generation.
- This selects the test; it does not run a cycle.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `file` | `--file` | string | no | — | Automation file to execute or focus; interpreted relative to cwd. (minLength=1) |
| `testName` | `--test-name` | string | no | — | Test-name selection or generated test name; see this command’s usage. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Focus a single test

```sh
fliwright tdd focus --file '.fliwright/tests/counter.test.ts' --test-name 'counter increments' --session "$SESSION_ID" --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| (data) | RuntimeSnapshot returned directly, including focusedTest. |

## Effects and failure handling

Registry effects: `tdd-workflow`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "file": {
      "type": "string",
      "minLength": 1
    },
    "testName": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema tdd.focus --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [tdd start](./command-tdd.start.md) — Start a persistent TDD runtime inside an existing connection session.
- [tdd prepare](./command-tdd.prepare.md) — Generate a red-first test, store workflow context and optionally focus it in a session.
- [tdd cycle](./command-tdd.cycle.md) — Sync the app, restore test state and rerun a focused test once.
- [Command index](./index.md)
