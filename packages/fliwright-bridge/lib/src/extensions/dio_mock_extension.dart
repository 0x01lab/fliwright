import 'dart:convert';
import 'dart:developer' as developer;

import 'dio_mock_interceptor.dart';
import 'mock_rule_store.dart';
import '../bridge.dart';

/// VM Service extension that exposes [FliwrightDioMockInterceptor] operations.
///
/// Provides the same API surface as [MockServerExtension] but operates on a
/// Dio interceptor instance injected by the host app via [setInterceptor].
/// This avoids the `HttpOverrides` proxy limitation (HTTPS) by intercepting
/// at the Dio layer instead.
class DioMockExtension {
  static final Set<FliwrightDioMockInterceptor> _interceptors = {};
  static MockRuleStore _store = MockRuleStore();
  static final List<MockCallRecord> _callLog = [];
  static bool _passthrough = true;

  static void _log(String message) {
    developer.log(message, name: 'fliwright.mock.dio');
  }

  /// Inject the [FliwrightDioMockInterceptor] instance created by the host app.
  ///
  /// Call this before or during app startup — the VM service extensions will
  /// delegate to this instance when invoked by external tools.
  static void setInterceptor(FliwrightDioMockInterceptor interceptor) {
    _interceptors.add(interceptor);
    interceptor.ruleStore = _store;
    interceptor.passthrough = _passthrough;
    _log(
      'Dio mock interceptor injected routes=${interceptor.routes.length} '
      'passthrough=${interceptor.passthrough} interceptors=${_interceptors.length}',
    );
  }

  /// Remove a Dio mock interceptor from extension diagnostics.
  ///
  /// Apps usually do not need to call this because Dio instances are typically
  /// long-lived. It is available for providers that dispose and recreate Dio
  /// instances frequently, so call logs and debug state can stop tracking
  /// inactive interceptors.
  static void unsetInterceptor(FliwrightDioMockInterceptor interceptor) {
    _interceptors.remove(interceptor);
    _log('Dio mock interceptor removed interceptors=${_interceptors.length}');
  }

  static void reset() {
    _interceptors.clear();
    _store = MockRuleStore();
    _callLog.clear();
    _passthrough = true;
  }

  static void register(ExtensionRegistry registry, {MockRuleStore? store}) {
    if (store != null) {
      _store = store;
      for (final interceptor in _interceptors) {
        interceptor.ruleStore = _store;
      }
    }
    registry.register('ext.fliwright.mock.addRoute', _addRoute);
    registry.register('ext.fliwright.mock.removeRoute', _removeRoute);
    registry.register('ext.fliwright.mock.clearRoutes', _clearRoutes);
    registry.register('ext.fliwright.mock.listRoutes', _listRoutes);
    registry.register('ext.fliwright.mock.setPassthrough', _setPassthrough);
    registry.register('ext.fliwright.mock.getCalls', _getCalls);
    registry.register('ext.fliwright.mock.clearCalls', _clearCalls);
    registry.register('ext.fliwright.mock.debugState', _debugState);
  }

  // ---------------------------------------------------------------------------
  // Extension handlers — same parameter protocol as MockServerExtension
  // ---------------------------------------------------------------------------

  static Future<Map<String, dynamic>> _addRoute(
    Map<String, String> params,
  ) async {
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
      final beforeReplace = _store.getAllRoutes().length;
      await _store.addRoute(route);
      final replaced = beforeReplace - _store.getAllRoutes().length + 1;
      _log(
        'Registered Dio route ${route.method ?? '*'} ${route.pathPattern} '
        'status=${route.status} delayMs=${route.delayMs} replaced=$replaced routes=${_store.getAllRoutes().length}',
      );
      return {'success': true, 'id': route.id};
    } catch (e) {
      _log('Failed to register Dio route: $e');
      return {'error': 'Invalid route JSON: $e'};
    }
  }

  static Future<Map<String, dynamic>> _removeRoute(
    Map<String, String> params,
  ) async {
    final id = params['id'];
    final path = params['path'];
    if (id != null) {
      final removed = await _store.removeRoute(id: id);
      _log(
          'Removed Dio route id=$id removed=$removed routes=${_store.getAllRoutes().length}');
      return {'removed': removed};
    }
    if (path != null) {
      final method = params['method'];
      final removed = await _store.removeRoute(path: path, method: method);
      _log(
          'Removed Dio route path=$path method=${method ?? '*'} removed=$removed routes=${_store.getAllRoutes().length}');
      return {'removed': removed};
    }
    return {'error': 'Missing parameter: id or path'};
  }

  static Future<Map<String, dynamic>> _clearRoutes(
    Map<String, String> params,
  ) async {
    final count = await _store.clearRoutes();
    _log('Cleared $count Dio route(s)');
    return {'cleared': count};
  }

  static Future<Map<String, dynamic>> _listRoutes(
    Map<String, String> params,
  ) async {
    final routes = _store
        .getAllRoutes()
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
    _passthrough = params['enabled'] == 'true';
    for (final interceptor in _interceptors) {
      interceptor.passthrough = _passthrough;
    }
    _log(
      'Dio passthrough set to $_passthrough interceptors=${_interceptors.length}',
    );
    return {'passthrough': _passthrough};
  }

  static Future<Map<String, dynamic>> _getCalls(
    Map<String, String> params,
  ) async {
    var calls = _allCalls();
    final pathFilter = params['path'];
    if (pathFilter != null) {
      calls = calls.where((c) => c.path == pathFilter).toList();
    }
    return {'calls': calls.map((c) => c.toJson()).toList()};
  }

  static Future<Map<String, dynamic>> _clearCalls(
    Map<String, String> params,
  ) async {
    final count = _allCalls().length;
    for (final interceptor in _interceptors) {
      interceptor.callLog.clear();
    }
    _callLog.clear();
    _log('Cleared $count Dio recorded call(s)');
    return {'cleared': count};
  }

  static Future<Map<String, dynamic>> _debugState(
    Map<String, String> params,
  ) async {
    final calls = _allCalls();
    if (_interceptors.isEmpty) {
      return {
        'mode': 'dio',
        'interceptorInjected': false,
        'interceptors': 0,
        'passthrough': _passthrough,
        'routes': _store
            .getAllRoutes()
            .map((route) => {
                  'id': route.id,
                  'method': route.method,
                  'path': route.pathPattern,
                  'status': route.status,
                })
            .toList(),
        'calls': calls.length,
      };
    }

    return {
      'mode': 'dio',
      'interceptorInjected': true,
      'interceptors': _interceptors.length,
      'passthrough': _passthrough,
      'routes': _store
          .getAllRoutes()
          .map((route) => {
                'id': route.id,
                'method': route.method,
                'path': route.pathPattern,
                'status': route.status,
              })
          .toList(),
      'calls': calls.length,
    };
  }

  static List<MockCallRecord> _allCalls() {
    if (_interceptors.isEmpty) {
      return _callLog.toList();
    }

    return [
      ..._callLog,
      for (final interceptor in _interceptors) ...interceptor.callLog,
    ];
  }
}
