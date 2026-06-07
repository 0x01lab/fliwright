import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:io';

import '../bridge.dart';

class MockRoute {
  final String id;
  final String? method;
  final String pathPattern;
  final int status;
  final Map<String, String> headers;
  final dynamic body;
  final int delayMs;

  MockRoute({
    required this.id,
    this.method,
    required this.pathPattern,
    this.status = 200,
    this.headers = const {},
    this.body,
    this.delayMs = 0,
  });

  bool matches(String method, String path) {
    if (this.method != null &&
        this.method!.toUpperCase() != method.toUpperCase()) {
      return false;
    }
    return matchesPath(path);
  }

  bool matchesPath(String path) {
    if (pathPattern.endsWith('/*')) {
      // '/api/*' → prefix '/api', matches '/api', '/api/users', but NOT '/apiFoo'
      final prefix = pathPattern.substring(0, pathPattern.length - 2);
      return path == prefix || path.startsWith('$prefix/');
    }
    return path == pathPattern;
  }
}

class MockCallRecord {
  final String method;
  final String path;
  final Map<String, String> headers;
  final String? body;
  final DateTime timestamp;

  MockCallRecord({
    required this.method,
    required this.path,
    required this.headers,
    this.body,
    required this.timestamp,
  });

  Map<String, dynamic> toJson() => {
        'method': method,
        'path': path,
        'headers': headers,
        'body': body,
        'timestamp': timestamp.toIso8601String(),
      };
}

class MockServerExtension {
  static HttpServer? _server;
  static final List<MockRoute> _routes = [];
  static final List<MockCallRecord> _callLog = [];
  static bool _passthrough = false;

  static int? get serverPort => _server?.port;

  static bool shouldProxy(Uri uri) {
    return _routes.any((route) => route.matchesPath(uri.path));
  }

