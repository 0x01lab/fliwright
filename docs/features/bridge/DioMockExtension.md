---
module: "DioMockExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/dio_mock_extension.dart"
generated: "2026-06-02"
---

# DioMockExtension

> Dio-compatible mock management via VM Service extensions (no HTTP server required).

## Overview

For apps using Dio with HTTPS APIs, `HttpOverrides` cannot intercept requests. Instead, `DioMockExtension` registers VM Service extensions for managing mock routes, and the app uses `FliwrightDioMockInterceptor` in its Dio instance to check routes against the registered mocks.

## Registered Extensions

### `ext.fliwright.mock.setController`

Sets the tool-side mock controller URL.

### Route Management Extensions

- `ext.fliwright.mock.addRoute`: Add a mock route
- `ext.fliwright.mock.removeRoute`: Remove a mock route
- `ext.fliwright.mock.clearRoutes`: Clear all routes
- `ext.fliwright.mock.setPassthrough`: Toggle passthrough mode
- `ext.fliwright.mock.getCalls`: Get recorded calls
- `ext.fliwright.mock.clearCalls`: Clear recorded calls

## FliwrightDioMockInterceptor

A Dio interceptor that checks each request against registered mock routes. The host app must:
1. Create a `FliwrightDioMockInterceptor` instance
2. Insert it into the Dio interceptor chain
3. Call `DioMockExtension.setInterceptor(interceptor)` to wire it up

## Static Methods

- `register(registry)`: Registers all mock extensions
- `setInterceptor(interceptor)`: Sets the Dio interceptor
- `reset()`: Resets all state
