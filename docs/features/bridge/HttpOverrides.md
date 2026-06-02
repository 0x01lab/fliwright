---
module: "HttpOverrides"
package: "fliwright-bridge"
source: "lib/src/extensions/http_overrides.dart"
generated: "2026-06-02"
---

# FliwrightHttpOverrides

> HTTP interception mechanism using Dart's `HttpOverrides.global` for redirecting HTTP traffic to the mock server.

## Overview

Installs a global `HttpOverrides` that redirects all `dart:io` HTTP requests to the Flutter-side mock server. When a request is made, it's forwarded to the mock server which returns the configured mock response. Passthrough mode lets unmatched requests proceed to the real server.

## Static Methods

### `install({ required int port })`

Installs the global HttpOverrides pointing to `localhost:port`.

### `uninstall()`

Removes the global HttpOverrides, restoring normal HTTP behavior.

## Behavior

- Only intercepts `http://` requests (not `https://`)
- Passthrough mode forwards unmatched requests to the real server
- For HTTPS/Dio apps, use `DioMockExtension` instead
