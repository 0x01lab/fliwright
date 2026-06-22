# fliwright_bridge_riverpod

Riverpod observer adapter for Fliwright.

This package connects Riverpod provider lifecycle events to `fliwright_bridge`
so Fliwright tools can list, read, watch, serialize, and override provider state
while a Flutter app is running in debug or test mode.

## Usage

Attach `FliwrightRiverpodObserver` to a debug or test `ProviderScope`:

```dart
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge_riverpod/fliwright_bridge_riverpod.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  FliwrightBridge.init();

  runApp(
    ProviderScope(
      observers: kDebugMode ? const [FliwrightRiverpodObserver()] : const [],
      child: const MyApp(),
    ),
  );
}
```

Writable provider overrides require an explicit registration:

```dart
registerFliwrightWritableProvider(
  'counterProvider',
  (value) {
    final next = value as int;
    ref.read(counterProvider.notifier).state = next;
    return next;
  },
);
```

You can also register custom serializers for provider values that should be
represented differently in automation output:

```dart
registerFliwrightProviderSerializer(
  'profileProvider',
  (value) => {'id': value.id, 'name': value.name},
);
```

Only enable the bridge and observer in trusted debug or test builds.
