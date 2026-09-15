import 'dart:async';

import '../extension_registry.dart';

/// Coordinates deterministic scenario setup before a test app renders its
/// first frame. Applications opt in from their test-only entrypoint by calling
/// [awaitScenario] after [FliwrightBridge.init] and before `runApp`.
class FliwrightTestBootstrap {
  static Completer<void>? _release;

  static bool get isWaiting => _release != null && !_release!.isCompleted;

  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.testBootstrap.status', (_) async {
      return {'waiting': isWaiting};
    });
    registry.register('ext.fliwright.testBootstrap.release', (_) async {
      final release = _release;
      if (release == null) {
        return {
          'released': false,
          'error': 'The app has not entered FliwrightTestBootstrap.awaitScenario().',
        };
      }
      if (!release.isCompleted) release.complete();
      return {'released': true};
    });
  }

  /// Pauses a test-only app until the controller applies and releases a named
  /// scenario. Do not call this from a production application entrypoint.
  static Future<void> awaitScenario() async {
    if (_release != null) {
      throw StateError('FliwrightTestBootstrap.awaitScenario() may only run once.');
    }
    _release = Completer<void>();
    await _release!.future;
  }

  static void reset() {
    _release = null;
  }
}
