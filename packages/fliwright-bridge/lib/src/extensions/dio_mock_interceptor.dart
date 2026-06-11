import 'dart:developer' as developer;

import 'package:dio/dio.dart';

import 'mock_rule_store.dart';

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
  FliwrightDioMockInterceptor({MockRuleStore? ruleStore})
      : ruleStore = ruleStore ?? MockRuleStore();

  MockRuleStore ruleStore;
  final List<MockCallRecord> callLog = [];

  /// When `true` (default), requests that don't match any route are forwarded
  /// to the real server. When `false`, unmatched requests are rejected with a
  /// 404 error response.
  bool passthrough = true;

  List<MockRoute> get routes => ruleStore.getAllRoutes();

  void _log(String message) {
    developer.log(message, name: 'fliwright.mock.dio');
  }

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final requestPath =
        options.uri.path.isEmpty ? options.path : options.uri.path;
    _log('Incoming Dio ${options.method} $requestPath url=${options.uri}');
    final route = ruleStore.findRoute(options.method, requestPath);
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
}
