---
module: "ScrollExtension"
package: "fliwright_bridge"
source: "lib/src/extensions/scroll_extension.dart"
generated: "2026-06-02"
---

# ScrollExtension

> Bring a widget into the visible viewport via `Scrollable.ensureVisible`.

## Registered Methods

| Method | Description |
|--------|-------------|
| `ext.fliwright.scrollIntoView` | Scroll until the widget is visible |

### `ext.fliwright.scrollIntoView`

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `selector` | string | Yes | — | Wire-format selector |
| `alignment` | number | No | `0.5` | 0=top, 1=bottom, 0.5=center |
| `duration` | number | No | `300` | Animation duration in ms |

**Returns:** `{ success: true }` on success. `{ success: false, error }` if the widget isn't in any scrollable.

Implementation calls `Scrollable.ensureVisible(...)` with `alignmentPolicy: explicit` and a `Duration(milliseconds: duration)`.

## Related

- **TS counterpart:** [`Locator.scrollIntoView`](../core/Locator.md)
- **Source:** `packages/fliwright-bridge/lib/src/extensions/scroll_extension.dart`
