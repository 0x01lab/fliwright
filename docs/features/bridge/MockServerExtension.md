---
module: "MockServerExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/mock_server.dart"
generated: "2026-06-02"
---

# MockServerExtension

> HTTP mock server running in the Flutter process for intercepting HTTP requests.

## Overview

Starts an `HttpServer` in the Flutter process that receives mock routing decisions from the Node.js tool-side `ToolMockServer`. The Flutter app's HTTP requests are intercepted via `HttpOverrides` and forwarded to this server for mock matching.

## Registered Extensions

### `ext.fliwright.mock.setController`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | `string` | Yes | URL of the tool-side mock controller |

Sets the URL of the Node.js mock controller. The Flutter mock server forwards requests to this controller for matching.

## Server Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mock` | POST | Main mock endpoint — receives HTTP requests and returns mock responses |
| `/routes` | GET | List registered routes |
| `/routes` | POST | Add a route |
| `/routes` | DELETE | Remove route(s) |
| `/calls` | GET | List recorded calls |
| `/calls` | DELETE | Clear recorded calls |
| `/passthrough` | POST | Toggle passthrough mode |
| `/debug` | GET | Debug state dump |

## Route Matching

Routes support exact path matching and wildcard patterns (`/api/*`). Method matching is case-insensitive. Unmatched routes return 404 or passthrough based on configuration.

## Static Methods

- `startServer()`: Starts the HTTP server on a random port
- `reset()`: Resets all state
- `serverPort`: Returns the current server port (nullable)
