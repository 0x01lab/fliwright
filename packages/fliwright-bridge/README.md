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

## What It Exposes

- Widget inspection and selector queries.
- Tap, type, scroll, settle automation, and soft-keyboard dismissal.
- Screenshots and frame capture.
- Interaction recording.
- Runtime network mock support for Dio and HTTP overrides.
- Riverpod state extension primitives used by `fliwright_bridge_riverpod`.

Only enable the bridge in trusted debug or test builds. It is designed for
local automation and E2E testing, not production runtime control.
