import 'extension_registry.dart';
import 'extensions/gesture.dart';
import 'extensions/inspect.dart';
import 'extensions/riverpod.dart';
import 'extensions/scroll_extension.dart';
import 'extensions/type_extension.dart';

export 'extension_registry.dart';

class FliwrightBridge {
  static final ExtensionRegistry _registry = ExtensionRegistry();
  static ExtensionRegistry get registry => _registry;
  static bool _initialized = false;

  /// Resets the registry and initialization state. Intended for testing only.
  static void reset() {
    _registry.reset();
    _initialized = false;
  }

  static Future<void> init() async {
    if (_initialized) return;
    _initialized = true;

    _registry.register('ext.fliwright.ping', (params) async {
      return {'status': 'ok', 'timestamp': DateTime.now().toIso8601String()};
    });

    _registry.register('ext.fliwright.handshake', (params) async {
      final clientVersion = int.tryParse(params['protocolVersion'] ?? '0') ?? 0;
      return {
        'status': 'ok',
        'protocolVersion': 1,
        'clientVersion': clientVersion,
        'compatible': clientVersion <= 1,
      };
    });

    GestureExtension.register(_registry);
    InspectExtension.register(_registry);
    TypeExtension.register(_registry);
    ScrollExtension.register(_registry);

    RiverpodExtension.register(_registry);
  }
}
