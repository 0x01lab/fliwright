---
package: "fliwright_bridge"
version: "0.1.0"
layer: integration
status: implemented
generated: "2026-06-02"
---

# fliwright_bridge

> Dart package installed inside a Flutter app to register VM Service extensions that the TypeScript SDK calls over the VM Service WebSocket.

## Architecture

`FliwrightBridge.init()` (in `lib/src/bridge.dart`) is called once from the app's `main()`. It instantiates a singleton `ExtensionRegistry` and registers each extension in turn. The registry calls Dart's `registerExtension` so the VM Service can route `ext.fliwright.*` calls to the right handler. The `MockServerExtension` also starts a local HTTP server and `FliwrightHttpOverrides` redirects `dart:io` HTTP traffic through it.

For apps that use `dio` with HTTPS, an alternative entry point `initForDio()` registers all extensions except `HttpOverrides`, and instead exposes the `DioMockExtension` so the app can plug a `FliwrightDioMockInterceptor` into its Dio instance.

## Extensions

| Extension | RPC Methods | Doc |
|-----------|-------------|-----|
| `GestureExtension` | `ext.fliwright.click`, `ext.fliwright.gesture` | [GestureExtension.md](./GestureExtension.md) |
| `InspectExtension` | `ext.fliwright.inspect` | [InspectExtension.md](./InspectExtension.md) |
| `TypeExtension` | `ext.fliwright.type` | [TypeExtension.md](./TypeExtension.md) |
| `ScrollExtension` | `ext.fliwright.scrollIntoView` | [ScrollExtension.md](./ScrollExtension.md) |
| `SnapshotExtension` | `ext.fliwright.snapshot` | [SnapshotExtension.md](./SnapshotExtension.md) |
| `ScreenshotExtension` | `ext.fliwright.screenshot` | [ScreenshotExtension.md](./ScreenshotExtension.md) |
| `RecordingExtension` | `ext.fliwright.startRecording`, `stopRecording`, `hitTest` | [RecordingExtension.md](./RecordingExtension.md) |
| `FormExtractExtension` | `ext.fliwright.extractForm` | [FormExtractExtension.md](./FormExtractExtension.md) |
| `RiverpodExtension` | `ext.fliwright.riverpod.{list,read,override,watch,unwatch}` | [RiverpodExtension.md](./RiverpodExtension.md) |
| `RouterNavigateExtension` | `ext.fliwright.navigate`, `currentRoute`, `goBack` | [RouterNavigateExtension.md](./RouterNavigateExtension.md) |
| `MockServerExtension` | `ext.fliwright.mock.{addRoute,removeRoute,clearRoutes,listRoutes,setPassthrough,getCalls,clearCalls,testRequest}` | [MockServerExtension.md](./MockServerExtension.md) |
| `DioMockExtension` | Same as `MockServerExtension` minus `testRequest` (HTTPS-only) | [DioMockExtension.md](./DioMockExtension.md) |
| `FliwrightHttpOverrides` | (HTTP interceptor, not an RPC) | [HttpOverrides.md](./HttpOverrides.md) |

## Dependencies

- `flutter` (sdk)
- `dio` ^5.0.0
- `test` ^1.25.0 (dev)

## Usage Example

Standard (HttpOverrides-based mock server, HTTP only):

```dart
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  runApp(const MyApp());
}

// In your test entry point:
Future<void> main() async {
  await FliwrightBridge.init();
  runApp(const MyApp());
}
```

With a router (enables `page.navigate('/path')`):

```dart
final router = GoRouter(routes: [...]);
await FliwrightBridge.init(router: router);
runApp(MaterialApp.router(routerConfig: router));
```

For Dio + HTTPS apps:

```dart
final dio = Dio();
final interceptor = FliwrightDioMockInterceptor();
dio.interceptors.add(interceptor);
await FliwrightBridge.initForDio();
DioMockExtension.setInterceptor(interceptor);
```
