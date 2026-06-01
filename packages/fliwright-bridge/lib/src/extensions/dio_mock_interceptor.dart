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
  final List<MockRoute> routes = [];
  final List<MockCallRecord> callLog = [];

  /// When `true` (default), requests that don't match any route are forwarded
  /// to the real server. When `false`, unmatched requests are rejected with a
  /// 404 error response.
  bool passthrough = true;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    // Record the call.
    callLog.add(MockCallRecord(
      method: options.method,
      path: options.path,
      headers: _extractHeaders(options.headers),
      body: _extractBody(options.data),
      timestamp: DateTime.now(),
    ));

    // Try to match a registered route.
    final route = _matchRoute(options.method, options.path);
    if (route == null) {
      if (passthrough) {
        handler.next(options);
      } else {
        handler.reject(
          DioException(
            requestOptions: options,
            response: Response<dynamic>(
              requestOptions: options,
              statusCode: 404,
              data: {'error': 'No matching mock route', 'path': options.path},
            ),
            type: DioExceptionType.badResponse,
          ),
        );
      }
      return;
    }

    // Build the mock response.
    final response = Response<dynamic>(
      requestOptions: options,
      statusCode: route.status,
      headers: Headers.fromMap(
        {for (final entry in route.headers.entries) entry.key: [entry.value]},
      ),
      data: route.body,
    );

    if (route.delayMs > 0) {
      Future.delayed(Duration(milliseconds: route.delayMs), () {
        handler.resolve(response);
      });
    } else {
      handler.resolve(response);
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
    return data.toString();
  }
}
