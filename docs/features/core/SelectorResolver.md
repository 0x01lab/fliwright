---
module: "SelectorResolver"
package: "@fliwright/core"
source: "src/SelectorResolver.ts"
generated: "2026-06-02"
---

# SelectorResolver

> Resolves WidgetInfo to selector strings with Flutter role mapping.

## Overview

Maps Flutter widget types to semantic roles (e.g., `ElevatedButton` → `button`, `TextField` → `textbox`). Resolution priority: text → key → role → type.

## Public Methods (SelectorResolver class)

### `resolve(widget: Partial<WidgetInfo>): string`

Returns a selector string for the given widget.

## Exported Function

### `resolveSelector(widget: Partial<WidgetInfo>): string`

Standalone function that resolves a widget to a selector. Same logic as the class method.

## Role Map

| Widget Type | Role |
|-------------|------|
| ElevatedButton, TextButton, OutlinedButton, IconButton, FloatingActionButton | button |
| TextField, TextFormField, CupertinoTextField | textbox |
| Checkbox, CheckboxListTile | checkbox |
| Switch, SwitchListTile | switch |
| Slider | slider |
| DropdownButton, DropdownButtonFormField | combobox |
| NavigationRail, BottomNavigationBar | navigation |
| TabBar | tablist |

## Related

- **Used by:** [RecorderController](./RecorderController.md)
- **Source:** `src/SelectorResolver.ts`
