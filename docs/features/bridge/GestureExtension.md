---
module: "GestureExtension"
package: "fliwright_bridge"
source: "lib/src/extensions/gesture.dart"
generated: "2026-06-02"
---

# GestureExtension

> Programmatic click and complex gesture synthesis (long-press, drag, pinch).

## Registered Methods

| Method | Description |
|--------|-------------|
| `ext.fliwright.click` | Tap at `(x, y)` (screen center) |
| `ext.fliwright.gesture` | Synthesize a gesture (longPress / drag / pinch) |

## Methods

### `ext.fliwright.click`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `x` | number | Yes | Screen x |
| `y` | number | Yes | Screen y |

**Returns:** `{ success: true }` on success.

### `ext.fliwright.gesture`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `gesture` | `'longPress' \| 'drag' \| 'pinch'` | Yes | Gesture type |
| `selector` | string | Yes | Wire-format selector (target widget) |
| `duration` | number | No | Long-press duration in µs |
| `deltaX`, `deltaY` | number | For drag | Displacement |
| `scale` | number | For pinch | Scale factor |
| `steps` | number | No | Interpolated pointer-move steps |

**Coordinate system:** logical (Flutter-independent) pixels relative to the screen top-left. Coordinates from `WidgetInfo.rect` are in the same system.

## Related

- **TS counterpart:** [`Locator`](../core/Locator.md) `click/longPress/drag/pinch`
- **Source:** `packages/fliwright-bridge/lib/src/extensions/gesture.dart`
