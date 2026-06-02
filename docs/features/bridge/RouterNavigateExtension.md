---
module: "RouterNavigateExtension"
package: "fliwright_bridge"
source: "lib/src/extensions/router_navigate.dart"
generated: "2026-06-02"
---

# RouterNavigateExtension

> Programmatic navigation via the host app's router (typically GoRouter).

## Registered Methods

| Method | Description |
|--------|-------------|
| `ext.fliwright.navigate` | Navigate to a route |
| `ext.fliwright.currentRoute` | Return the current route path |
| `ext.fliwright.goBack` | Pop the current route |

## Setup

The host app passes a router instance to `FliwrightBridge.init(router: myRouter)`. The extension invokes `router.go(path)`, `router.routerDelegate.currentConfiguration.uri.path`, etc. via `dynamic` dispatch — no hard dependency on `go_router`.

## Method Details

### `ext.fliwright.navigate`

| Param | Type | Description |
|-------|------|-------------|
| `path` | string | Route path |
| `extra` | string (JSON) | Optional extra data forwarded to the router |

Returns `{ success: true }` or `{ success: false, error }`.

### `ext.fliwright.currentRoute`

No params. Returns `{ path: string }`.

### `ext.fliwright.goBack`

No params. Returns `{ success: true }` or `{ success: false, error }`.

## Related

- **TS counterpart:** [`Page.navigate/currentRoute/goBack`](../core/Page.md)
- **Source:** `packages/fliwright-bridge/lib/src/extensions/router_navigate.dart`
