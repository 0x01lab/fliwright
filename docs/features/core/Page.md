---
module: "Page"
package: "@fliwright/core"
source: "src/Page.ts"
tests: "tests/Page.test.ts"
generated: "2026-06-02"
---

# Page

> Page-object entry — produces `Locator` instances, polls for widget availability, navigates router-based apps, and exposes a shared `FormHelper`.

## Overview

`Page` is the high-level surface tests use 99% of the time. It owns the `sendRequest` channel (delegated to locators and to `FormHelper`) and provides navigation helpers that talk to the bridge's `ext.fliwright.navigate` / `ext.fliwright.currentRoute` / `ext.fliwright.goBack` RPCs (requires the Flutter app to register a router via `FliwrightBridge.init(router: ...)`).

## Constructor

```typescript
constructor(sendRequest: SendRequest)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sendRequest` | `(method, params?) => Promise<unknown>` | Yes | Driver RPC channel |

## Public Methods

### `locator(selector): Locator`

Creates a new `Locator` for the given selector.

| Parameter | Type | Description |
|-----------|------|-------------|
| `selector` | `SelectorInput` | String (`"text=Login"`) or object (`{ text: 'Login' }`, `{ key: 'loginBtn' }`, `{ type: 'ElevatedButton' }`, optionally with `ancestor`) |

**Returns:** `Locator`

---

### `waitFor(selector, timeoutMs?): Promise<Locator>`

Polls every 100ms until the selector matches at least one widget or `timeoutMs` (default 5000) elapses.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `selector` | `SelectorInput` | — | Selector to wait for |
| `timeoutMs` | number | `5000` | Timeout in ms |

**Returns:** `Promise<Locator>` — locator for the now-present widget.

**Throws:** `Error('Timeout waiting for selector: ...')` if the widget never appears.

---

### `navigate(path, options?): Promise<void>`

Programmatically navigate to a route. Requires a router registered with the bridge.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | Route path, e.g. `'/register'` |
| `options.extra` | object | Extra data forwarded to the router (JSON-stringified) |

**Throws:** `Error` if the bridge returns `success: false`.

---

### `currentRoute(): Promise<string>`

Returns the current route path, or empty string if unknown.

---

### `goBack(): Promise<void>`

Pops the current route.

**Throws:** `Error` if the bridge returns `success: false`.

## Properties

| Property | Type | Lazy | Description |
|----------|------|------|-------------|
| `formHelper` | `FormHelper` | Yes | Shared `FormHelper` instance |

## Example

```typescript
await driver.page.waitFor({ key: 'home-title' });
await driver.page.locator({ text: 'Login' }).click();

await driver.page.navigate('/profile', { extra: { userId: 42 } });
console.log('now at', await driver.page.currentRoute());
await driver.page.goBack();
```

## Related

- **Depends on:** [Locator](./Locator.md), [Selector](./Selector.md), [FormHelper](./FormHelper.md)
- **Source:** `packages/fliwright-core/src/Page.ts`
