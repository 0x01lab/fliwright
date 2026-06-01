import 'extension_registry.dart';
import 'extensions/dio_mock_extension.dart';
import 'extensions/form_extract.dart';
import 'extensions/gesture.dart';
import 'extensions/http_overrides.dart';
import 'extensions/inspect.dart';
import 'extensions/mock_server.dart';
import 'extensions/recording.dart';
import 'extensions/riverpod.dart';
import 'extensions/router_navigate.dart';
import 'extensions/screenshot.dart';
import 'extensions/scroll_extension.dart';
import 'extensions/snapshot.dart';
import 'extensions/type_extension.dart';

export 'extension_registry.dart';

class FliwrightBridge {
  static final ExtensionRegistry _registry = ExtensionRegistry();
  static ExtensionRegistry get registry => _registry;
  static bool _initialized = false;

  /// Router instance injected by the app (e.g. GoRouter).
  /// Accessed by [RouterNavigateExtension] to perform navigation.
  /// Uses `dynamic` to avoid a hard dependency on go_router.
  static dynamic _router;
  static dynamic get router => _router;

  static Future<void> reset() async {
    _registry.reset();
    _initialized = false;
    _router = null;
    await RecordingExtension.reset();
    await MockServerExtension.reset();
    FliwrightHttpOverrides.uninstall();
  }

  /// Initialize the Fliwright bridge and register all VM Service extensions.
  ///
  /// [router] is an optional router instance (e.g. `GoRouter`) that enables
  /// programmatic navigation via `ext.fliwright.navigate`. The bridge calls
  /// `router.go(path)` via `dynamic` dispatch — no hard dependency on
  /// go_router is required.
  static Future<void> init({dynamic router}) async {
    _router = router;
    if (_initialized) return;
    _initialized = true;

    _registerPingAndHandshake();

    GestureExtension.register(_registry);
    InspectExtension.register(_registry);
    TypeExtension.register(_registry);
    ScrollExtension.register(_registry);
    SnapshotExtension.register(_registry);
    ScreenshotExtension.register(_registry);
    RecordingExtension.register(_registry);
    FormExtractExtension.register(_registry);

    RiverpodExtension.register(_registry);
    RouterNavigateExtension.register(_registry);

    MockServerExtension.register(_registry);
    await MockServerExtension.startServer();
    final port = MockServerExtension.serverPort;
    if (port != null) {
      FliwrightHttpOverrides.install(port: port);
    }
  }

  /// Initialize the bridge for apps that use Dio with HTTPS APIs.
  ///
  /// Registers all extensions **except** the `HttpOverrides`-based mock server,
  /// which cannot intercept `https://` traffic. Instead, [DioMockExtension] is
  /// registered to expose mock route management via VM Service extensions.
  ///
  /// The host app must:
  /// 1. Create a [FliwrightDioMockInterceptor] and insert it into its Dio
  ///    instance's interceptor chain.
  /// 2. Call [DioMockExtension.setInterceptor] with that instance.
  ///
  /// No HTTP server is started and no `HttpOverrides` are installed.
  static Future<void> initForDioMock({dynamic router}) async {
    _router = router;
    if (_initialized) return;
    _initialized = true;

    _registerPingAndHandshake();

    GestureExtension.register(_registry);
    InspectExtension.register(_registry);
    TypeExtension.register(_registry);
    ScrollExtension.register(_registry);
    SnapshotExtension.register(_registry);
    ScreenshotExtension.register(_registry);
    RecordingExtension.register(_registry);
    FormExtractExtension.register(_registry);

    RiverpodExtension.register(_registry);
    RouterNavigateExtension.register(_registry);

    // Dio mock — no HttpServer, no HttpOverrides.
    DioMockExtension.register(_registry);
  }

  static void _registerPingAndHandshake() {
    _registry.register('ext.fliwright.ping', (params) async {
      return {'status': 'ok', 'timestamp': DateTime.now().toIso8601String()};
    });

    _registry.register('ext.fliwright.handshake', (params) async {
      final clientVersion =
          int.tryParse(params['protocolVersion'] ?? '0') ?? 0;
      return {
        'status': 'ok',
        'protocolVersion': 1,
        'clientVersion': clientVersion,
        'compatible': clientVersion <= 1,
      };
    });
  }
}
