---
module: "MockServerExtension"
package: "fliwright_bridge"
source: "lib/src/extensions/mock_server.dart"
generated: "2026-06-02"
---

# MockServerExtension

> In-app HTTP mock server that intercepts requests via `dart:io` `HttpOverrides` (HTTP only) and serves canned responses matched by path.

## Registered Methods

| Method | Description |
|--------|-------------|
| `ext.fliwright.mock.addRoute` | Register a route |
| `ext.fliwright.mock.removeRoute` | Remove a route |
| `ext.fliwright.mock.clearRoutes` | Remove all routes |
| `ext.fliwright.mock.listRoutes` | List registered routes |
| `ext.fliwright.mock.setPassthrough` | When enabled, unmatched requests hit the network |
| `ext.fliwright.mock.getCalls` | Return captured calls |
| `ext.fliwright.mock.clearCalls` | Clear captured-call log |
| `ext.fliwright.mock.testRequest` | Synthesize a request against the matcher (for tests) |

## Method Details

### `ext.fliwright.mock.addRoute`

| Param | Type | Description |
|-------|------|-------------|
| `route` | string (JSON) | `{ path, method?, response: { status, headers, body, delay } }` |

### `ext.fliwright.mock.removeRoute`

| Param | Description |
|-------|-------------|
| `path` | Route path to remove |

### `ext.fliwright.mock.setPassthrough`

| Param | Description |
|-------|-------------|
| `enabled` | `'true'` or `'false'` |

### `ext.fliwright.mock.getCalls`

Optional `path` filter. Returns `{ calls: MockCall[] }` with `{ method, path, headers, body, timestamp }`.

### `ext.fliwright.mock.testRequest`

Internal — used by bridge unit tests to verify route matching without spinning up HTTP traffic.

## Static Lifecycle

| Method | Description |
|--------|-------------|
| `startServer()` | Starts the localhost HTTP server on a free port |
| `serverPort` | The port the server bound to (used by `FliwrightHttpOverrides`) |
| `reset()` | Stops the server, clears routes/calls (called by `FliwrightBridge.reset`) |

## Related

- **TS counterpart:** [`MockManager`](../core/MockManager.md)
- **Source:** `packages/fliwright-bridge/lib/src/extensions/mock_server.dart`
