---
module: "Selector"
package: "@fliwright/core"
source: "src/Selector.ts"
generated: "2026-06-01"
---

# Selector

> Parses and serializes widget selectors into wire format for the Flutter bridge.

## Overview

`Selector` normalizes various selector input formats (plain text, object with text/key/type, nested with ancestor) into a consistent wire format string (`text=...`, `key=...`, `byType=...`). It validates input at construction time and supports recursive ancestor chains.

## Constructor

```typescript
constructor(input: SelectorInput)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | `SelectorInput` | Yes | String, `{ text, ancestor? }`, `{ key, ancestor? }`, or `{ type, ancestor? }` |

## Public Methods

### `toWireFormat(): string`

Converts selector to wire format string: `"text=..."`, `"key=..."`, `"byType=..."`, or the raw string.

**Returns:** `string`

### `toWireParams(): Record<string, unknown>`

Returns parameters object for JSON-RPC calls: `{ selector, ancestorSelector? }`.

**Returns:** `Record<string, unknown>`

## Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `ancestor` | `Selector \| undefined` | Yes | Parent selector if specified |

## Selector Formats

| Input | Wire Format | Description |
|-------|-------------|-------------|
| `'Login'` | `'text=Login'` | Text match |
| `{ text: 'Login' }` | `'text=Login'` | Explicit text |
| `{ key: 'submitBtn' }` | `'key=submitBtn'` | Value key match |
| `{ type: 'ElevatedButton' }` | `'byType=ElevatedButton'` | Widget type match |
| `{ text: 'Email', ancestor: { type: 'Form' } }` | `'text=Email'` with ancestor | Scoped search |

## Related

- **Used by:** [Locator](./Locator.md), [Page](./Page.md)
- **Source:** `src/Selector.ts`
