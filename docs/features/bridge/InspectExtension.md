---
module: "InspectExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/inspect.dart"
generated: "2026-06-01"
---

# InspectExtension

> Selector-based widget tree traversal and lookup.

## Registered Extension

### `ext.fliwright.inspect`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `selector` | `string` | Yes | Selector: `text=...`, `key=...`, `byType=...`, or bare text |
| `ancestorSelector` | `string` | No | Ancestor scope selector |

**Returns:** `{ widgets: List<Map>, count: int }`

## Selector Syntax

| Format | Example | Description |
|--------|---------|-------------|
| `text=Login` | Text match | Finds widgets with matching text |
| `key=submitBtn` | Key match | Finds widgets with ValueKey |
| `byType=ElevatedButton` | Type match | Finds widgets by runtime type |
| `Login` (bare) | Defaults to `text=Login` | Shorthand text match |

## Widget Info Fields

Each returned widget contains: `id`, `type`, `text`, `key`, `rect`, `properties`.
