import 'dart:developer' as developer;

import 'package:dio/dio.dart';

import 'mock_server.dart';

/// A Dio [Interceptor] that matches outgoing requests against registered
/// [MockRoute]s and returns synthetic responses, bypassing the network.
///
/// This interceptor exists because fliwright's [MockServerExtension] uses
/// `HttpOverrides` to proxy `http://` traffic — which cannot intercept `https://`
/// requests. Apps that use Dio with HTTPS APIs should inject this interceptor
/// into their Dio instance instead.
///
/// **Default behaviour**: [passthrough] is `true`, meaning unmatched requests are
/// forwarded to the real server. Set to `false` to reject unmatched requests.
class FliwrightDioMockInterceptor extends Interceptor {
  FliwrightDioMockInterceptor({String? controllerUrl})
      : controllerUrl = controllerUrl ??
            const String.fromEnvironment('FLIWRIGHT_MOCK_CONTROLLER_URL');

  final List<MockRoute> routes = [];
  final List<MockCallRecord> callLog = [];

  /// When `true` (default), requests that don't match any route are forwarded
  /// to the real server. When `false`, unmatched requests are rejected with a
  /// 404 error response.
  bool passthrough = true;
  String? controllerUrl;

  void _log(String message) {
    developer.log(message, name: 'fliwright.mock.dio');
  }

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final requestPath =
        options.uri.path.isEmpty ? options.path : options.uri.path;
    _log('Incoming Dio ${options.method} $requestPath url=${options.uri}');
    final route = _matchRoute(options.method, requestPath);
    if (route == null) {
      if (passthrough) {
        _log(
            'No Dio route matched ${options.method} $requestPath; passthrough enabled');
        handler.next(options);
      } else {
        _log(
          'No Dio route matched ${options.method} $requestPath; returning 404. '
          'Registered routes: ${routes.map((r) => '${r.method ?? '*'} ${r.pathPattern}').join(', ')}',
        );
        handler.reject(
          DioException(
            requestOptions: options,
            response: Response<dynamic>(
              requestOptions: options,
              statusCode: 404,
              data: {'error': 'No matching mock route', 'path': requestPath},
            ),
            type: DioExceptionType.badResponse,
          ),
        );
      }
      return;
    }

    callLog.add(MockCallRecord(
      method: options.method,
      path: requestPath,
      headers: _extractHeaders(options.headers),
      body: _extractBody(options.data),
      timestamp: DateTime.now(),
    ));

    final controller = controllerUrl;
    if (controller != null && controller.isNotEmpty) {
      _forwardToController(options, requestPath, controller, handler);
      return;
    }

    // Build the mock response.
    final response = Response<dynamic>(
      requestOptions: options,
      statusCode: route.status,
      headers: Headers.fromMap(
        {
          for (final entry in route.headers.entries) entry.key: [entry.value]
        },
      ),
      data: route.body,
    );

    if (route.delayMs > 0) {
      _log(
          'Matched Dio route ${route.method ?? '*'} ${route.pathPattern} -> ${route.status}; delaying ${route.delayMs}ms');
      Future.delayed(Duration(milliseconds: route.delayMs), () {
        handler.resolve(response);
      });
    } else {
      _log(
          'Matched Dio route ${route.method ?? '*'} ${route.pathPattern} -> ${route.status}');
      handler.resolve(response);
    }
  }

  Future<void> _forwardToController(
    RequestOptions options,
    String requestPath,
    String controller,
    RequestInterceptorHandler handler,
  ) async {
    try {
      final client = Dio(BaseOptions(
        connectTimeout: const Duration(seconds: 5),
        receiveTimeout: const Duration(seconds: 30),
      ));
      final response = await client.post<Map<String, dynamic>>(
        '$controller/mock',
        data: {
          'method': options.method,
          'url': options.uri.toString(),
          'path': requestPath,
          'headers': _extractHeaders(options.headers),
          'body': options.data,
        },
        options: Options(headers: {'Content-Type': 'application/json'}),
      );
      final result = response.data ?? <String, dynamic>{};
      final matched = result['matched'] == true;
      final shouldPassthrough = result['passthrough'] == true;
      final diagnostics = _diagnosticsFromResult(result);
      if (!matched && shouldPassthrough) {
        _log(
            'Tool mock controller had no match for ${options.method} $requestPath; passthrough enabled$diagnostics');
        handler.next(options);
        return;
      }

      final status = result['status'] is int
          ? result['status'] as int
          : matched
              ? 200
              : 404;
      final headers = _headersFromResult(result['headers']);
      _log(
          'Tool mock controller returned ${matched ? 'match' : 'no match'} ${options.method} $requestPath -> $status$diagnostics');
      handler.resolve(Response<dynamic>(
        requestOptions: options,
        statusCode: status,
        headers: headers,
        data: result['body'],
      ));
    } catch (e) {
      if (passthrough) {
        _log(
            'Tool mock controller failed for ${options.method} $requestPath: $e; passthrough enabled');
        handler.next(options);
      } else {
        handler.reject(
          DioException(
            requestOptions: options,
            response: Response<dynamic>(
              requestOptions: options,
              statusCode: 503,
              data: {
                'error': 'Tool mock controller unavailable',
                'details': '$e'
              },
            ),
            type: DioExceptionType.badResponse,
          ),
        );
      }
    }
  }

  /// Find the first [MockRoute] that matches [method] and [path].
  MockRoute? _matchRoute(String method, String path) {
    for (final route in routes) {
      if (route.matches(method, path)) return route;
    }
    return null;
  }

  Map<String, String> _extractHeaders(Map<String, dynamic>? headers) {
    if (headers == null) return {};
    return headers.map((key, dynamic value) {
      if (value is List) {
        return MapEntry(key, value.join(', '));
      }
      return MapEntry(key, value.toString());
    });
  }

  String? _extractBody(Object? data) {
    if (data == null) return null;
    if (data is String) return data;
    return data.toString();
  }

  Headers _headersFromResult(Object? value) {
    if (value is! Map) return Headers();
    return Headers.fromMap(value.map((key, dynamic headerValue) {
      if (headerValue is List) {
        return MapEntry(key.toString(),
            headerValue.map((item) => item.toString()).toList());
      }
      return MapEntry(key.toString(), [headerValue.toString()]);
    }));
  }

  String _diagnosticsFromResult(Map<String, dynamic> result) {
    final parts = <String>[];
    final reason = result['reason'];
    if (reason is String && reason.isNotEmpty) {
      parts.add('reason=$reason');
    }
    final candidates = result['candidates'];
    if (candidates is List && candidates.isNotEmpty) {
      parts.add('candidates=${candidates.map((candidate) {
        if (candidate is Map) {
          final method = candidate['method']?.toString();
          final path = candidate['path']?.toString();
          return '${method == null || method.isEmpty ? '*' : method} ${path ?? '-'}';
        }
        return candidate.toString();
      }).join(', ')}');
    }
    return parts.isEmpty ? '' : ' (${parts.join('; ')})';
  }
}
