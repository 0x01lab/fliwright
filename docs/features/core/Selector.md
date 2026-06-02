---
module: "Selector"
package: "@fliwright/core"
source: "src/Selector.ts"
generated: "2026-06-02"
---

# Selector

> Parses selector input into wire-format strings for the Flutter bridge.

## Overview

`Selector` accepts string selectors or structured objects (`{ text, key, type }`) with optional `ancestor` chains. It converts these to wire format like `text=Submit`, `key=loginBtn`, `byType=ElevatedButton`.

## Constructor

```typescript
constructor(input: SelectorInput)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | `string \| { text: string; ancestor?: SelectorInput } \| { key: string; ancestor?: SelectorInput } \| { type: string; ancestor?: SelectorInput }` | Yes | Selector specification |

## Public Methods

### `toWireFormat(): string`

Returns the wire-format selector string (e.g. `text=Submit`, `key=loginBtn`, `byType=ElevatedButton`).

### `toWireParams(): Record<string, unknown>`

Returns `{ selector, ancestorSelector? }` object for RPC calls.

## Selector Formats

| Format | Example | Description |
|--------|---------|-------------|
| `text=Submit` | `{ text: 'Submit' }` | Match by visible text |
| `key=loginBtn` | `{ key: 'loginBtn' }` | Match by Flutter Key |
| `byType=ElevatedButton` | `{ type: 'ElevatedButton' }` | Match by widget type |
| Plain string | `'text=Submit'` | Passed through as-is |

## Related

- **Used by:** [Locator](./Locator.md)
- **Source:** `src/Selector.ts`
