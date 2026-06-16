import 'dart:convert';
import 'dart:io';

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

  factory MockRoute.fromJson(Map<String, dynamic> json) {
    return MockRoute(
      id: json['id'] as String? ??
          DateTime.now().microsecondsSinceEpoch.toString(),
      method: json['method'] as String?,
      pathPattern:
          json['pathPattern'] as String? ?? json['path'] as String? ?? '/',
      status: json['status'] as int? ?? 200,
      headers: (json['headers'] as Map<String, dynamic>?)
              ?.map((key, dynamic value) => MapEntry(key, value.toString())) ??
          const {},
      body: json['body'],
      delayMs: json['delayMs'] as int? ?? json['delay'] as int? ?? 0,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        if (method != null) 'method': method,
        'pathPattern': pathPattern,
        'status': status,
        'headers': headers,
        'body': body,
        'delayMs': delayMs,
      };

  bool matches(String method, String path) {
    if (this.method != null &&
        this.method!.toUpperCase() != method.toUpperCase()) {
      return false;
    }
    return matchesPath(path);
  }

  bool matchesPath(String path) {
    if (pathPattern.endsWith('/*')) {
      // '/api/*' matches '/api' and '/api/users', but not '/apiFoo'.
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

/// Pluggable persistence backend for mock route rules.
abstract class MockRuleStorage {
  Future<String?> load();
  Future<void> save(String json);
}

/// File-backed storage for Dart VM and desktop test environments.
class FileMockRuleStorage implements MockRuleStorage {
  final String filePath;

  FileMockRuleStorage(this.filePath);

  @override
  Future<String?> load() async {
    final file = File(filePath);
    if (!await file.exists()) return null;
    return file.readAsString();
  }

  @override
  Future<void> save(String json) async {
    final file = File(filePath);
    final parent = file.parent;
    if (!await parent.exists()) {
      await parent.create(recursive: true);
    }
    await file.writeAsString(json);
  }
}

/// In-process mock route table shared by VM Service extensions and interceptors.
class MockRuleStore {
  static int _nextDebugId = 1;

  final int debugId = _nextDebugId++;
  final Map<String, MockRoute> _routes = {};
  final MockRuleStorage? _storage;

  MockRuleStore({MockRuleStorage? storage}) : _storage = storage;

  MockRoute? findRoute(String method, String path) {
    for (final route in _routes.values) {
      if (route.matches(method, path)) return route;
    }
    return null;
  }

  bool shouldProxyPath(String path) {
    return _routes.values.any((route) => route.matchesPath(path));
  }

  Future<void> addRoute(MockRoute route) async {
    _routes[_routeKey(route.pathPattern, route.method)] = route;
    await _persist();
  }

  Future<bool> removeRoute({String? id, String? path, String? method}) async {
    await loadFromStorage();
    final before = _routes.length;
    if (id != null) {
      _routes.removeWhere((_, route) => route.id == id);
    } else if (path != null) {
      _routes.removeWhere((_, route) {
        if (route.pathPattern != path) return false;
        if (method == null) return true;
        return (route.method ?? '').toUpperCase() == method.toUpperCase();
      });
    }
    final removed = _routes.length != before;
    if (removed) await _persist();
    return removed;
  }

  Future<int> clearRoutes() async {
    await loadFromStorage();
    final count = _routes.length;
    _routes.clear();
    await _persist();
    return count;
  }

  List<MockRoute> getAllRoutes() => List.unmodifiable(_routes.values);

  Future<void> loadFromStorage() async {
    final storage = _storage;
    if (storage == null) return;
    final raw = await storage.load();
    if (raw == null || raw.trim().isEmpty) return;

    final decoded = decodeStoragePayload(raw);
    final rules = decoded['rules'];
    if (rules is! List) return;

    _routes.clear();
    for (final item in rules) {
      if (item is Map<String, dynamic>) {
        final route = MockRoute.fromJson(item);
        _routes[_routeKey(route.pathPattern, route.method)] = route;
      }
    }
  }

  Future<void> _persist() async {
    final storage = _storage;
    if (storage == null) return;
    await storage.save(encodeStoragePayload({
      'version': 1,
      'rules': _routes.values.map((route) => route.toJson()).toList(),
    }));
  }

  static Map<String, dynamic> decodeStoragePayload(Object value) {
    if (value is String) {
      final decoded = jsonDecode(value);
      if (decoded is Map<String, dynamic>) return decoded;
      if (decoded is Map) return _stringKeyedMap(decoded);
      return const {};
    }
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return _stringKeyedMap(value);
    return const {};
  }

  static String encodeStoragePayload(Object value) {
    return jsonEncode(_jsonSafe(value));
  }

  static Map<String, dynamic> _stringKeyedMap(Map<dynamic, dynamic> map) {
    return {
      for (final entry in map.entries)
        if (entry.key != null) entry.key.toString(): _jsonSafe(entry.value),
    };
  }

  static Object? _jsonSafe(Object? value) {
    if (value is Map) return _stringKeyedMap(value);
    if (value is List) return value.map(_jsonSafe).toList();
    return value;
  }

  String _routeKey(String path, String? method) {
    return '${(method ?? '*').toUpperCase()} $path';
  }
}
