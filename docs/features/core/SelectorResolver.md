---
module: "SelectorResolver"
package: "@fliwright/core"
source: "src/SelectorResolver.ts"
generated: "2026-06-01"
---

# SelectorResolver & resolveSelector

> Resolves widget info to selector strings with ARIA-like role mapping.

## Overview

`SelectorResolver` converts partial `WidgetInfo` objects into selector strings. It maps Flutter widget types to ARIA-like roles using a built-in mapping table, falling back to raw type names.

## resolveSelector (function)

```typescript
function resolveSelector(widget: Partial<WidgetInfo>): string
```

Resolution order: `text` -> `key` -> `type` (with role mapping) -> fallback `'Widget'`.

## SelectorResolver (class)

### Constructor

```typescript
constructor()
```

### Public Methods

### `resolve(widget: Partial<WidgetInfo>): string`

Same logic as the standalone function.

## Role Map

Maps 22 Flutter widget types to ARIA-like roles:

| Flutter Widget | Role |
|----------------|------|
| `ElevatedButton` | `button` |
| `TextButton` | `button` |
| `OutlinedButton` | `button` |
| `IconButton` | `button` |
| `FloatingActionButton` | `button` |
| `TextField` | `textbox` |
| `TextFormField` | `textbox` |
| `Checkbox` | `checkbox` |
| `Switch` | `switch` |
| `Radio` | `radio` |
| `Slider` | `slider` |
| `DropdownButton` | `combobox` |
| `PopupMenuButton` | `combobox` |
| `ListTile` | `listitem` |
| `InkWell` | `link` |
| `GestureDetector` | `generic` |
| `AppBar` | `banner` |
| `BottomNavigationBar` | `navigation` |
| `TabBar` | `tablist` |
| `Tab` | `tab` |
| `Drawer` | `navigation` |
| `Dialog` | `dialog` |

## Related

- **Used by:** Recording pipeline, healing pipeline
- **Source:** `src/SelectorResolver.ts`
