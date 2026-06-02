---
module: "Page"
package: "@fliwright/core"
source: "src/Page.ts"
generated: "2026-06-02"
---

# Page

> Page object model providing locator creation, wait-for-selector, navigation, and form helper access.

## Overview

`Page` represents the current Flutter screen. It creates `Locator` instances for widget interaction and provides `waitFor` for auto-wait polling. Navigation methods (`navigate`, `currentRoute`, `goBack`) require the Flutter app to inject a router via `FliwrightBridge.init(router: myRouter)`.

## Constructor

```typescript
constructor(sendRequest: SendRequest)
```

## Public Methods

### `locator(selector: SelectorInput): Locator`

Creates a Locator for the given selector.

### `waitFor(selector: SelectorInput, timeoutMs?: number): Promise<Locator>`

Polls until at least one widget matches the selector. Default timeout: 5000ms. Throws on timeout.

### `navigate(path: string, options?: { extra?: Record<string, unknown> }): Promise<void>`

Navigates to a route path via the injected router (e.g. GoRouter). Throws if navigation fails.

### `currentRoute(): Promise<string>`

Returns the current route path string.

### `goBack(): Promise<void>`

Pops the current route. Throws if navigation fails.

## Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `formHelper` | `FormHelper` | Yes | Lazily-initialized form auto-fill helper |

## Related

- **Depends on:** [Locator](./Locator.md), [Selector](./Selector.md), [FormHelper](./FormHelper.md)
- **Source:** `src/Page.ts`
