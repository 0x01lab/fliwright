import 'dart:convert';

import 'dio_mock_interceptor.dart';
import 'mock_server.dart';
import '../bridge.dart';

/// VM Service extension that exposes [FliwrightDioMockInterceptor] operations.
///
/// Provides the same API surface as [MockServerExtension] but operates on a
/// Dio interceptor instance injected by the host app via [setInterceptor].
/// This avoids the `HttpOverrides` proxy limitation (HTTPS) by intercepting
/// at the Dio layer instead.
class DioMockExtension {
  static FliwrightDioMockInterceptor? _interceptor;

  /// Inject the [FliwrightDioMockInterceptor] instance created by the host app.
  ///
  /// Call this before or during app startup — the VM service extensions will
  /// delegate to this instance when invoked by external tools.
  static void setInterceptor(FliwrightDioMockInterceptor interceptor) {
    _interceptor = interceptor;
  }

  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.mock.addRoute', _addRoute);
    registry.register('ext.fliwright.mock.removeRoute', _removeRoute);
    registry.register('ext.fliwright.mock.clearRoutes', _clearRoutes);
    registry.register('ext.fliwright.mock.listRoutes', _listRoutes);
    registry.register('ext.fliwright.mock.setPassthrough', _setPassthrough);
    registry.register('ext.fliwright.mock.getCalls', _getCalls);
    registry.register('ext.fliwright.mock.clearCalls', _clearCalls);
  }

  // ---------------------------------------------------------------------------
  // Extension handlers — same parameter protocol as MockServerExtension
  // ---------------------------------------------------------------------------

  static Future<Map<String, dynamic>> _addRoute(
    Map<String, String> params,
  ) async {
    final interceptor = _interceptor;
    if (interceptor == null) {
      return {'error': 'No Dio mock interceptor injected. Call DioMockExtension.setInterceptor() first.'};
    }

    final routeJson = params['route'];
    if (routeJson == null || routeJson.isEmpty) {
      return {'error': 'Missing parameter: route'};
    }

    try {
      final decoded = jsonDecode(routeJson) as Map<String, dynamic>;
      final response = decoded['response'] as Map<String, dynamic>? ?? {};
      final route = MockRoute(
        id: decoded['id'] as String? ??
            DateTime.now().millisecondsSinceEpoch.toString(),
        method: decoded['method'] as String?,
        pathPattern: decoded['path'] as String? ??
            decoded['pathPattern'] as String? ??
            '/',
        status: response['status'] as int? ?? 200,
        headers: (response['headers'] as Map<String, dynamic>?)
                ?.map((k, v) => MapEntry(k, v.toString())) ??
            {'Content-Type': 'application/json'},
        body: response['body'],
        delayMs: response['delay'] as int? ?? 0,
      );
      interceptor.routes.add(route);
      return {'success': true, 'id': route.id};
    } catch (e) {
      return {'error': 'Invalid route JSON: $e'};
    }
  }

  static Future<Map<String, dynamic>> _removeRoute(
    Map<String, String> params,
  ) async {
    final interceptor = _interceptor;
    if (interceptor == null) {
      return {'error': 'No Dio mock interceptor injected'};
    }

    final id = params['id'];
    final path = params['path'];
    if (id != null) {
      final count = interceptor.routes.length;
      interceptor.routes.removeWhere((r) => r.id == id);
      return {'removed': count != interceptor.routes.length};
    }
    if (path != null) {
      final count = interceptor.routes.length;
      interceptor.routes.removeWhere((r) => r.pathPattern == path);
      return {'removed': count != interceptor.routes.length};
    }
    return {'error': 'Missing parameter: id or path'};
  }

  static Future<Map<String, dynamic>> _clearRoutes(
    Map<String, String> params,
  ) async {
    final interceptor = _interceptor;
    if (interceptor == null) {
      return {'error': 'No Dio mock interceptor injected'};
    }

    final count = interceptor.routes.length;
    interceptor.routes.clear();
    return {'cleared': count};
  }

  static Future<Map<String, dynamic>> _listRoutes(
    Map<String, String> params,
  ) async {
    final interceptor = _interceptor;
    if (interceptor == null) {
      return {'error': 'No Dio mock interceptor injected'};
    }

    final routes = interceptor.routes
        .map((r) => {
              'id': r.id,
              'method': r.method,
              'path': r.pathPattern,
            })
        .toList();
    return {'routes': routes};
  }

  static Future<Map<String, dynamic>> _setPassthrough(
    Map<String, String> params,
  ) async {
    final interceptor = _interceptor;
    if (interceptor == null) {
      return {'error': 'No Dio mock interceptor injected'};
    }

    interceptor.passthrough = params['enabled'] == 'true';
    return {'passthrough': interceptor.passthrough};
  }

  static Future<Map<String, dynamic>> _getCalls(
    Map<String, String> params,
  ) async {
    final interceptor = _interceptor;
    if (interceptor == null) {
      return {'error': 'No Dio mock interceptor injected'};
    }

    var calls = interceptor.callLog.toList();
    final pathFilter = params['path'];
    if (pathFilter != null) {
      calls = calls.where((c) => c.path == pathFilter).toList();
    }
    return {'calls': calls.map((c) => c.toJson()).toList()};
  }

  static Future<Map<String, dynamic>> _clearCalls(
    Map<String, String> params,
  ) async {
    final interceptor = _interceptor;
    if (interceptor == null) {
      return {'error': 'No Dio mock interceptor injected'};
    }

    final count = interceptor.callLog.length;
    interceptor.callLog.clear();
    return {'cleared': count};
  }
}
