---
module: "FormExtractExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/form_extract.dart"
generated: "2026-06-02"
---

# FormExtractExtension

> Extracts TextField, TextFormField, and EditableText form fields with deduplication.

## Overview

Registers `ext.fliwright.extractForm` extension. Walks the widget tree to find all form field widgets, extracts their metadata (type, key, hint text, label, keyboard type, obscure flag, enabled state, current value, options), and deduplicates overlapping fields.

## Registered Extensions

### `ext.fliwright.extractForm`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scope` | `string` | No | Optional scope selector to limit extraction area |

Returns `{ fields: FormFieldMeta[], count: number }` where each field contains:
- `id`: Unique field identifier
- `type`: Widget type (TextField, TextFormField, etc.)
- `controlType`: `textInput`, `select`, `radio`, `checkbox`
- `rect`: Render bounds
- `key`, `ancestorKey`: Flutter Keys
- `name`: Field name attribute
- `hintText`, `label`: Display labels
- `keyboardType`: Keyboard type hint
- `obscureText`, `enabled`: State flags
- `value`: Current field value
- `options`: Selectable options (for dropdowns, radios)
- `selector`: Wire-format selector string
- `semanticsId`, `semanticsLabel`, `semanticsHint`, `role`: Semantics data

## Deduplication

Removes duplicate fields that share the same semantic position or controller, ensuring one entry per logical form field.
