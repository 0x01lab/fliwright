---
module: "SnapshotExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/snapshot.dart"
generated: "2026-06-02"
---

# SnapshotExtension

> Captures interactive widget types with metadata for self-healing reference.

## Overview

Registers `ext.fliwright.snapshot` extension. Walks the widget tree and collects `WidgetSnapshot` objects for interactive widgets (buttons, text fields, checkboxes, etc.). Each snapshot includes type, text, key, parent type, adjacent text, render bounds, callback names, and semantics description.

## Registered Extensions

### `ext.fliwright.snapshot`

No parameters required.

Returns `{ widgets: WidgetSnapshot[] }` where each snapshot contains:
- `type`: Widget runtime type
- `text`: Visible text
- `key`: Flutter Key
- `parentType`: Parent widget type
- `adjacentText`: Array of adjacent sibling text values
- `rect`: `{ x, y, width, height }` render bounds
- `callbackNames`: Array of callback handler names (e.g., `onPressed`)
- `description`: Semantics description
- `firstSeen`: ISO timestamp

## Captured Widget Types

Interactive widget types: ElevatedButton, TextButton, OutlinedButton, IconButton, FloatingActionButton, TextField, TextFormField, Checkbox, Switch, DropdownButton, Slider, BottomNavigationBar, NavigationRail, TabBar.
