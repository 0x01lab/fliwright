---
module: "GestureExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/gesture.dart"
generated: "2026-06-02"
---

# GestureExtension

> Click and gesture simulation using Flutter's GestureBinding.

## Overview

Registers `ext.fliwright.click` and `ext.fliwright.gesture` extensions. Simulates touch events at specific coordinates using `PointerDownEvent`/`PointerUpEvent` via `GestureBinding.instance.handlePointerEvent`.

## Registered Extensions

### `ext.fliwright.click`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `x` | `double` | Yes | X coordinate |
| `y` | `double` | Yes | Y coordinate |

Sends a touch down + touch up at the given coordinates with 100ms duration.

### `ext.fliwright.gesture`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `gesture` | `string` | Yes | `longPress`, `drag`, or `pinch` |
| `selector` | `string` | For longPress | Widget selector |
| `duration` | `int` | No | Long press duration (ms) |
| `deltaX` | `double` | For drag | Horizontal delta |
| `deltaY` | `double` | For drag | Vertical delta |
| `scale` | `double` | For pinch | Scale factor |
| `steps` | `int` | No | Number of interpolation steps |

## Gesture Details

- **longPress**: Finds widget by selector, sends down event, waits for duration (default 500ms), sends up event
- **drag**: Finds widget center, interpolates pointer positions from start to start+delta over `steps` frames
- **pinch**: Creates two pointers, interpolates from center to spread/contract over `steps` frames

## Coordinate System

Coordinates are in Flutter logical pixels relative to the top-left of the view. Pointer IDs start at 10000 to avoid collision with real touch events.
