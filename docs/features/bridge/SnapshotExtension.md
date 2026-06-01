---
module: "SnapshotExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/snapshot.dart"
generated: "2026-06-01"
---

# SnapshotExtension

> Captures interactive widget metadata from the Flutter widget tree.

## Registered Extension

### `ext.fliwright.snapshot`

**Parameters:** None

**Returns:** `{ widgets: List<Map>, count: int }`

## Interactive Widget Types

Captures widgets of these types:

`ElevatedButton`, `TextButton`, `OutlinedButton`, `IconButton`, `FloatingActionButton`, `TextField`, `TextFormField`, `Checkbox`, `Switch`, `Radio`, `Slider`, `DropdownButton`, `PopupMenuButton`, `ListTile`, `InkWell`, `GestureDetector`, `DropdownButtonFormField`

## Widget Metadata

Each widget includes: `id`, `type`, `text`, `key`, `rect`, `parentType`, `parentText`, `adjacentText`, `callbackNames`, `properties`, `description`
