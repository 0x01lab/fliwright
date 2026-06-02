---
module: "InspectExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/inspect.dart"
generated: "2026-06-02"
---

# InspectExtension

> Widget tree traversal and selector-based widget lookup.

## Overview

Registers `ext.fliwright.inspect` extension. Walks the widget tree to find widgets matching selector criteria (text, key, type, semanticsId, name, role). Returns `WidgetInfo` objects with id, type, text, key, rect, and properties.

## Registered Extensions

### `ext.fliwright.inspect`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `selector` | `string` | Yes | Selector string (text=, key=, byType=, semanticsId=, name=, role=) |
| `ancestorSelector` | `string` | No | Ancestor constraint |

Returns `{ widgets: WidgetInfo[] }` where each `WidgetInfo` contains:
- `id`: Semantics node ID or generated ID
- `type`: Widget runtime type name
- `text`: Visible text content
- `key`: Flutter Key value
- `rect`: `{ x, y, width, height }` render bounds
- `properties`: Additional widget properties (enabled, obscureText, etc.)

## Selector Syntax

| Selector | Format | Matches |
|----------|--------|---------|
| text= | `text=Submit` | Widgets with matching text |
| key= | `key=loginBtn` | Widgets with matching Key |
| byType= | `byType=ElevatedButton` | Widgets of exact type |
| semanticsId= | `semanticsId=42` | Semantics node by ID |
| name= | `name=emailField` | TextFormField/TextField by name attribute |
| role= | `role=button` | Widgets mapped to semantic roles |
