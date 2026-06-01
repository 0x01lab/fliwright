import 'dart:convert';
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
    if (this.method != null && this.method!.toUpperCase() != method.toUpperCase()) {
      return false;
    }
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

  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.mock.addRoute', _addRoute);
    registry.register('ext.fliwright.mock.removeRoute', _removeRoute);
    registry.register('ext.fliwright.mock.clearRoutes', _clearRoutes);
    registry.register('ext.fliwright.mock.listRoutes', _listRoutes);
    registry.register('ext.fliwright.mock.setPassthrough', _setPassthrough);
    registry.register('ext.fliwright.mock.getCalls', _getCalls);
    registry.register('ext.fliwright.mock.clearCalls', _clearCalls);
  }

  static Future<void> startServer({int port = 0}) async {
    if (_server != null) return;
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, port);
    _server!.listen(_handleRequest);
  }

  static Future<void> stopServer() async {
    final server = _server;
    _server = null;
    await server?.close(force: true);
  }

  static Future<void> reset() async {
    _routes.clear();
    _callLog.clear();
    _passthrough = false;
    await stopServer();
  }

  static Future<Map<String, dynamic>> _addRoute(Map<String, String> params) async {
    final routeJson = params['route'];
    if (routeJson == null || routeJson.isEmpty) {
      return {'error': 'Missing parameter: route'};
    }
    try {
      final decoded = jsonDecode(routeJson) as Map<String, dynamic>;
      final response = decoded['response'] as Map<String, dynamic>? ?? {};
      final route = MockRoute(
        id: decoded['id'] as String? ?? DateTime.now().millisecondsSinceEpoch.toString(),
        method: decoded['method'] as String?,
        pathPattern: decoded['path'] as String? ?? decoded['pathPattern'] as String? ?? '/',
        status: response['status'] as int? ?? 200,
        headers: (response['headers'] as Map<String, dynamic>?)?.map(
              (k, v) => MapEntry(k, v.toString()),
            ) ??
            {'Content-Type': 'application/json'},
        body: response['body'],
        delayMs: response['delay'] as int? ?? 0,
      );
      _routes.add(route);
      return {'success': true, 'id': route.id};
    } catch (e) {
      return {'error': 'Invalid route JSON: $e'};
    }
  }

  static Future<Map<String, dynamic>> _removeRoute(Map<String, String> params) async {
    final id = params['id'];
    final path = params['path'];
    if (id != null) {
      final removed = _routes.length;
      _routes.removeWhere((r) => r.id == id);
      return {'removed': removed != _routes.length};
    }
    if (path != null) {
      final removed = _routes.length;
      _routes.removeWhere((r) => r.pathPattern == path);
      return {'removed': removed != _routes.length};
    }
    return {'error': 'Missing parameter: id or path'};
  }

  static Future<Map<String, dynamic>> _clearRoutes(Map<String, String> params) async {
    final count = _routes.length;
    _routes.clear();
    return {'cleared': count};
  }

  static Future<Map<String, dynamic>> _listRoutes(Map<String, String> params) async {
    final routes = _routes
        .map((r) => {
              'id': r.id,
              'method': r.method,
              'path': r.pathPattern,
            })
        .toList();
    return {'routes': routes};
  }

  static Future<Map<String, dynamic>> _setPassthrough(Map<String, String> params) async {
    _passthrough = params['enabled'] == 'true';
    return {'passthrough': _passthrough};
  }

  static Future<Map<String, dynamic>> _getCalls(Map<String, String> params) async {
    final pathFilter = params['path'];
    var calls = _callLog.toList();
    if (pathFilter != null) {
      calls = calls.where((c) => c.path == pathFilter).toList();
    }
    return {'calls': calls.map((c) => c.toJson()).toList()};
  }

  static Future<Map<String, dynamic>> _clearCalls(Map<String, String> params) async {
    final count = _callLog.length;
    _callLog.clear();
    return {'cleared': count};
  }

  static Future<void> _handleRequest(HttpRequest request) async {
    final originalUrl = request.headers.value('x-original-url');
    final uri = originalUrl != null
        ? Uri.parse(originalUrl)
        : request.uri;

    // Read body once — HttpRequest is a single-subscription stream.
    String? requestBody;
    if (request.contentLength > 0) {
      requestBody = await utf8.decodeStream(request);
    }

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

    final route = _routes.cast<MockRoute?>().firstWhere(
          (r) => r!.matches(request.method, uri.path),
          orElse: () => null,
        );

    if (route != null) {
      await _respondWithRoute(request, route);
    } else if (_passthrough) {
      await _passthroughRequest(request, uri, requestBody);
    } else {
      request.response
        ..statusCode = 404
        ..headers.contentType = ContentType.json
        ..write(jsonEncode({'error': 'No matching route', 'path': uri.path}));
      await request.response.close();
    }
  }

  static Future<void> _respondWithRoute(HttpRequest request, MockRoute route) async {
    if (route.delayMs > 0) {
      await Future.delayed(Duration(milliseconds: route.delayMs));
    }
    final response = request.response;
    response.statusCode = route.status;
    // Set default Content-Type first, so route headers can override it.
    response.headers.contentType = ContentType.json;
    route.headers.forEach((key, value) {
      response.headers.set(key, value);
    });
    response.write(jsonEncode(route.body));
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
}

/// A concrete [HttpOverrides] that never uses a proxy.
/// Used by [_passthroughRequest] to bypass the global [FliwrightHttpOverrides]
/// and connect directly to the real upstream server.
class _NoProxyHttpOverrides extends HttpOverrides {
  @override
  String findProxyFromEnvironment(Uri url, Map<String, String>? environment) {
    return 'DIRECT';
  }
}
