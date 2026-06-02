---
module: "FliwrightHttpOverrides"
package: "fliwright_bridge"
source: "lib/src/extensions/http_overrides.dart"
generated: "2026-06-02"
---

# FliwrightHttpOverrides

> Install a global `dart:io` `HttpOverrides` that redirects all `HttpClient` traffic through the in-app `MockServerExtension`.

## Overview

`FliwrightHttpOverrides.install({ port })` swaps Dart's global `HttpOverrides` for an instance whose `createHttpClient` returns an `HttpClient` wired to the mock server bound at `localhost:<port>`. This catches HTTP traffic from packages that use `dart:io` directly (e.g. `http` package, some Firebase SDKs). It does **not** intercept HTTPS — apps using HTTPS should use the [`DioMockExtension`](./DioMockExtension.md) path instead.

## Static Methods

| Method | Description |
|--------|-------------|
| `install({ port })` | Replace global `HttpOverrides` |
| `uninstall()` | Restore previous `HttpOverrides` (called by `FliwrightBridge.reset`) |

## Behavior

- All `HttpClient` requests are sent to `localhost:<port>` with the same path/method/headers/body.
- The mock server's response (status, headers, body, delay) is mapped back to the client.
- Unmatched paths return 404 unless `passthrough` is enabled (in which case the original URL is fetched).

## Related

- **Used by:** `FliwrightBridge.init`
- **Source:** `packages/fliwright-bridge/lib/src/extensions/http_overrides.dart`
