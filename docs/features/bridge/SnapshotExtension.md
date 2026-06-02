---
module: "SnapshotExtension"
package: "fliwright_bridge"
source: "lib/src/extensions/snapshot.dart"
generated: "2026-06-02"
---

# SnapshotExtension

> Capture a serialized view of the interactive widget tree (and selected metadata) for self-healing analysis and failure context.

## Registered Methods

| Method | Description |
|--------|-------------|
| `ext.fliwright.snapshot` | Return interactive widget tree |

### `ext.fliwright.snapshot`

No params.

**Returns:** an object whose top-level structure includes a list of `WidgetSnapshot`-style entries:

| Field | Description |
|-------|-------------|
| `type` | Runtime type |
| `text`, `key` | Identifiers |
| `parentType` | Immediate parent's type |
| `adjacentText` | Sibling widget text labels (used for `context` healing score) |
| `rect` | `{ x, y, width, height }` |
| `callbackNames` | Bound callback names (used for `codeBinding` healing score) |
| `description` | Human-readable text used for `text` healing score |

Captured widget types include `TextField`, `TextFormField`, `EditableText`, `ElevatedButton`, `TextButton`, `OutlinedButton`, `IconButton`, `FloatingActionButton`, `Checkbox`, `Switch`, `Slider`, `DropdownButton`, plus common containers (for context).

## Related

- **TS counterpart:** [`SelfHealingEngine.tryHeal`](../core/SelfHealingEngine.md), [`FailureCollector`](../core/FailureCollector.md)
- **Source:** `packages/fliwright-bridge/lib/src/extensions/snapshot.dart`
