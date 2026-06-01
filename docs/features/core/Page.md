---
module: "Page"
package: "@fliwright/core"
source: "src/Page.ts"
generated: "2026-06-01"
---

# Page

> Page object model that provides locator creation, widget waiting, and form helper access.

## Overview

`Page` represents the current Flutter application screen. It creates `Locator` instances for finding widgets and provides a `waitFor` method for polling until a widget appears. It also exposes a lazy-initialized `FormHelper` for form auto-filling.

## Constructor

```typescript
constructor(sendRequest: SendRequest)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sendRequest` | `SendRequest` | Yes | JSON-RPC request sender function |

## Public Methods

### `locator(selector: SelectorInput): Locator`

Creates a locator for the given selector. Does not perform any DOM lookup until an action is called.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `selector` | `SelectorInput` | Yes | Widget selector (text, key, type, or string) |

**Returns:** `Locator`

### `waitFor(selector: SelectorInput, timeoutMs?: number): Promise<Locator>`

Polls until a widget matching the selector is visible, then returns a locator for it.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `selector` | `SelectorInput` | Yes | Widget selector |
| `timeoutMs` | `number` | No | Default: `5000`. Timeout in milliseconds |

**Returns:** `Promise<Locator>`

**Throws:** Error if widget not found within timeout.

## Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `formHelper` | `FormHelper` | Yes | Lazy-initialized FormHelper instance |

## Related

- **Depends on:** [Locator](./Locator.md), [FormHelper](./FormHelper.md)
- **Used by:** [FliwrightDriver](./FliwrightDriver.md)
- **Source:** `src/Page.ts`
