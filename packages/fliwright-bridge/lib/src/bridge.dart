import 'dart:io';

import 'package:flutter/foundation.dart';

import 'extension_registry.dart';
import 'extensions/dio_mock_extension.dart';
import 'extensions/form_extract.dart';
import 'extensions/gesture.dart';
import 'extensions/hive_mock_rule_storage.dart';
import 'extensions/http_overrides.dart';
import 'extensions/inspect.dart';
import 'extensions/mock_rule_store.dart';
import 'extensions/mock_server.dart';
import 'extensions/recording.dart';
import 'extensions/riverpod.dart';
import 'extensions/router_navigate.dart';
import 'extensions/screenshot.dart';
import 'extensions/snap.dart';
import 'extensions/scroll_extension.dart';
import 'extensions/settle_extension.dart';
import 'extensions/snapshot.dart';
import 'extensions/type_extension.dart';
import 'ref_registry.dart';

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
    RiverpodExtension.reset();
    DioMockExtension.reset();
    RefRegistry.disposeAll();
    FliwrightHttpOverrides.uninstall();
  }

  /// Initialize the Fliwright bridge and register all VM Service extensions.
  ///
  /// [router] is an optional router instance (e.g. `GoRouter`) that enables
  /// programmatic navigation via `ext.fliwright.navigate`. The bridge calls
  /// `router.push(path)` for normal navigation and `router.go(path)` for route
  /// stack resets via `dynamic` dispatch — no hard dependency on go_router is
  /// required.
  static Future<void> init({
    dynamic router,
    MockRuleStorage? mockStorage,
  }) async {
    _router = router;
    if (_initialized) return;
    _initialized = true;
    _warnIfNotDebugMode();

    _registerPingAndHandshake();

    GestureExtension.register(_registry);
    InspectExtension.register(_registry);
    TypeExtension.register(_registry);
    ScrollExtension.register(_registry);
    SettleExtension.register(_registry);
    SnapshotExtension.register(_registry);
    ScreenshotExtension.register(_registry);
    SnapExtension.register(_registry);
    RecordingExtension.register(_registry);
    FormExtractExtension.register(_registry);

    RiverpodExtension.register(_registry);
    RouterNavigateExtension.register(_registry);

    final mockRuleStore = MockRuleStore(
      storage: await _resolveMockStorage(mockStorage),
    );
    await mockRuleStore.loadFromStorage();
    MockServerExtension.register(_registry, store: mockRuleStore);
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
  static Future<void> initForDioMock({
    dynamic router,
    MockRuleStorage? mockStorage,
  }) async {
    _router = router;
    if (_initialized) return;
    _initialized = true;
    _warnIfNotDebugMode();

    _registerPingAndHandshake();

    GestureExtension.register(_registry);
    InspectExtension.register(_registry);
    TypeExtension.register(_registry);
    ScrollExtension.register(_registry);
    SettleExtension.register(_registry);
    SnapshotExtension.register(_registry);
    ScreenshotExtension.register(_registry);
    SnapExtension.register(_registry);
    RecordingExtension.register(_registry);
    FormExtractExtension.register(_registry);

    RiverpodExtension.register(_registry);
    RouterNavigateExtension.register(_registry);

    final mockRuleStore = MockRuleStore(
      storage: await _resolveMockStorage(mockStorage),
    );
    await mockRuleStore.loadFromStorage();
    // Dio mock — no HttpServer, no HttpOverrides.
    DioMockExtension.register(_registry, store: mockRuleStore);
  }

  static void _registerPingAndHandshake() {
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
        'initialized': _initialized,
        'debugMode': kDebugMode,
        'dartSdkVersion': dartSdkVersion,
        'bridgeCapabilities': {
          'recordingPointerEvents': true,
          'recordingTextInput': true,
          'screenshotWaitForFrame': true,
          'rootRenderViewScreenshot': true,
          'recordingScreenshotSampler': true,
        },
      };
    });
  }

  static void _warnIfNotDebugMode() {
    if (kDebugMode) return;
    debugPrint(
      '[fliwright] Warning: FliwrightBridge was initialized outside debug mode. '
      'Guard setup with kDebugMode so release builds can tree-shake it.',
    );
  }

  static Future<MockRuleStorage?> _resolveMockStorage(
    MockRuleStorage? storage,
  ) async {
    if (storage != null) return storage;
    try {
      return await HiveMockRuleStorage.open();
    } catch (error) {
      debugPrint(
        '[fliwright] Mock rule persistence unavailable; '
        'cached mock routes will not be restored: $error',
      );
      return null;
    }
  }

  /// The Dart SDK version string reported by [Platform.version].
  /// Serves as a proxy for the Flutter SDK version in handshake responses.
  static String get dartSdkVersion {
    try {
      return Platform.version;
    } catch (_) {
      return 'unknown';
    }
  }
}
