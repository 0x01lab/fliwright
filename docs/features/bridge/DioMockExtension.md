---
module: "DioMockExtension"
package: "fliwright_bridge"
source: "lib/src/extensions/dio_mock_extension.dart"
generated: "2026-06-02"
---

# DioMockExtension

> Mock route management for apps that use `dio` with HTTPS — exposes the same RPCs as `MockServerExtension` but applies them via `FliwrightDioMockInterceptor` instead of `HttpOverrides`.

## Registered Methods

Same as [`MockServerExtension`](./MockServerExtension.md) minus `testRequest`:

- `ext.fliwright.mock.addRoute`
- `ext.fliwright.mock.removeRoute`
- `ext.fliwright.mock.clearRoutes`
- `ext.fliwright.mock.listRoutes`
- `ext.fliwright.mock.setPassthrough`
- `ext.fliwright.mock.getCalls`
- `ext.fliwright.mock.clearCalls`

## Setup

The host app:

1. Adds a `FliwrightDioMockInterceptor` to its Dio instance.
2. Calls `DioMockExtension.setInterceptor(interceptor)` so the RPC handlers can talk to the live interceptor.
3. Calls `FliwrightBridge.initForDio()` (not `init()`) — this skips `HttpOverrides` installation.

## Route Matching

Same path-pattern rules as `MockServerExtension`. The interceptor resolves each Dio `RequestOptions` against the in-memory route map; on a hit it returns a `DioResponse` with the canned status/headers/body/delay. On a miss with `passthrough: false` it returns a 404; with `passthrough: true` it forwards to the network.

## Related

- **Interceptor:** [`FliwrightDioMockInterceptor`](./DioMockInterceptor.md)
- **Source:** `packages/fliwright-bridge/lib/src/extensions/dio_mock_extension.dart`
