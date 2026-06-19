import 'dart:convert';

import 'mock_rule_store.dart';

Map<String, dynamic>? missingRouteParamResponse(Map<String, String> params) {
  final routeJson = params['route'];
  if (routeJson == null || routeJson.isEmpty) {
    return {'error': 'Missing parameter: route'};
  }
  return null;
}

MockRoute parseRouteParam(Map<String, String> params) {
  final routeJson = params['route'];
  if (routeJson == null || routeJson.isEmpty) {
    throw const FormatException('Missing parameter: route');
  }

  final decoded = jsonDecode(routeJson) as Map<String, dynamic>;
  final response = decoded['response'] as Map<String, dynamic>? ?? {};
  return MockRoute(
    id:
        decoded['id'] as String? ??
        DateTime.now().millisecondsSinceEpoch.toString(),
    method: decoded['method'] as String?,
    pathPattern:
        decoded['path'] as String? ?? decoded['pathPattern'] as String? ?? '/',
    status: response['status'] as int? ?? 200,
    headers:
        (response['headers'] as Map<String, dynamic>?)?.map(
          (key, value) => MapEntry(key, value.toString()),
        ) ??
        {'Content-Type': 'application/json'},
    body: response['body'],
    delayMs: response['delay'] as int? ?? 0,
  );
}

List<Map<String, dynamic>> routeSummaries(MockRuleStore store) {
  return store
      .getAllRoutes()
      .map((route) => routeSummary(route, includeStatus: false))
      .toList();
}

Map<String, dynamic> routeSummary(
  MockRoute route, {
  bool includeStatus = true,
}) {
  return {
    'id': route.id,
    'method': route.method,
    'path': route.pathPattern,
    if (includeStatus) 'status': route.status,
  };
}

List<MockCallRecord> filterCallsByPath(
  Iterable<MockCallRecord> calls,
  String? path,
) {
  final allCalls = calls.toList();
  if (path == null) return allCalls;
  return allCalls.where((call) => call.path == path).toList();
}
