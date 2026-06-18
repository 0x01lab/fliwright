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
  static FliwrightDioMockInterceptor? _interceptor;
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
    final previous = _interceptor;
    final replaced = previous != null && !identical(previous, interceptor);
    if (replaced) {
      _neutralizeInterceptor(previous);
    }
    _interceptor = interceptor;
    interceptor.ruleStore = _store;
    interceptor.passthrough = _passthrough;
    _log(
      'Dio mock interceptor injected store=#${interceptor.ruleStoreDebugId} '
      'routes=${interceptor.routes.length} '
      'passthrough=${interceptor.passthrough} replaced=$replaced',
    );
  }

  /// Remove a Dio mock interceptor from extension diagnostics.
  ///
  /// Apps usually do not need to call this because Dio instances are typically
  /// long-lived. It is available for providers that dispose and recreate Dio
  /// instances frequently, so call logs and debug state can stop tracking
  /// inactive interceptors.
  static void unsetInterceptor(FliwrightDioMockInterceptor interceptor) {
    final active = identical(_interceptor, interceptor);
    if (active) {
      _interceptor = null;
    }
    _neutralizeInterceptor(interceptor);
    _log(
      'Dio mock interceptor removed and neutralized '
      'store=#${interceptor.ruleStoreDebugId} active=$active',
    );
  }

  static void reset() {
    final current = _interceptor;
    if (current != null) {
      _neutralizeInterceptor(current);
    }
    _interceptor = null;
    _store = MockRuleStore();
    _callLog.clear();
    _passthrough = true;
  }

  static void register(ExtensionRegistry registry, {MockRuleStore? store}) {
    if (store != null) {
      _store = store;
      _syncInterceptorToStore();
      _log(
        'Dio mock store registered store=#${_store.debugId} '
        'routes=${_store.getAllRoutes().length} '
        'interceptorInjected=${_interceptor != null}',
      );
    }
    registry.register('ext.fliwright.mock.addRoute', _addRoute);
    registry.register('ext.fliwright.mock.removeRoute', _removeRoute);
    registry.register('ext.fliwright.mock.clearRoutes', _clearRoutes);
    registry.register('ext.fliwright.mock.listRoutes', _listRoutes);
    registry.register('ext.fliwright.mock.setPassthrough', _setPassthrough);
    registry.register('ext.fliwright.mock.getCalls', _getCalls);
    registry.register('ext.fliwright.mock.clearCalls', _clearCalls);
    registry.register('ext.fliwright.mock.debugState', _debugState);
    // Guarantee the interceptor shares the canonical store regardless of the
    // order the host app called setInterceptor/register in. Without this, the
    // interceptor can keep matching against a stale store while VSCode mutates
    // another — the "no rule in VSCode but Flutter still mocks" failure.
    _syncInterceptorToStore();
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
      _syncInterceptorToStore();
      final beforeReplace = _store.getAllRoutes().length;
      await _store.addRoute(route);
      final replaced = beforeReplace - _store.getAllRoutes().length + 1;
      _syncInterceptorToStore();
      _log(
        'Registered Dio route ${route.method ?? '*'} ${route.pathPattern} '
        'status=${route.status} delayMs=${route.delayMs} replaced=$replaced '
        'store=#${_store.debugId} routes=${_store.getAllRoutes().length} '
        'interceptorInjected=${_interceptor != null}',
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
      _syncInterceptorToStore();
      _log(
        'Removed Dio route id=$id removed=$removed store=#${_store.debugId} '
        'routes=${_store.getAllRoutes().length} interceptorInjected=${_interceptor != null}',
      );
      return {'removed': removed};
    }
    if (path != null) {
      final method = params['method'];
      final removed = await _store.removeRoute(path: path, method: method);
      _syncInterceptorToStore();
      _log(
        'Removed Dio route path=$path method=${method ?? '*'} removed=$removed '
        'store=#${_store.debugId} routes=${_store.getAllRoutes().length} '
        'interceptorInjected=${_interceptor != null}',
      );
      return {'removed': removed};
    }
    return {'error': 'Missing parameter: id or path'};
  }

  static Future<Map<String, dynamic>> _clearRoutes(
    Map<String, String> params,
  ) async {
    final count = await _store.clearRoutes();
    _syncInterceptorToStore();
    _log(
      'Cleared $count Dio route(s); '
      'store=#${_store.debugId} routes=${_store.getAllRoutes().length} '
      'interceptorInjected=${_interceptor != null}',
    );
    return {'cleared': count};
  }

  static Future<Map<String, dynamic>> _listRoutes(
    Map<String, String> params,
  ) async {
    _syncInterceptorToStore();
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
    _interceptor?.passthrough = _passthrough;
    _log(
      'Dio passthrough set to $_passthrough interceptorInjected=${_interceptor != null}',
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
    _interceptor?.callLog.clear();
    _callLog.clear();
    _log('Cleared $count Dio recorded call(s)');
    return {'cleared': count};
  }

  static Future<Map<String, dynamic>> _debugState(
    Map<String, String> params,
  ) async {
    final calls = _allCalls();
    final interceptor = _interceptor;
    return {
      'mode': 'dio',
      'interceptorInjected': interceptor != null,
      'interceptors': interceptor == null ? 0 : 1,
      'passthrough': _passthrough,
      'storeId': _store.debugId,
      'routes': _store
          .getAllRoutes()
          .map((route) => {
                'id': route.id,
                'method': route.method,
                'path': route.pathPattern,
                'status': route.status,
              })
          .toList(),
      if (interceptor != null)
        'interceptorState': {
          'storeId': interceptor.ruleStoreDebugId,
          'sharedStore': identical(interceptor.ruleStore, _store),
          'passthrough': interceptor.passthrough,
          'routes': interceptor.routes
              .map((route) => {
                    'id': route.id,
                    'method': route.method,
                    'path': route.pathPattern,
                    'status': route.status,
                  })
              .toList(),
          'calls': interceptor.callLog.length,
        },
      'calls': calls.length,
    };
  }

  static void _syncInterceptorToStore() {
    final interceptor = _interceptor;
    if (interceptor == null) return;
    interceptor.ruleStore = _store;
    interceptor.passthrough = _passthrough;
  }

  static void _neutralizeInterceptor(FliwrightDioMockInterceptor interceptor) {
    interceptor.ruleStore = MockRuleStore();
    interceptor.passthrough = true;
    interceptor.callLog.clear();
  }

  static List<MockCallRecord> _allCalls() {
    final interceptor = _interceptor;
    if (interceptor == null) {
      return _callLog.toList();
    }

    return [
      ..._callLog,
      ...interceptor.callLog,
    ];
  }
}
