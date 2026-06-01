---
module: "MockManager"
package: "@fliwright/core"
source: "src/MockManager.ts"
generated: "2026-06-01"
---

# MockManager

> HTTP mock route management for stubbing API responses in Flutter tests.

## Overview

`MockManager` registers, removes, and queries mock HTTP routes via the Dart bridge's mock server extension. It supports path patterns, method filtering, passthrough mode, and call logging.

## Constructor

```typescript
constructor(sendRequest: SendRequest)
```

## Public Methods

### `route(path: string, response: MockRouteResponse & { method?: string }): Promise<void>`

Registers a mock route.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | `string` | Yes | URL path pattern |
| `response` | `MockRouteResponse & { method?: string }` | Yes | Response config |
| `response.status` | `number` | No | HTTP status (default: 200) |
| `response.headers` | `Record<string, string>` | No | Response headers |
| `response.body` | `unknown` | No | Response body |
| `response.delay` | `number` | No | Response delay in ms |
| `response.method` | `string` | No | HTTP method filter |

### `addRoute(pattern: string, response: MockRouteResponse): Promise<void>`

Alias for `route()`.

### `removeRoute(path: string): Promise<void>`

Removes a mock route by path.

### `clear(): Promise<void>`

Removes all mock routes.

### `setPassthrough(enabled: boolean): Promise<void>`

When enabled, unmatched requests pass through to real servers.

### `getCalls(path?: string): Promise<MockCall[]>`

Returns recorded calls, optionally filtered by path.

### `listRoutes(): Promise<Array<{ id: string; method?: string; path: string }>>`

Lists all registered routes.

### `clearCalls(): Promise<void>`

Clears all recorded calls.

## Related

- **Source:** `src/MockManager.ts`
