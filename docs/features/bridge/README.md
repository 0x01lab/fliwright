---
package: "fliwright-bridge"
version: "0.1.0"
layer: core
status: implemented
generated: "2026-06-02"
---

# fliwright-bridge

> Dart-side Flutter bridge that registers VM Service extensions for gesture simulation, widget inspection, type input, scrolling, snapshotting, recording, form extraction, Riverpod state management, mock server, navigation, and screenshots.

## Architecture

`FliwrightBridge` is the main entry point. It registers all extensions via `ExtensionRegistry` during `init()`. Two initialization modes:
- **`init()`** — Full mode with `HttpOverrides`-based mock server for HTTP interception
- **`initForDioMock()`** — Dio-compatible mode without HttpOverrides (for HTTPS APIs)

## ExtensionRegistry

Each extension registers one or more `ext.fliwright.*` methods that the Node.js SDK calls via JSON-RPC over the VM Service WebSocket.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| GestureExtension | Click and gesture simulation (tap, longPress, drag, pinch) | [GestureExtension.md](./GestureExtension.md) |
| InspectExtension | Widget tree traversal and selector-based lookup | [InspectExtension.md](./InspectExtension.md) |
| TypeExtension | Text input simulation with char-by-char and replaceAll | [TypeExtension.md](./TypeExtension.md) |
| ScrollExtension | Scrollable.ensureVisible with alignment | [ScrollExtension.md](./ScrollExtension.md) |
| SnapshotExtension | Interactive widget type capture with metadata | [SnapshotExtension.md](./SnapshotExtension.md) |
| RecordingExtension | Pointer event capture and text input polling | [RecordingExtension.md](./RecordingExtension.md) |
| FormExtractExtension | TextField/TextFormField extraction and deduplication | [FormExtractExtension.md](./FormExtractExtension.md) |
| RiverpodExtension | ProviderContainer operations (read, override, watch, list) | [RiverpodExtension.md](./RiverpodExtension.md) |
| MockServerExtension | HTTP mock server with route matching and call logging | [MockServerExtension.md](./MockServerExtension.md) |
| HttpOverrides | HTTP interception mechanism for HttpOverrides mode | [HttpOverrides.md](./HttpOverrides.md) |
| ScreenshotExtension | Screenshot capture via RenderRepaintBoundary | [ScreenshotExtension.md](./ScreenshotExtension.md) |
| RouterNavigateExtension | Programmatic navigation via injected router | [RouterNavigateExtension.md](./RouterNavigateExtension.md) |
| DioMockExtension | Dio-compatible mock via VM Service extensions | [DioMockExtension.md](./DioMockExtension.md) |

## Usage

```dart
// In your Flutter app's main():
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  // For standard HTTP mocking:
  FliwrightBridge.init();

  // For Dio-based HTTPS mocking:
  // FliwrightBridge.initForDioMock();

  runApp(MyApp());
}

// With GoRouter navigation:
// FliwrightBridge.init(router: goRouter);
```
