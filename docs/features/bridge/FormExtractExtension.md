---
module: "FormExtractExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/form_extract.dart"
generated: "2026-06-01"
---

# FormExtractExtension

> Extracts form field metadata (TextField, TextFormField, EditableText) from the Flutter widget tree.

## Registered Extension

### `ext.fliwright.extractForm`

**Parameters:** None

**Returns:** `{ fields: List<Map>, count: int }`

## Field Metadata

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier |
| `type` | `string` | Widget type |
| `rect` | `{ x, y, width, height }?` | Bounding rectangle |
| `hintText` | `string?` | Hint/placeholder text |
| `label` | `string?` | Label text |
| `keyboardType` | `string?` | Flutter keyboard type name |
| `maxLength` | `int?` | Max character length |
| `obscureText` | `boolean` | Whether obscured |
| `enabled` | `boolean` | Whether enabled |
| `selector` | `string` | Resolved selector string |

## Deduplication

Duplicate `EditableText` widgets (e.g., those wrapped by both `TextField` and `TextFormField`) are deduplicated using a seen-set based on element identity.
