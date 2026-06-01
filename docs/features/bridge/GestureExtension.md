---
module: "GestureExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/gesture.dart"
generated: "2026-06-01"
---

# GestureExtension

> Handles click and gesture (longPress, drag, pinch) interactions on Flutter widgets.

## Registered Extensions

### `ext.fliwright.click`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `x` | `double` | Yes | X coordinate |
| `y` | `double` | Yes | Y coordinate |

**Returns:** `{ success: bool }`

### `ext.fliwright.gesture`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `gesture` | `string` | Yes | One of: `longPress`, `drag`, `pinch` |
| `selector` | `string` | Yes | Widget selector |
| `ancestorSelector` | `string` | No | Ancestor scope selector |
| `duration` | `int` | No | Duration for longPress (default: 500) |
| `deltaX` | `double` | For drag | Horizontal displacement |
| `deltaY` | `double` | For drag | Vertical displacement |
| `steps` | `int` | No | Animation steps (default: 10) |
| `scale` | `double` | No | Scale for pinch (default: 0.5) |

**Returns:** `{ success: bool, gesture: string }`

## Implementation Details

- Uses `GestureBinding` to inject pointer events
- Pointer IDs start at 10000 and increment
- For drag: calculates start/end points from widget center + delta
- For pinch: creates two pointer paths converging/diverging at widget center
