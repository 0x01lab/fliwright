import 'dart:convert';
import 'dart:developer' as developer;

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

  static void _log(String message) {
    developer.log(message, name: 'fliwright.mock.dio');
  }

  /// Inject the [FliwrightDioMockInterceptor] instance created by the host app.
  ///
  /// Call this before or during app startup — the VM service extensions will
  /// delegate to this instance when invoked by external tools.
  static void setInterceptor(FliwrightDioMockInterceptor interceptor) {
    final previous = _interceptor;
    if (previous != null && previous != interceptor) {
      interceptor.routes
        ..clear()
        ..addAll(previous.routes);
      interceptor.callLog
        ..clear()
        ..addAll(previous.callLog);
      interceptor.passthrough = previous.passthrough;
      interceptor.controllerUrl = previous.controllerUrl;
    }
    _interceptor = interceptor;
    _log(
      'Dio mock interceptor injected routes=${interceptor.routes.length} passthrough=${interceptor.passthrough} controller=${interceptor.controllerUrl ?? '-'}',
    );
  }

  static void reset() {
    _interceptor = null;
  }

  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.mock.addRoute', _addRoute);
    registry.register('ext.fliwright.mock.removeRoute', _removeRoute);
    registry.register('ext.fliwright.mock.clearRoutes', _clearRoutes);
    registry.register('ext.fliwright.mock.listRoutes', _listRoutes);
    registry.register('ext.fliwright.mock.setPassthrough', _setPassthrough);
    registry.register('ext.fliwright.mock.getCalls', _getCalls);
    registry.register('ext.fliwright.mock.clearCalls', _clearCalls);
    registry.register('ext.fliwright.mock.debugState', _debugState);
    registry.register('ext.fliwright.mock.setController', _setController);
  }

  // ---------------------------------------------------------------------------
  // Extension handlers — same parameter protocol as MockServerExtension
  // ---------------------------------------------------------------------------

  static Future<Map<String, dynamic>> _addRoute(
    Map<String, String> params,
  ) async {
    final interceptor = _interceptor;
    if (interceptor == null) {
      _log('addRoute failed: no Dio mock interceptor injected');
      return {
        'error':
            'No Dio mock interceptor injected. Call DioMockExtension.setInterceptor() first.'
      };
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
      final beforeReplace = interceptor.routes.length;
      interceptor.routes
          .removeWhere((existing) => _sameRouteKey(existing, route));
      final replaced = beforeReplace - interceptor.routes.length;
      interceptor.routes.add(route);
      _log(
        'Registered Dio route ${route.method ?? '*'} ${route.pathPattern} '
        'status=${route.status} delayMs=${route.delayMs} replaced=$replaced routes=${interceptor.routes.length}',
      );
      return {'success': true, 'id': route.id};
    } catch (e) {
      _log('Failed to register Dio route: $e');
      return {'error': 'Invalid route JSON: $e'};
    }
  }

  static bool _sameRouteKey(MockRoute a, MockRoute b) {
    return a.pathPattern == b.pathPattern &&
        (a.method ?? '').toUpperCase() == (b.method ?? '').toUpperCase();
  }

  static Future<Map<String, dynamic>> _removeRoute(
    Map<String, String> params,
  ) async {
    final interceptor = _interceptor;
    if (interceptor == null) {
      _log('removeRoute failed: no Dio mock interceptor injected');
      return {'error': 'No Dio mock interceptor injected'};
    }

    final id = params['id'];
    final path = params['path'];
    if (id != null) {
      final count = interceptor.routes.length;
      interceptor.routes.removeWhere((r) => r.id == id);
      _log(
          'Removed Dio route id=$id removed=${count != interceptor.routes.length} routes=${interceptor.routes.length}');
      return {'removed': count != interceptor.routes.length};
    }
    if (path != null) {
      final count = interceptor.routes.length;
      interceptor.routes.removeWhere((r) => r.pathPattern == path);
      _log(
          'Removed Dio route path=$path removed=${count != interceptor.routes.length} routes=${interceptor.routes.length}');
      return {'removed': count != interceptor.routes.length};
    }
    return {'error': 'Missing parameter: id or path'};
  }

  static Future<Map<String, dynamic>> _clearRoutes(
    Map<String, String> params,
  ) async {
    final interceptor = _interceptor;
    if (interceptor == null) {
      _log('clearRoutes failed: no Dio mock interceptor injected');
      return {'error': 'No Dio mock interceptor injected'};
    }

    final count = interceptor.routes.length;
    interceptor.routes.clear();
    _log('Cleared $count Dio route(s)');
    return {'cleared': count};
  }

  static Future<Map<String, dynamic>> _listRoutes(
    Map<String, String> params,
  ) async {
    final interceptor = _interceptor;
    if (interceptor == null) {
      _log('listRoutes failed: no Dio mock interceptor injected');
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
      _log('setPassthrough failed: no Dio mock interceptor injected');
      return {'error': 'No Dio mock interceptor injected'};
    }

    interceptor.passthrough = params['enabled'] == 'true';
    _log('Dio passthrough set to ${interceptor.passthrough}');
    return {'passthrough': interceptor.passthrough};
  }

  static Future<Map<String, dynamic>> _getCalls(
    Map<String, String> params,
  ) async {
    final interceptor = _interceptor;
    if (interceptor == null) {
      _log('getCalls failed: no Dio mock interceptor injected');
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
      _log('clearCalls failed: no Dio mock interceptor injected');
      return {'error': 'No Dio mock interceptor injected'};
    }

    final count = interceptor.callLog.length;
    interceptor.callLog.clear();
    _log('Cleared $count Dio recorded call(s)');
    return {'cleared': count};
  }

  static Future<Map<String, dynamic>> _debugState(
    Map<String, String> params,
  ) async {
    final interceptor = _interceptor;
    if (interceptor == null) {
      return {
        'mode': 'dio',
        'interceptorInjected': false,
        'routes': <Map<String, dynamic>>[],
        'calls': 0,
      };
    }

    return {
      'mode': 'dio',
      'interceptorInjected': true,
      'passthrough': interceptor.passthrough,
      'controllerUrl': interceptor.controllerUrl,
      'routes': interceptor.routes
          .map((route) => {
                'id': route.id,
                'method': route.method,
                'path': route.pathPattern,
                'status': route.status,
              })
          .toList(),
      'calls': interceptor.callLog.length,
    };
  }

  static Future<Map<String, dynamic>> _setController(
    Map<String, String> params,
  ) async {
    final interceptor = _interceptor;
    if (interceptor == null) {
      _log('setController failed: no Dio mock interceptor injected');
      return {'error': 'No Dio mock interceptor injected'};
    }
    final url = params['url'];
    if (url == null || url.isEmpty) {
      interceptor.controllerUrl = null;
    } else {
      interceptor.controllerUrl = url.replaceFirst(RegExp(r'/$'), '');
    }
    _log('Dio mock controller set to ${interceptor.controllerUrl ?? '-'}');
    return {'controllerUrl': interceptor.controllerUrl};
  }
}
