---
module: "InspectExtension"
package: "fliwright_bridge"
source: "lib/src/extensions/inspect.dart"
generated: "2026-06-02"
---

# InspectExtension

> Locate widgets in the live render tree by selector and return their metadata.

## Registered Methods

| Method | Description |
|--------|-------------|
| `ext.fliwright.inspect` | Resolve a selector into widget metadata |

### `ext.fliwright.inspect`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `selector` | string | Yes | Wire-format selector: `text=...`, `key=...`, `byType=...`, `role=...` |
| `ancestorSelector` | string | No | Wire-format selector for an ancestor scope |

**Returns:** `{ widgets: WidgetInfo[] }` where each entry contains:

| Field | Description |
|-------|-------------|
| `id` | Bridge-assigned id |
| `type` | Runtime type (e.g. `ElevatedButton`) |
| `text`, `key` | Identifiers (if any) |
| `rect` | `{ x, y, width, height }` in screen-logical pixels |
| `properties` | Catch-all property bag (e.g. `enabled`, `obscureText`) |

## Selector Resolution

`ParsedSelector` (in `inspect.dart`) parses the wire string. The extension walks the live element tree (using `WidgetsBinding.instance.rootElement`), filtering by type, key, text, or role (via the same role map as the TS `SelectorResolver`). Ancestor scope is honored by checking each candidate's parents.

## Related

- **TS counterpart:** [`Locator._resolve`](../core/Locator.md)
- **Source:** `packages/fliwright-bridge/lib/src/extensions/inspect.dart`
