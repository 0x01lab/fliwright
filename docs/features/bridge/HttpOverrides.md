---
module: "FliwrightHttpOverrides"
package: "fliwright-bridge"
source: "lib/src/extensions/http_overrides.dart"
generated: "2026-06-01"
---

# FliwrightHttpOverrides

> HTTP proxy that redirects Flutter's HTTP requests to the mock server.

## Overview

`FliwrightHttpOverrides` installs a global `HttpOverrides` that redirects all HTTP requests through the mock server's port. This enables transparent API mocking without modifying application code.

## Static Methods

### `install(port: int): void`

Installs the HTTP overrides, redirecting all traffic to `localhost:<port>`.

### `uninstall(): void`

Restores the previous HTTP overrides.

## Implementation

- Overrides `createHttpClient` and `findProxyFromEnvironment`
- Sets proxy to `PROXY localhost:<mockPort>`
- Stores and restores the previous `HttpOverrides` on uninstall
