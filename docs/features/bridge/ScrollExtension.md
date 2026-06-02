---
module: "ScrollExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/scroll_extension.dart"
generated: "2026-06-02"
---

# ScrollExtension

> Scrollable.ensureVisible with configurable alignment and duration.

## Overview

Registers `ext.fliwright.scrollIntoView` extension. Finds a widget by selector and scrolls it into the visible area using `Scrollable.ensureVisible`.

## Registered Extensions

### `ext.fliwright.scrollIntoView`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `selector` | `string` | Yes | — | Widget selector |
| `alignment` | `double` | No | `0.5` | Target alignment (0.0=top, 0.5=center, 1.0=bottom) |
| `duration` | `int` | No | `300` | Scroll animation duration (ms) |

## Behavior

1. Finds the target element by selector
2. Calls `Scrollable.ensureVisible()` with alignment and duration
3. Waits for the scroll animation to complete
