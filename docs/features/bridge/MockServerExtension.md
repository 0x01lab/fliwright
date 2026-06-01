---
module: "MockServerExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/mock_server.dart"
generated: "2026-06-01"
---

# MockServerExtension

> In-process HTTP mock server for stubbing API responses during tests.

## Registered Extensions

### `ext.fliwright.mock.addRoute`

| Parameter | Type | Description |
|-----------|------|-------------|
| `route` | `string (JSON)` | Route config: `{ id?, method?, path?, response: { status?, headers?, body?, delay? } }` |

**Returns:** `{ success: bool, id: string }`

### `ext.fliwright.mock.removeRoute`

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string?` | Remove by route ID |
| `path` | `string?` | Remove by path pattern |

**Returns:** `{ removed: bool }`

### `ext.fliwright.mock.clearRoutes`

**Returns:** `{ cleared: int }`

### `ext.fliwright.mock.listRoutes`

**Returns:** `{ routes: [{ id, method, path }] }`

### `ext.fliwright.mock.setPassthrough`

| Parameter | Type | Description |
|-----------|------|-------------|
| `enabled` | `string` | `'true'` to enable passthrough |

**Returns:** `{ passthrough: bool }`

### `ext.fliwright.mock.getCalls`

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string?` | Filter by path |

**Returns:** `{ calls: [{ method, path, headers, body, timestamp }] }`

### `ext.fliwright.mock.clearCalls`

**Returns:** `{ cleared: int }`

### `ext.fliwright.mock.testRequest`

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | Request URL (default: `http://test.local/ping`) |
| `method` | `string` | HTTP method (default: `GET`) |
| `body` | `string?` | Request body (for POST) |

**Returns:** `{ status: int, body: string }`

## Route Matching

- Routes are matched in registration order
- Path patterns support wildcards
- Method filtering is optional
- Passthrough mode forwards unmatched requests to real servers
