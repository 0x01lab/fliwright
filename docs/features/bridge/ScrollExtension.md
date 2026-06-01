---
module: "ScrollExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/scroll_extension.dart"
generated: "2026-06-01"
---

# ScrollExtension

> Scrolls a widget into view using Flutter's `Scrollable.ensureVisible`.

## Registered Extension

### `ext.fliwright.scrollIntoView`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `selector` | `string` | Yes | Widget selector |
| `alignment` | `double` | No | 0=top, 0.5=center, 1=bottom (default: 0.5) |
| `duration` | `int` | No | Animation duration in ms (default: 300) |

**Returns:** `{ success: true, scrolled: true, offset?: double }`
