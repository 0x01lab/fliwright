---
command: "flow.list"
group: flow
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright flow list

List readable flow documents saved under .fliwright/flows.

## When to use

Use to discover a recorded/design flow id before further flow commands.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Malformed draft files are skipped. An empty list does not distinguish an absent directory from unreadable drafts.

## Input

No command-specific input fields.

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Discover saved flows

```sh
fliwright flow list --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| flows | Newest-first entries: id/title/updatedAt/source/path/nodeCount/edgeCount. |

## Effects and failure handling

Registry effects: `flow-artifacts`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema flow.list --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [flow get](./command-flow.get.md) — Read one complete flow document.
- [record](./command-record.md) — Capture user interactions and produce recording, flow and automation draft evidence.
- [Command index](./index.md)
