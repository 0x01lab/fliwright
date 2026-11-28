# fliwright_bridge

Flutter VM Service bridge for Fliwright automation.

`fliwright_bridge` registers debug VM Service extensions that let Fliwright
inspect widgets, run gestures, capture screenshots, record interactions, wait
for app stability, and apply local network mock rules while a Flutter app is
running in debug or test mode.

## Usage

Initialize the bridge from a debug or test entrypoint before `runApp`:

```dart
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:flutter/material.dart';

void main() {
  FliwrightBridge.init();
  runApp(const MyApp());
}
```

Then connect with the Fliwright VS Code extension, CLI, MCP server, or
TypeScript runtime using the Flutter VM Service URL.

## Capture Dio responses

In your debug or test entrypoint, initialize with `FliwrightBridge.initForDioMock()`.
Install one registered `FliwrightDioMockInterceptor` on every Dio instance whose
calls the test needs to observe. Add the interceptor to the clients the app
already uses. Here `api` and `uploadApi` are examples of app-owned clients.

```dart
final interceptor = FliwrightDioMockInterceptor();
api.interceptors.add(interceptor);
uploadApi.interceptors.add(interceptor);
DioMockExtension.setInterceptor(interceptor);
await FliwrightBridge.initForDioMock();
```

The bridge records Mock and passthrough responses through Dio's interceptor
chain, including HTTP errors. Requests using HTTPS or a custom Adapter are
covered when they pass through the instrumented client. The `HttpOverrides`
path installed by `FliwrightBridge.init()` provides plain HTTP Mock coverage
for `HttpClient`.

Rebuild and restart the debug app after changing its bootstrap. After the app
makes a request, `driver.mock.getFlutterCalls(path)` can verify that the bridge
recorded it. Use `assert.response` from the Vitest `assert` fixture to match the
status code and response fields in a test. [Vitest response assertions](../fliwright-vitest/README.md#assert-an-http-response)

## What It Exposes

- Widget inspection and selector queries.
- Tap, type, scroll, settle automation, and soft-keyboard dismissal.
- Screenshots and frame capture.
- Interaction recording.
- Runtime network mock support for Dio and HTTP overrides.
- Riverpod state extension primitives used by `fliwright_bridge_riverpod`.

Only enable the bridge in trusted debug or test builds. Calls to initialize it
are inert in release mode, but applications should still guard the test
entrypoint so tree shaking can remove it. It is designed for local automation
and E2E testing, not production runtime control.
