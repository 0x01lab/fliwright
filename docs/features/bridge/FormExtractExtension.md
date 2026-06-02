---
module: "FormExtractExtension"
package: "fliwright_bridge"
source: "lib/src/extensions/form_extract.dart"
generated: "2026-06-02"
---

# FormExtractExtension

> Walk the widget tree and return one `FormFieldMeta` per `TextField` / `TextFormField` / `EditableText`, deduplicated by controller identity.

## Registered Methods

| Method | Description |
|--------|-------------|
| `ext.fliwright.extractForm` | Return form fields |

### `ext.fliwright.extractForm`

No params.

**Returns:** `{ fields: FormFieldMeta[] }`:

| Field | Description |
|-------|-------------|
| `id` | Stable hash-based id (controller identity + initial rect) |
| `type` | Widget runtime type |
| `rect` | Render bounds |
| `key`, `ancestorKey`, `name` | Identifiers |
| `hintText`, `label`, `keyboardType`, `maxLength` | Input hints |
| `obscureText`, `enabled` | State |
| `semanticsId`, `semanticsLabel`, `semanticsHint` | Semantics info |
| `role` | Mapped ARIA-style role |
| `selector` | Pre-resolved wire selector (same logic as `SelectorResolver`) |

## Deduplication

Two fields with the same `TextEditController` instance are collapsed into a single entry to avoid emitting duplicates when the same controller is wired to multiple `TextField`s.

## Related

- **TS counterpart:** [`FormHelper`](../core/FormHelper.md)
- **Pipeline:** [form-filling-pipeline.md](../form-filling-pipeline.md)
- **Source:** `packages/fliwright-bridge/lib/src/extensions/form_extract.dart`
