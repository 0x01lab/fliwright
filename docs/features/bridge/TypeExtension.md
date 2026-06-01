---
module: "TypeExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/type_extension.dart"
generated: "2026-06-01"
---

# TypeExtension

> Text input simulation for Flutter widgets.

## Registered Extension

### `ext.fliwright.type`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `selector` | `string` | Yes | Widget selector |
| `text` | `string` | Yes | Text to input |
| `replaceAll` | `string` | No | `'true'` to replace all text (default: `'false'`) |
| `charDelay` | `int` | No | Delay between characters in ms (default: 0) |

**Returns:** `{ success: true, currentText: string }`
