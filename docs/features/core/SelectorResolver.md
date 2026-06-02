---
module: "SelectorResolver"
package: "@fliwright/core"
source: "src/SelectorResolver.ts"
tests: "tests/SelectorResolver.test.ts"
generated: "2026-06-02"
---

# SelectorResolver

> Convert a `WidgetInfo` into the most stable selector for code generation.

## Overview

`resolveSelector` walks a priority list to pick the most stable identifier:

1. **`text`** — non-empty trimmed text → `{ text: '...' }`
2. **`key`** — non-empty trimmed key → `{ key: '...' }`
3. **Role mapping** — see table below → `{ role: '...' }`
4. **`type`** — falls back to `{ type: '...' }` (or `{ type: 'Widget' }` if missing)

Values containing single quotes are escaped with `\\'`.

## Role Map

| Flutter type | ARIA role |
|--------------|-----------|
| ElevatedButton, TextButton, OutlinedButton, IconButton, FloatingActionButton | `button` |
| TextField, TextFormField, CupertinoTextField | `textbox` |
| Checkbox, CheckboxListTile | `checkbox` |
| Switch, SwitchListTile | `switch` |
| Slider | `slider` |
| DropdownButton, DropdownButtonFormField | `combobox` |
| NavigationRail, BottomNavigationBar | `navigation` |
| TabBar | `tablist` |

## Public API

### `resolveSelector(widget): string` — free function.

### `class SelectorResolver { resolve(widget): string }` — wraps the function.

## Example

```typescript
import { resolveSelector } from '@fliwright/core';

resolveSelector({ text: 'Login' });          // "{ text: 'Login' }"
resolveSelector({ key: 'email' });           // "{ key: 'email' }"
resolveSelector({ type: 'TextField' });      // "{ role: 'textbox' }"
resolveSelector({ type: 'Scaffold' });       // "{ type: 'Scaffold' }"
```

## Related

- **Used by:** [RecorderController](./RecorderController.md)
- **Source:** `packages/fliwright-core/src/SelectorResolver.ts`
