import 'extension_registry.dart';
import 'extensions/gesture.dart';
import 'extensions/http_overrides.dart';
import 'extensions/inspect.dart';
import 'extensions/mock_server.dart';
import 'extensions/recording.dart';
import 'extensions/riverpod.dart';
import 'extensions/scroll_extension.dart';
import 'extensions/snapshot.dart';
import 'extensions/type_extension.dart';

export 'extension_registry.dart';

class FliwrightBridge {
  static final ExtensionRegistry _registry = ExtensionRegistry();
  static ExtensionRegistry get registry => _registry;
  static bool _initialized = false;

  static Future<void> reset() async {
    _registry.reset();
    _initialized = false;
    await MockServerExtension.reset();
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
    SnapshotExtension.register(_registry);
    RecordingExtension.register(_registry);

    RiverpodExtension.register(_registry);

    MockServerExtension.register(_registry);
    await MockServerExtension.startServer();
    final port = MockServerExtension.serverPort;
    if (port != null) {
      FliwrightHttpOverrides.install(port: port);
    }
  }
}
