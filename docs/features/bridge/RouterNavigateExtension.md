---
module: "RouterNavigateExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/router_navigate.dart"
generated: "2026-06-02"
---

# RouterNavigateExtension

> Programmatic navigation via an injected router (e.g. GoRouter).

## Overview

Registers `ext.fliwright.navigate`, `ext.fliwright.currentRoute`, and `ext.fliwright.goBack`. Requires a router to be injected via `FliwrightBridge.init(router: myRouter)`.

## Registered Extensions

### `ext.fliwright.navigate`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | `string` | Yes | Route path to navigate to |
| `extra` | `string` | No | JSON-encoded extra data |

Calls `router.go(path)` via dynamic dispatch. Returns `{ success: true }` or `{ success: false, error }`.

### `ext.fliwright.currentRoute`

Returns `{ path: string }` — the current route path.

### `ext.fliwright.goBack`

Pops the current route. Returns `{ success: true }` or `{ success: false, error }`.
