---
module: "TypeExtension"
package: "fliwright_bridge"
source: "lib/src/extensions/type_extension.dart"
generated: "2026-06-02"
---

# TypeExtension

> Simulate text entry into a Flutter `EditableText` field.

## Registered Methods

| Method | Description |
|--------|-------------|
| `ext.fliwright.type` | Insert / replace text |

### `ext.fliwright.type`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `selector` | string | Yes | Wire-format selector for the field |
| `text` | string | Yes | Text to enter |
| `charDelay` | number (string) | No | Delay between characters in ms |
| `replaceAll` | `'true' \| 'false'` | No | If `'true'`, clears existing text first |

**Returns:** `{ success: true }` on success. `{ success: false, error }` if the field can't be found or isn't editable.

Internally: resolves the selector via `ext.fliwright.inspect`, focuses the field, then either clears + types (replace) or appends one character at a time (with optional `charDelay`).

## Related

- **TS counterpart:** [`Locator.type/fill`](../core/Locator.md)
- **Source:** `packages/fliwright-bridge/lib/src/extensions/type_extension.dart`
