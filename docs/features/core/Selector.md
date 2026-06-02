---
module: "Selector"
package: "@fliwright/core"
source: "src/Selector.ts"
tests: "tests/Selector.test.ts"
generated: "2026-06-02"
---

# Selector

> Normalizes selector inputs into a wire-format string used by the bridge's `ext.fliwright.inspect` and gesture RPCs.

## Overview

`Selector` accepts a flexible input shape (string or object) and validates it eagerly. It then exposes `toWireFormat()` and `toWireParams()` so callers can serialize the selector for the bridge. Ancestor chains are supported via the `ancestor` field.

## Constructor

```typescript
constructor(input: SelectorInput)
```

| Input shape | Wire format |
|-------------|-------------|
| `'text=Login'` (already-formatted string) | `'text=Login'` |
| `{ text: 'Login' }` | `'text=Login'` |
| `{ key: 'emailBtn' }` | `'key=emailBtn'` |
| `{ type: 'ElevatedButton' }` | `'byType=ElevatedButton'` |
| `{ text: 'Login', ancestor: { type: 'Scaffold' } }` | `'text=Login'` + `ancestorSelector: 'byType=Scaffold'` |

**Throws:** `Error` for null/empty inputs, empty text/key/type strings, or objects missing all three fields.

## Public Methods

### `toWireFormat(): string`

Returns the bridge-ready selector string.

### `toWireParams(): Record<string, unknown>`

Returns `{ selector, ancestorSelector? }` for RPC params that expect ancestor chains.

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `ancestor` | `Selector?` | Nested ancestor selector if provided |

## Example

```typescript
new Selector({ text: 'Login' }).toWireFormat();           // 'text=Login'
new Selector({ key: 'btn', ancestor: { type: 'AppBar' } }).toWireParams();
// { selector: 'key=btn', ancestorSelector: 'byType=AppBar' }
```

## Related

- **Used by:** [Locator](./Locator.md), [Page](./Page.md)
- **Source:** `packages/fliwright-core/src/Selector.ts`
