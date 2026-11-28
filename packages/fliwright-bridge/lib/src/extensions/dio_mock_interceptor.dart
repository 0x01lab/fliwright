import 'dart:convert';
import 'dart:developer' as developer;

import 'package:dio/dio.dart';

import 'mock_rule_store.dart';

/// A Dio [Interceptor] that matches outgoing requests against registered
/// [MockRoute]s and records responses from both mocks and passthrough traffic.
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
  final Map<RequestOptions, MockCallRecord> _pendingCalls = {};

  /// When `true` (default), requests that don't match any route are forwarded
  /// to the real server. When `false`, unmatched requests are rejected with a
  /// 404 error response.
  bool passthrough = true;

  List<MockRoute> get routes => ruleStore.getAllRoutes();

  int get ruleStoreDebugId => ruleStore.debugId;

  void clearCalls() {
    callLog.clear();
    _pendingCalls.clear();
  }

  void _log(String message) {
    developer.log(message, name: 'fliwright.mock.dio');
  }

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final requestPath = options.uri.path.isEmpty
        ? options.path
        : options.uri.path;
    _log(
      'Incoming Dio ${options.method} $requestPath url=${options.uri} '
      'store=#${ruleStore.debugId} routes=${routes.length}',
    );
    final route = ruleStore.findRoute(options.method, requestPath);
    if (route == null) {
      if (passthrough) {
        final call = MockCallRecord(
          method: options.method,
          path: requestPath,
          url: options.uri.toString(),
          headers: _extractHeaders(options.headers),
          query: _extractQuery(options.uri),
          body: _extractBody(options.data),
          completed: false,
          timestamp: DateTime.now(),
          backend: 'dio',
        );
        callLog.add(call);
        _pendingCalls[options] = call;
        _log(
          'No Dio route matched ${options.method} $requestPath; '
          'passthrough enabled store=#${ruleStore.debugId} routes=${routes.length}',
        );
        handler.next(options);
      } else {
        _log(
          'No Dio route matched ${options.method} $requestPath; returning 404. '
          'store=#${ruleStore.debugId} Registered routes: ${routes.map((r) => '${r.method ?? '*'} ${r.pathPattern}').join(', ')}',
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

    final call = MockCallRecord(
      method: options.method,
      path: requestPath,
      url: options.uri.toString(),
      headers: _extractHeaders(options.headers),
      query: _extractQuery(options.uri),
      body: _extractBody(options.data),
      completed: false,
      timestamp: DateTime.now(),
      backend: 'dio',
    );
    callLog.add(call);

    final response = Response<dynamic>(
      requestOptions: options,
      statusCode: route.status,
      headers: Headers.fromMap({
        for (final entry in route.headers.entries) entry.key: [entry.value],
      }),
      data: route.body,
    );

    void resolveMockResponse() {
      call
        ..status = response.statusCode
        ..response = response.data
        ..completed = true;
      handler.resolve(response);
    }

    if (route.delayMs > 0) {
      _log(
        'Matched Dio route ${route.method ?? '*'} ${route.pathPattern} -> ${route.status}; '
        'delaying ${route.delayMs}ms store=#${ruleStore.debugId} routes=${routes.length}',
      );
      Future<void>.delayed(Duration(milliseconds: route.delayMs), resolveMockResponse);
    } else {
      _log(
        'Matched Dio route ${route.method ?? '*'} ${route.pathPattern} -> ${route.status} '
        'store=#${ruleStore.debugId} routes=${routes.length}',
      );
      resolveMockResponse();
    }
  }

  @override
  void onResponse(
      Response<dynamic> response, ResponseInterceptorHandler handler) {
    final call = _pendingCalls.remove(response.requestOptions);
    if (call != null) {
      call
        ..status = response.statusCode
        ..response = response.data
        ..completed = true;
    }
    handler.next(response);
  }

  @override
  void onError(DioException error, ErrorInterceptorHandler handler) {
    final call = _pendingCalls.remove(error.requestOptions);
    if (call != null) {
      call
        ..status = error.response?.statusCode
        ..response = error.response?.data
        ..error =
            error.response == null ? error.message ?? error.type.name : null
        ..completed = true;
    }
    handler.next(error);
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
    try {
      return jsonEncode(data);
    } on JsonUnsupportedObjectError {
      return data.toString();
    }
  }

  Map<String, dynamic> _extractQuery(Uri uri) => {
    for (final entry in uri.queryParametersAll.entries)
      entry.key: entry.value.length == 1 ? entry.value.first : entry.value,
  };
}
