---
package: "fliwright-bridge"
version: "0.1.0"
layer: integration
status: implemented
generated: "2026-06-01"
---

# fliwright-bridge

> Dart-side bridge that registers VM Service extensions and handles Flutter widget interactions.

## Overview

`fliwright-bridge` runs inside the Flutter app process. It registers VM Service extensions via `ExtensionRegistry` that the TypeScript SDK calls via JSON-RPC over WebSocket. The bridge is initialized with `FliwrightBridge.init()`.

## Architecture

- **FliwrightBridge** — Static class that initializes all extensions
- **ExtensionRegistry** — Maps extension method names to handler functions

## Extensions

| Extension | Methods | Doc |
|-----------|---------|-----|
| Ping | `ext.fliwright.ping` | Inline |
| Handshake | `ext.fliwright.handshake` | Inline |
| Gesture | `click`, `gesture` (longPress/drag/pinch) | [GestureExtension.md](./GestureExtension.md) |
| Inspect | `inspect` (selector-based widget lookup) | [InspectExtension.md](./InspectExtension.md) |
| Type | `type` (text input simulation) | [TypeExtension.md](./TypeExtension.md) |
| Scroll | `scrollIntoView` | [ScrollExtension.md](./ScrollExtension.md) |
| Snapshot | `snapshot` (interactive widget capture) | [SnapshotExtension.md](./SnapshotExtension.md) |
| Screenshot | `screenshot` (render tree to PNG) | [ScreenshotExtension.md](./ScreenshotExtension.md) |
| Recording | `startRecording`, `stopRecording`, `hitTest` | [RecordingExtension.md](./RecordingExtension.md) |
| Form Extract | `extractForm` (TextField extraction) | [FormExtractExtension.md](./FormExtractExtension.md) |
| Riverpod | `list`, `read`, `override`, `watch`, `unwatch` | [RiverpodExtension.md](./RiverpodExtension.md) |
| Mock Server | `addRoute`, `removeRoute`, `clearRoutes`, `listRoutes`, `setPassthrough`, `getCalls`, `clearCalls`, `testRequest` | [MockServerExtension.md](./MockServerExtension.md) |
| HTTP Overrides | Installs proxy to mock server | [HttpOverrides.md](./HttpOverrides.md) |

## Usage Example

```dart
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  // Initialize all extensions
  FliwrightBridge.init();

  // Later, reset for clean state
  FliwrightBridge.reset();
}
```