  static void _log(String message) {
    developer.log(message, name: 'fliwright.mock');
  }

  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.mock.addRoute', _addRoute);
    registry.register('ext.fliwright.mock.removeRoute', _removeRoute);
    registry.register('ext.fliwright.mock.clearRoutes', _clearRoutes);
    registry.register('ext.fliwright.mock.listRoutes', _listRoutes);
    registry.register('ext.fliwright.mock.setPassthrough', _setPassthrough);
    registry.register('ext.fliwright.mock.getCalls', _getCalls);
    registry.register('ext.fliwright.mock.clearCalls', _clearCalls);
    registry.register('ext.fliwright.mock.testRequest', _testRequest);
    registry.register('ext.fliwright.mock.debugState', _debugState);
    registry.register('ext.fliwright.mock.setController', _setController);
  }

  static Future<void> startServer({int port = 0}) async {
    if (_server != null) {
      _log('Mock server already running on 127.0.0.1:${_server!.port}');
      return;
    }
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, port);
    _log('Mock server started on 127.0.0.1:${_server!.port}');
    _server!.listen(_handleRequest);
  }

  static Future<void> stopServer() async {
    final server = _server;
    _server = null;
    if (server != null) {
      _log('Stopping mock server on 127.0.0.1:${server.port}');
    }
    await server?.close(force: true);
  }

  static Future<void> reset() async {
    _routes.clear();
    _callLog.clear();
    _passthrough = false;
    await stopServer();
  }

  static Future<Map<String, dynamic>> _addRoute(
      Map<String, String> params) async {
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
        headers: (response['headers'] as Map<String, dynamic>?)?.map(
              (k, v) => MapEntry(k, v.toString()),
            ) ??
            {'Content-Type': 'application/json'},
        body: response['body'],
        delayMs: response['delay'] as int? ?? 0,
      );
      final beforeReplace = _routes.length;
      _routes.removeWhere((existing) => _sameRouteKey(existing, route));
      final replaced = beforeReplace - _routes.length;
      _routes.add(route);
      _log(
        'Registered route ${route.method ?? '*'} ${route.pathPattern} '
        'status=${route.status} delayMs=${route.delayMs} replaced=$replaced routes=${_routes.length}',
      );
      return {'success': true, 'id': route.id};
    } catch (e) {
      _log('Failed to register route: $e');
      return {'error': 'Invalid route JSON: $e'};
    }
  }

  static bool _sameRouteKey(MockRoute a, MockRoute b) {
    return a.pathPattern == b.pathPattern &&
        (a.method ?? '').toUpperCase() == (b.method ?? '').toUpperCase();
  }

  static Future<Map<String, dynamic>> _removeRoute(
      Map<String, String> params) async {
    final id = params['id'];
    final path = params['path'];
    if (id != null) {
      final removed = _routes.length;
      _routes.removeWhere((r) => r.id == id);
      _log(
          'Removed route id=$id removed=${removed != _routes.length} routes=${_routes.length}');
      return {'removed': removed != _routes.length};
    }
    if (path != null) {
      final method = params['method'];
      final removed = _routes.length;
      _routes.removeWhere((r) =>
          r.pathPattern == path &&
          (method == null ||
              (r.method ?? '').toUpperCase() == method.toUpperCase()));
      _log(
          'Removed route path=$path method=${method ?? '*'} removed=${removed != _routes.length} routes=${_routes.length}');
      return {'removed': removed != _routes.length};
    }
    return {'error': 'Missing parameter: id or path'};
  }

  static Future<Map<String, dynamic>> _clearRoutes(
      Map<String, String> params) async {
    final count = _routes.length;
    _routes.clear();
    _log('Cleared $count route(s)');
    return {'cleared': count};
  }

  static Future<Map<String, dynamic>> _listRoutes(
      Map<String, String> params) async {
    final routes = _routes
        .map((r) => {
              'id': r.id,
              'method': r.method,
              'path': r.pathPattern,
            })
        .toList();
    return {'routes': routes};
  }

  static Future<Map<String, dynamic>> _setPassthrough(
      Map<String, String> params) async {
    _passthrough = params['enabled'] == 'true';
    _log('Passthrough set to $_passthrough');
    return {'passthrough': _passthrough};
  }

  static Future<Map<String, dynamic>> _getCalls(
      Map<String, String> params) async {
    final pathFilter = params['path'];
    var calls = _callLog.toList();
    if (pathFilter != null) {
      calls = calls.where((c) => c.path == pathFilter).toList();
    }
    return {'calls': calls.map((c) => c.toJson()).toList()};
  }

  static Future<Map<String, dynamic>> _clearCalls(
      Map<String, String> params) async {
    final count = _callLog.length;
    _callLog.clear();
    _log('Cleared $count recorded call(s)');
    return {'cleared': count};
  }

  static Future<Map<String, dynamic>> _debugState(
      Map<String, String> params) async {
    return {
      'mode': 'http',
      'serverPort': _server?.port,
      'passthrough': _passthrough,
      'routes': _routes
          .map((route) => {
                'id': route.id,
                'method': route.method,
                'path': route.pathPattern,
                'status': route.status,
              })
          .toList(),
      'calls': _callLog.length,
    };
  }

  static Future<Map<String, dynamic>> _setController(
      Map<String, String> params) async {
    return {
      'error':
          'Tool mock controller is only supported by FliwrightDioMockInterceptor. Use FliwrightBridge.initForDioMock().'
    };
  }

  static Future<void> _handleRequest(HttpRequest request) async {
    final originalUrl = request.headers.value('x-original-url');
    final uri = originalUrl != null ? Uri.parse(originalUrl) : request.uri;
    _log(
      'Incoming ${request.method} ${uri.path}'
      '${uri.hasQuery ? '?${uri.query}' : ''} '
      'rawUri=${request.uri} originalUrl=${originalUrl ?? '-'}',
    );

    final route = _routes.cast<MockRoute?>().firstWhere(
          (r) => r!.matches(request.method, uri.path),
          orElse: () => null,
        );

    if (route != null) {
      final requestBody = await _readRequestBody(request);
      final callHeaders = <String, String>{};
      request.headers.forEach((name, values) {
        callHeaders[name] = values.join(', ');
      });

      _callLog.add(MockCallRecord(
        method: request.method,
        path: uri.path,
        headers: callHeaders,
        body: requestBody,
        timestamp: DateTime.now(),
      ));

      _log(
          'Matched route ${route.method ?? '*'} ${route.pathPattern} -> ${route.status}');
      await _respondWithRoute(request, route);
    } else if (_passthrough) {
      final requestBody = await _readRequestBody(request);
      _log(
          'No route matched ${request.method} ${uri.path}; passthrough enabled');
      await _passthroughRequest(request, uri, requestBody);
    } else {
      _log(
        'No route matched ${request.method} ${uri.path}; returning 404. '
        'Registered routes: ${_routes.map((r) => '${r.method ?? '*'} ${r.pathPattern}').join(', ')}',
      );
      request.response
        ..statusCode = 404
        ..headers.contentType = ContentType.json
        ..write(jsonEncode({'error': 'No matching route', 'path': uri.path}));
      await request.response.close();
    }
  }

  static Future<String?> _readRequestBody(HttpRequest request) async {
    // Read body once — HttpRequest is a single-subscription stream.
    // contentLength is -1 when chunked transfer encoding is used (e.g. via
    // HTTP proxy), so check != 0 rather than > 0.
    if (request.contentLength == 0) return null;
    final body = await utf8.decodeStream(request);
    return body.isEmpty ? null : body;
  }

  static Future<void> _respondWithRoute(
      HttpRequest request, MockRoute route) async {
    if (route.delayMs > 0) {
      await Future.delayed(Duration(milliseconds: route.delayMs));
    }
    final response = request.response;
    response.statusCode = route.status;
    // Set default Content-Type with UTF-8 charset first, so route headers can override it.
    response.headers.contentType = ContentType.json;
    response.headers.set('Content-Type', 'application/json; charset=utf-8');
    route.headers.forEach((key, value) {
      response.headers.set(key, value);
    });
    // Use utf8.encode + add() instead of write() to support non-ASCII (e.g. Chinese).
    // response.write() uses Latin1Codec which rejects characters > U+00FF.
    response.add(utf8.encode(jsonEncode(route.body)));
    await response.close();
  }

  static Future<void> _passthroughRequest(
    HttpRequest request,
    Uri originalUri,
    String? requestBody,
  ) async {
    // Run in a zone with a no-proxy HttpOverrides so the passthrough
    // HttpClient bypasses the global FliwrightHttpOverrides proxy and talks
    // directly to the real upstream server.  Without this, the proxy config
    // in FliwrightHttpOverrides.findProxyFromEnvironment routes the request
    // right back to the mock server, causing an infinite loop.
    await HttpOverrides.runWithHttpOverrides(() async {
      final client = HttpClient();
      try {
        _log('Passthrough request ${request.method} $originalUri');
        final outgoing = await client.openUrl(request.method, originalUri);
        // Copy headers but strip internal proxy headers.
        const internalHeaders = {'x-original-url'};
        request.headers.forEach((name, values) {
          if (internalHeaders.contains(name.toLowerCase())) return;
          for (final value in values) {
            outgoing.headers.set(name, value);
          }
        });
        // Forward the already-decoded body (HttpRequest is single-subscription).
        if (requestBody != null && requestBody.isNotEmpty) {
          outgoing.write(requestBody);
        }
        final incoming = await outgoing.close();
        final proxyResponse = request.response;
        proxyResponse.statusCode = incoming.statusCode;
        incoming.headers.forEach((name, values) {
          for (final value in values) {
            proxyResponse.headers.set(name, value);
          }
        });
        await incoming.pipe(proxyResponse);
      } catch (e) {
        _log('Passthrough failed for ${request.method} $originalUri: $e');
        request.response
          ..statusCode = 502
          ..headers.contentType = ContentType.json
          ..write(jsonEncode({'error': 'Passthrough failed: $e'}));
        await request.response.close();
      } finally {
        client.close();
      }
    }, _NoProxyHttpOverrides());
  }

  /// Test-only extension: makes an HTTP request through the app's normal
  /// HttpClient (subject to HttpOverrides) and returns the response.
  /// This lets E2E tests verify that the mock proxy is intercepting traffic
  /// without depending on the UI layer or third-party HTTP clients like Dio.
  static Future<Map<String, dynamic>> _testRequest(
      Map<String, String> params) async {
    final url = params['url'] ?? 'http://test.local/ping';
    final method = (params['method'] ?? 'GET').toUpperCase();
    try {
      final client = HttpClient();
      try {
        late HttpClientRequest request;
        final uri = Uri.parse(url);
        switch (method) {
          case 'POST':
            request = await client.openUrl('POST', uri);
            if (params.containsKey('body')) {
              request.headers.contentType = ContentType.json;
              request.write(params['body']);
            }
            break;
          default:
            request = await client.openUrl('GET', uri);
        }
        final response = await request.close();
        final body = await utf8.decoder.bind(response).join();
        return {
          'status': response.statusCode,
          'body': body,
        };
      } finally {
        client.close();
      }
    } catch (e) {
      return {'error': e.toString()};
    }
  }
}

/// Used by [_passthroughRequest] to bypass the global [FliwrightHttpOverrides]
/// and connect directly to the real upstream server.
class _NoProxyHttpOverrides extends HttpOverrides {
  @override
  String findProxyFromEnvironment(Uri url, Map<String, String>? environment) {
    return 'DIRECT';
  }
}
