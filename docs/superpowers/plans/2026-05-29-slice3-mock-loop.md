# Slice 3: Mock Loop — HTTP Interception & State Injection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable HTTP mock interception and Riverpod state injection so tests run fully independent of backend services.

**Architecture:** Dart-side `HttpServer` listens on localhost for intercepted requests. `HttpOverrides.global` redirects all `HttpClient`/Dio traffic to the mock server. TS-side `MockManager` syncs route rules via VM Service extensions. State injection reuses the existing `RiverpodExtension`.

**Tech Stack:** Dart (`dart:io` HttpServer, HttpOverrides), TypeScript (Vitest), VM Service JSON-RPC

---

## File Structure

### Dart Bridge — New Files

| File | Responsibility |
|------|---------------|
| `packages/fliwright-bridge/lib/src/extensions/mock_server.dart` | HTTP Mock Server, route matching, request recording, delay simulation |
| `packages/fliwright-bridge/lib/src/extensions/http_overrides.dart` | `FliwrightHttpOverrides` + `_MockHttpClient` that redirects to mock server |
| `packages/fliwright-bridge/test/mock_server_test.dart` | Unit tests for mock server extension |

### Dart Bridge — Modified Files

| File | Change |
|------|--------|
| `packages/fliwright-bridge/lib/fliwright_bridge.dart` | Export mock_server and http_overrides |
| `packages/fliwright-bridge/lib/src/bridge.dart` | Import and register `MockServerExtension`, start HttpOverrides in `init()` |
| `packages/fliwright-bridge/test/extension_registry_test.dart` | Add mock extension registration tests |

### TypeScript Core — New Files

| File | Responsibility |
|------|---------------|
| `packages/fliwright-core/src/MockManager.ts` | MockManager class with route/remove/clear/getCalls/setPassthrough |
| `packages/fliwright-core/tests/MockManager.test.ts` | Unit tests for MockManager |

### TypeScript Core — Modified Files

| File | Change |
|------|--------|
| `packages/fliwright-core/src/types.ts` | Add `MockRouteResponse`, `MockRouteConfig`, `MockCall` types |
| `packages/fliwright-core/src/Driver.ts` | Add `mock` and `state` getters |
| `packages/fliwright-core/src/index.ts` | Export new types and MockManager |

---

## Task 1: Dart Mock Server — Core Route Engine

**Files:**
- Create: `packages/fliwright-bridge/lib/src/extensions/mock_server.dart`
- Create: `packages/fliwright-bridge/test/mock_server_test.dart`

- [ ] **Step 1: Write failing test for MockServerExtension registration**

```dart
// packages/fliwright-bridge/test/mock_server_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  group('MockServerExtension', () {
    setUp(() {
      FliwrightBridge.reset();
    });

    test('registers mock extensions on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.mock.addRoute'));
      expect(methods, contains('ext.fliwright.mock.removeRoute'));
      expect(methods, contains('ext.fliwright.mock.clearRoutes'));
      expect(methods, contains('ext.fliwright.mock.listRoutes'));
      expect(methods, contains('ext.fliwright.mock.setPassthrough'));
      expect(methods, contains('ext.fliwright.mock.getCalls'));
      expect(methods, contains('ext.fliwright.mock.clearCalls'));
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-bridge && flutter test test/mock_server_test.dart`
Expected: FAIL — `MockServerExtension` not yet imported/registered

- [ ] **Step 3: Implement MockServerExtension**

```dart
// packages/fliwright-bridge/lib/src/extensions/mock_server.dart
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../extension_registry.dart';

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
    this.headers = const {'Content-Type': 'application/json'},
    this.body,
    this.delayMs = 0,
  });

  bool matches(String requestMethod, String requestPath) {
    if (method != null && method!.toUpperCase() != requestMethod.toUpperCase()) {
      return false;
    }
    return _pathMatches(pathPattern, requestPath);
  }

  static bool _pathMatches(String pattern, String path) {
    if (pattern == path) return true;
    if (pattern.endsWith('/*')) {
      final prefix = pattern.substring(0, pattern.length - 2);
      return path.startsWith(prefix);
    }
    return false;
  }
}

class MockCallRecord {
  final String method;
  final String path;
  final Map<String, String> headers;
  final String body;
  final String timestamp;

  MockCallRecord({
    required this.method,
    required this.path,
    required this.headers,
    required this.body,
    required this.timestamp,
  });

  Map<String, dynamic> toJson() => {
        'method': method,
        'path': path,
        'headers': headers,
        'body': body,
        'timestamp': timestamp,
      };
}

class MockServerExtension {
  static HttpServer? _server;
  static final List<MockRoute> _routes = [];
  static final List<MockCallRecord> _callLog = [];
  static bool _passthrough = false;
  static int _nextId = 1;

  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.mock.addRoute', _addRoute);
    registry.register('ext.fliwright.mock.removeRoute', _removeRoute);
    registry.register('ext.fliwright.mock.clearRoutes', _clearRoutes);
    registry.register('ext.fliwright.mock.listRoutes', _listRoutes);
    registry.register('ext.fliwright.mock.setPassthrough', _setPassthrough);
    registry.register('ext.fliwright.mock.getCalls', _getCalls);
    registry.register('ext.fliwright.mock.clearCalls', _clearCalls);
  }

  static Future<void> startServer({int port = 18080}) async {
    if (_server != null) return;
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, port);
    _server!.listen(_handleRequest);
  }

  static Future<void> stopServer() async {
    await _server?.close(force: true);
    _server = null;
  }

  static int? get serverPort => _server?.port;

  static Future<Map<String, dynamic>> _addRoute(Map<String, String> params) async {
    final routeJson = params['route'];
    if (routeJson == null || routeJson.isEmpty) {
      return {'error': 'Missing required parameter: route'};
    }

    try {
      final routeMap = jsonDecode(routeJson) as Map<String, dynamic>;
      final response = routeMap['response'] as Map<String, dynamic>? ?? {};

      final route = MockRoute(
        id: routeMap['id'] as String? ?? 'route_${_nextId++}',
        method: routeMap['method'] as String?,
        pathPattern: routeMap['path'] as String? ?? '/',
        status: response['status'] as int? ?? 200,
        headers: (response['headers'] as Map<String, dynamic>?)
                ?.map((k, v) => MapEntry(k, v.toString())) ??
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
    if (id == null && path == null) {
      return {'error': 'Must provide id or path'};
    }

    final initialLength = _routes.length;
    if (id != null) {
      _routes.removeWhere((r) => r.id == id);
    } else {
      _routes.removeWhere((r) => r.pathPattern == path);
    }
    final removed = _routes.length < initialLength;
    return {'success': true, 'removed': removed};
  }

  static Future<Map<String, dynamic>> _clearRoutes(Map<String, String> params) async {
    _routes.clear();
    return {'success': true};
  }

  static Future<Map<String, dynamic>> _listRoutes(Map<String, String> params) async {
    return {
      'routes': _routes
          .map((r) => {
                'id': r.id,
                'method': r.method,
                'path': r.pathPattern,
              })
          .toList(),
    };
  }

  static Future<Map<String, dynamic>> _setPassthrough(Map<String, String> params) async {
    _passthrough = params['enabled'] == 'true';
    return {'success': true, 'passthrough': _passthrough};
  }

  static Future<Map<String, dynamic>> _getCalls(Map<String, String> params) async {
    final pathFilter = params['path'];
    final calls = pathFilter != null
        ? _callLog.where((c) => c.path == pathFilter || MockRoute._pathMatches(pathFilter, c.path)).toList()
        : _callLog;
    return {
      'calls': calls.map((c) => c.toJson()).toList(),
    };
  }

  static Future<Map<String, dynamic>> _clearCalls(Map<String, String> params) async {
    _callLog.clear();
    return {'success': true};
  }

  static void _handleRequest(HttpRequest request) {
    final originalUrl = request.headers.value('X-Original-Url') ?? request.uri.toString();
    final path = Uri.parse(originalUrl).path;

    // Record the call
    String bodyStr = '';
    try {
      // We can't easily read body synchronously for recording, skip for now
    } catch (_) {}
    _callLog.add(MockCallRecord(
      method: request.method,
      path: path,
      headers: request.headers.toSimpleMap(),
      body: bodyStr,
      timestamp: DateTime.now().toUtc().toIso8601String(),
    ));

    // Find matching route
    MockRoute? matchedRoute;
    for (final route in _routes) {
      if (route.matches(request.method, path)) {
        matchedRoute = route;
        break;
      }
    }

    if (matchedRoute != null) {
      _respondWithRoute(request, matchedRoute);
    } else if (_passthrough) {
      _passthroughRequest(request, originalUrl);
    } else {
      request.response
        ..statusCode = 404
        ..write(jsonEncode({'error': 'No matching mock route', 'path': path}))
        ..close();
    }
  }

  static Future<void> _respondWithRoute(HttpRequest request, MockRoute route) async {
    if (route.delayMs > 0) {
      await Future.delayed(Duration(milliseconds: route.delayMs));
    }
    final response = request.response;
    response.statusCode = route.status;
    route.headers.forEach((k, v) => response.headers.set(k, v));
    response.write(jsonEncode(route.body));
    await response.close();
  }

  static Future<void> _passthroughRequest(HttpRequest request, String originalUrl) async {
    try {
      final uri = Uri.parse(originalUrl);
      final client = HttpClient();
      final proxyReq = await client.openUrl(request.method, uri);
      request.headers.forEach((name, values) {
        for (final v in values) {
          proxyReq.headers.set(name, v);
        }
      });
      final proxyResp = await proxyReq.close();
      request.response.statusCode = proxyResp.statusCode;
      proxyResp.headers.forEach((name, values) {
        for (final v in values) {
          request.response.headers.add(name, v);
        }
      });
      await proxyResp.pipe(request.response);
      client.close();
    } catch (e) {
      request.response
        ..statusCode = 502
        ..write(jsonEncode({'error': 'Passthrough failed: $e'}))
        ..close();
    }
  }

  static void reset() {
    _routes.clear();
    _callLog.clear();
    _passthrough = false;
    _nextId = 1;
  }
}
```

- [ ] **Step 4: Wire MockServerExtension into bridge.dart**

Update `packages/fliwright-bridge/lib/src/bridge.dart`:

```dart
import 'extension_registry.dart';
import 'extensions/gesture.dart';
import 'extensions/http_overrides.dart';
import 'extensions/inspect.dart';
import 'extensions/mock_server.dart';
import 'extensions/riverpod.dart';
import 'extensions/scroll_extension.dart';
import 'extensions/type_extension.dart';

export 'extension_registry.dart';

class FliwrightBridge {
  static final ExtensionRegistry _registry = ExtensionRegistry();
  static ExtensionRegistry get registry => _registry;
  static bool _initialized = false;

  static void reset() {
    _registry.reset();
    MockServerExtension.reset();
    _initialized = false;
  }

  static Future<void> init() async {
    if (_initialized) return;
    _initialized = true;

    _registry.register('ext.fliwright.ping', (params) async {
      return {'status': 'ok', 'timestamp': DateTime.now().toIso8601String()};
    });

    _registry.register('ext.fliwright.handshake', (params) async {
      final clientVersion = int.tryParse(params['protocolVersion'] ?? '0') ?? 0;
      return {
        'status': 'ok',
        'protocolVersion': 1,
        'clientVersion': clientVersion,
        'compatible': clientVersion <= 1,
      };
    });

    GestureExtension.register(_registry);
    InspectExtension.register(_registry);
    TypeExtension.register(_registry);
    ScrollExtension.register(_registry);
    RiverpodExtension.register(_registry);
    MockServerExtension.register(_registry);

    // Start mock HTTP server and install HttpOverrides
    await MockServerExtension.startServer();
    FliwrightHttpOverrides.install(port: MockServerExtension.serverPort!);
  }
}
```

Update `packages/fliwright-bridge/lib/fliwright_bridge.dart`:

```dart
library fliwright_bridge;
export 'src/bridge.dart';
export 'src/extensions/gesture.dart';
export 'src/extensions/mock_server.dart';
export 'src/extensions/http_overrides.dart';
```

- [ ] **Step 5: Create minimal http_overrides.dart placeholder**

```dart
// packages/fliwright-bridge/lib/src/extensions/http_overrides.dart
import 'dart:io';

class FliwrightHttpOverrides extends HttpOverrides {
  final String _mockHost;
  final int _mockPort;

  FliwrightHttpOverrides._(this._mockHost, this._mockPort);

  static void install({required int port}) {
    HttpOverrides.global = FliwrightHttpOverrides._('127.0.0.1', port);
  }

  @override
  HttpClient createHttpClient(SecurityContext? context) {
    final client = super.createHttpClient(context);
    return _MockHttpClient(client, _mockHost, _mockPort);
  }
}

class _MockHttpClient implements HttpClient {
  final HttpClient _inner;
  final String _mockHost;
  final int _mockPort;

  _MockHttpClient(this._inner, this._mockHost, this._mockPort);

  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) {
    final originalUrl = url.toString();
    final mockUri = Uri.http('$_mockHost:$_mockPort', url.path, url.queryParameters);
    return _inner.openUrl(method, mockUri).then((request) {
      request.headers.set('X-Original-Url', originalUrl);
      return request;
    });
  }

  @override
  Future<HttpClientRequest> open(String method, String host, int port, [String? path]) {
    return openUrl(method, Uri.http('$host:$port', path ?? '/'));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) {
    // Delegate all other methods to _inner via noSuchMethod
    return Function.apply(
      _inner.noSuchMethod as Function,
      [invocation],
    );
  }
}
```

**Note**: `_MockHttpClient` needs to properly implement `HttpClient`. Since `HttpClient` is abstract with many methods, we'll use `noSuchMethod` forwarding for methods we don't need to override. The critical override is `openUrl` which rewrites the URL. If `noSuchMethod` doesn't work for the abstract class, we'll switch to a wrapper pattern that delegates all methods explicitly.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-bridge && flutter test test/mock_server_test.dart`
Expected: PASS — all 7 mock extensions registered

- [ ] **Step 7: Add more failing tests for route matching**

Append to `packages/fliwright-bridge/test/mock_server_test.dart`:

```dart
    test('addRoute accepts valid route JSON', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'test_route',
            'method': 'GET',
            'path': '/api/users',
            'response': {
              'status': 200,
              'body': [{'name': 'Alice'}],
            },
          }),
        },
      );
      expect(result['success'], isTrue);
      expect(result['id'], 'test_route');
    });

    test('addRoute returns error for missing route param', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {},
      );
      expect(result, contains('error'));
    });

    test('listRoutes returns registered routes', () async {
      await FliwrightBridge.init();
      await FliwrightBridge.registry.invoke('ext.fliwright.mock.addRoute', {
        'route': jsonEncode({'path': '/api/test', 'response': {'body': 'ok'}}),
      });
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.listRoutes',
        {},
      );
      final routes = result['routes'] as List<dynamic>;
      expect(routes, isNotEmpty);
      expect((routes[0] as Map<String, dynamic>)['path'], '/api/test');
    });

    test('clearRoutes removes all routes', () async {
      await FliwrightBridge.init();
      await FliwrightBridge.registry.invoke('ext.fliwright.mock.addRoute', {
        'route': jsonEncode({'path': '/a', 'response': {}}),
      });
      await FliwrightBridge.registry.invoke('ext.fliwright.mock.clearRoutes', {});
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.listRoutes',
        {},
      );
      expect(result['routes'], isEmpty);
    });

    test('removeRoute removes by id', () async {
      await FliwrightBridge.init();
      await FliwrightBridge.registry.invoke('ext.fliwright.mock.addRoute', {
        'route': jsonEncode({'id': 'r1', 'path': '/x', 'response': {}}),
      });
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.removeRoute',
        {'id': 'r1'},
      );
      expect(result['success'], isTrue);
      expect(result['removed'], isTrue);
    });

    test('setPassthrough toggles behavior', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.setPassthrough',
        {'enabled': 'true'},
      );
      expect(result['success'], isTrue);
      expect(result['passthrough'], isTrue);
    });
```

Add the import at top of test file:
```dart
import 'dart:convert';
```

- [ ] **Step 8: Run all bridge tests**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-bridge && flutter test`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
cd /Volumes/HIKSEMI/project/fliwright
git add packages/fliwright-bridge/lib/src/extensions/mock_server.dart packages/fliwright-bridge/lib/src/extensions/http_overrides.dart packages/fliwright-bridge/lib/src/bridge.dart packages/fliwright-bridge/lib/fliwright_bridge.dart packages/fliwright-bridge/test/mock_server_test.dart
git commit -m "feat(bridge): add MockServerExtension — HTTP mock server with route matching"
```

---

## Task 2: Dart Mock Server — Integration Test with Real HTTP

**Files:**
- Modify: `packages/fliwright-bridge/test/mock_server_test.dart`

- [ ] **Step 1: Write failing test for real HTTP request interception**

Append to `packages/fliwright-bridge/test/mock_server_test.dart`:

```dart
  group('MockServerExtension HTTP', () {
    setUp(() {
      FliwrightBridge.reset();
    });

    test('mock server responds to matching route', () async {
      await FliwrightBridge.init();
      final port = MockServerExtension.serverPort!;

      // Register a route
      await FliwrightBridge.registry.invoke('ext.fliwright.mock.addRoute', {
        'route': jsonEncode({
          'path': '/api/hello',
          'method': 'GET',
          'response': {
            'status': 200,
            'body': {'message': 'mocked'},
          },
        }),
      });

      // Make a real HTTP request to the mock server
      final client = HttpClient();
      try {
        final request = await client.get('127.0.0.1', port, '/api/hello');
        final response = await request.close();
        final body = await response.transform(utf8.decoder).join();

        expect(response.statusCode, 200);
        expect(body, contains('mocked'));
      } finally {
        client.close();
      }
    });

    test('mock server returns 404 for unmatched route', () async {
      await FliwrightBridge.init();
      final port = MockServerExtension.serverPort!;

      final client = HttpClient();
      try {
        final request = await client.get('127.0.0.1', port, '/api/nonexistent');
        final response = await request.close();
        expect(response.statusCode, 404);
      } finally {
        client.close();
      }
    });

    test('mock server records calls', () async {
      await FliwrightBridge.init();
      final port = MockServerExtension.serverPort!;

      await FliwrightBridge.registry.invoke('ext.fliwright.mock.addRoute', {
        'route': jsonEncode({'path': '/api/ping', 'response': {'body': 'pong'}}),
      });

      final client = HttpClient();
      try {
        final request = await client.get('127.0.0.1', port, '/api/ping');
        await request.close();
      } finally {
        client.close();
      }

      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.getCalls',
        {'path': '/api/ping'},
      );
      final calls = result['calls'] as List<dynamic>;
      expect(calls, isNotEmpty);
      expect((calls[0] as Map<String, dynamic>)['path'], '/api/ping');
    });
  });
```

Add missing import at top:
```dart
import 'dart:convert';
import 'dart:io';
```

- [ ] **Step 2: Run test**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-bridge && flutter test test/mock_server_test.dart`
Expected: PASS — mock server responds to real HTTP requests

- [ ] **Step 3: Commit**

```bash
cd /Volumes/HIKSEMI/project/fliwright
git add packages/fliwright-bridge/test/mock_server_test.dart
git commit -m "test(bridge): add mock server HTTP integration tests"
```

---

## Task 3: TypeScript — Mock Types

**Files:**
- Modify: `packages/fliwright-core/src/types.ts`

- [ ] **Step 1: Write the types**

Add to `packages/fliwright-core/src/types.ts` after the `MockResponse` interface:

```typescript
export interface MockRouteResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  delay?: number;
}

export interface MockRouteConfig {
  id?: string;
  method?: string;
  path: string;
  response: MockRouteResponse;
}

export interface MockCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  timestamp: string;
}
```

- [ ] **Step 2: Update index.ts exports**

Add to `packages/fliwright-core/src/index.ts` in the types export block:

```typescript
export type {
  // ... existing exports ...
  MockRouteResponse,
  MockRouteConfig,
  MockCall,
} from './types.js';
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Volumes/HIKSEMI/project/fliwright
git add packages/fliwright-core/src/types.ts packages/fliwright-core/src/index.ts
git commit -m "feat(core): add MockRouteConfig, MockRouteResponse, MockCall types"
```

---

## Task 4: TypeScript — MockManager

**Files:**
- Create: `packages/fliwright-core/src/MockManager.ts`
- Create: `packages/fliwright-core/tests/MockManager.test.ts`

- [ ] **Step 1: Write failing test for MockManager**

```typescript
// packages/fliwright-core/tests/MockManager.test.ts
import { describe, it, expect, vi } from 'vitest';
import { MockManager } from '../src/MockManager.js';

function createMockSendRequest(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
    if (responses[method] !== undefined) return Promise.resolve(responses[method]);
    return Promise.resolve({});
  });
}

describe('MockManager', () => {
  it('route() sends addRoute to Dart via VM Service', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': { success: true, id: 'route_1' },
    });
    const mock = new MockManager(sendRequest);
    await mock.route('/api/login', { status: 200, body: { token: 'xxx' } });

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.addRoute', {
      route: expect.any(String),
    });
    const call = sendRequest.mock.calls[0][1] as { route: string };
    const parsed = JSON.parse(call.route);
    expect(parsed.path).toBe('/api/login');
    expect(parsed.response.status).toBe(200);
    expect(parsed.response.body).toEqual({ token: 'xxx' });
  });

  it('route() accepts method parameter', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': { success: true, id: 'route_2' },
    });
    const mock = new MockManager(sendRequest);
    await mock.route('/api/users', { method: 'GET', body: [] });

    const call = sendRequest.mock.calls[0][1] as { route: string };
    const parsed = JSON.parse(call.route);
    expect(parsed.method).toBe('GET');
  });

  it('route() accepts delay parameter', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': { success: true, id: 'route_3' },
    });
    const mock = new MockManager(sendRequest);
    await mock.route('/api/slow', { body: { ok: true }, delay: 2000 });

    const call = sendRequest.mock.calls[0][1] as { route: string };
    const parsed = JSON.parse(call.route);
    expect(parsed.response.delay).toBe(2000);
  });

  it('removeRoute() sends removeRoute to Dart', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.removeRoute': { success: true, removed: true },
    });
    const mock = new MockManager(sendRequest);
    await mock.removeRoute('/api/login');

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.removeRoute', {
      path: '/api/login',
    });
  });

  it('clear() sends clearRoutes to Dart', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.clearRoutes': { success: true },
    });
    const mock = new MockManager(sendRequest);
    await mock.clear();

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.clearRoutes', {});
  });

  it('setPassthrough() sends setPassthrough to Dart', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.setPassthrough': { success: true, passthrough: true },
    });
    const mock = new MockManager(sendRequest);
    await mock.setPassthrough(true);

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.setPassthrough', {
      enabled: 'true',
    });
  });

  it('getCalls() retrieves recorded calls from Dart', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.getCalls': {
        calls: [
          { method: 'POST', path: '/api/login', headers: {}, body: '', timestamp: '2026-05-29T00:00:00Z' },
        ],
      },
    });
    const mock = new MockManager(sendRequest);
    const calls = await mock.getCalls('/api/login');

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.getCalls', {
      path: '/api/login',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].path).toBe('/api/login');
  });

  it('getCalls() without filter returns all calls', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.getCalls': { calls: [] },
    });
    const mock = new MockManager(sendRequest);
    await mock.getCalls();

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.getCalls', {});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run tests/MockManager.test.ts`
Expected: FAIL — `MockManager` not found

- [ ] **Step 3: Implement MockManager**

```typescript
// packages/fliwright-core/src/MockManager.ts
import type { MockRouteResponse, MockCall } from './types.js';

type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export class MockManager {
  constructor(private sendRequest: SendRequest) {}

  async route(path: string, response: MockRouteResponse & { method?: string }): Promise<void> {
    const config = {
      path,
      method: response.method,
      response: {
        status: response.status,
        headers: response.headers,
        body: response.body,
        delay: response.delay,
      },
    };
    await this.sendRequest('ext.fliwright.mock.addRoute', {
      route: JSON.stringify(config),
    });
  }

  async removeRoute(path: string): Promise<void> {
    await this.sendRequest('ext.fliwright.mock.removeRoute', { path });
  }

  async clear(): Promise<void> {
    await this.sendRequest('ext.fliwright.mock.clearRoutes', {});
  }

  async setPassthrough(enabled: boolean): Promise<void> {
    await this.sendRequest('ext.fliwright.mock.setPassthrough', {
      enabled: String(enabled),
    });
  }

  async getCalls(path?: string): Promise<MockCall[]> {
    const params = path ? { path } : {};
    const result = (await this.sendRequest('ext.fliwright.mock.getCalls', params)) as {
      calls: MockCall[];
    };
    return result.calls ?? [];
  }
}
```

- [ ] **Step 4: Export MockManager from index.ts**

Add to `packages/fliwright-core/src/index.ts`:

```typescript
export { MockManager } from './MockManager.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run tests/MockManager.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
cd /Volumes/HIKSEMI/project/fliwright
git add packages/fliwright-core/src/MockManager.ts packages/fliwright-core/tests/MockManager.test.ts packages/fliwright-core/src/index.ts
git commit -m "feat(core): add MockManager — TS mock route management via VM Service"
```

---

## Task 5: TypeScript — Driver `mock` and `state` Getters

**Files:**
- Modify: `packages/fliwright-core/src/Driver.ts`
- Modify: `packages/fliwright-core/tests/Driver.test.ts`

- [ ] **Step 1: Write failing test for driver.mock and driver.state**

Append to `packages/fliwright-core/tests/Driver.test.ts`:

```typescript
import { MockManager } from '../src/MockManager.js';

// ... inside existing describe('FliwrightDriver') ...

  it('provides mock manager', async () => {
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(createMockWSForDriver());
    const mock = driver.mock;
    expect(mock).toBeInstanceOf(MockManager);
  });

  it('provides state adapter via convenience getter', async () => {
    const fakeAdapter: StateAdapter = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn(),
      watch: vi.fn().mockReturnValue(() => {}),
      listProviders: vi.fn().mockResolvedValue([]),
      override: vi.fn(),
    };
    const plugin: FliwrightPlugin = {
      name: 'riverpod',
      async onInit(ctx: PluginContext) {
        ctx.registerStateAdapter('riverpod', fakeAdapter);
      },
    };
    const driver = new FliwrightDriver({ plugins: [plugin] });
    await driver.attachMockConnector(createMockWSForDriver());
    const state = driver.state;
    expect(state).toBe(fakeAdapter);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run tests/Driver.test.ts`
Expected: FAIL — `mock` property does not exist on `FliwrightDriver`

- [ ] **Step 3: Add mock and state getters to Driver.ts**

```typescript
// Add import at top of Driver.ts
import { MockManager } from './MockManager.js';

// Add inside FliwrightDriver class, after the `page` getter:
  private _mock: MockManager | null = null;

  get mock(): MockManager {
    if (!this._mock) {
      this._mock = new MockManager((method, params) => this.connector.sendRequest(method, params));
    }
    return this._mock;
  }

  get state(): StateAdapter {
    return this.registry.getStateAdapter('riverpod');
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run tests/Driver.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run all core tests**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
cd /Volumes/HIKSEMI/project/fliwright
git add packages/fliwright-core/src/Driver.ts packages/fliwright-core/tests/Driver.test.ts
git commit -m "feat(core): add driver.mock and driver.state convenience getters"
```

---

## Task 6: Full Suite Smoke Test

**Files:**
- No new files — run all existing tests to verify no regressions

- [ ] **Step 1: Run all Dart bridge tests**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-bridge && flutter test`
Expected: ALL PASS

- [ ] **Step 2: Run all TypeScript core tests**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Run TypeScript type check**

Run: `cd /Volumes/HIKSEMI/project/fliwright/packages/fliwright-core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit final state if any lint fixes were needed**

```bash
cd /Volumes/HIKSEMI/project/fliwright
git add -A
git commit -m "chore: slice 3 iteration 3-A complete — mock server + mock manager + state getter"
```

---

## Spec Coverage Checklist

| Spec Section | Task |
|-------------|------|
| 1.1 Architecture (HttpServer in FliwrightBridge) | Task 1 |
| 1.2 Request Flow (match → respond/404) | Task 1 |
| 1.3 Route Rule Format | Task 1 |
| 1.4 VM Service Extensions (7 methods) | Task 1 |
| 1.5 Route Matching (exact + wildcard) | Task 1 |
| 1.6 Delay Simulation | Task 1 |
| 2.1 HttpOverrides.global | Task 1 |
| 2.2 FliwrightHttpOverrides implementation | Task 1 |
| 2.3 Request Rewriting (X-Original-Url) | Task 1 |
| 2.4 Dio compatibility (via HttpOverrides) | Task 1 |
| 2.5 Host Filtering (marked optional/deferred) | Out of scope |
| 3.1 TS Mock Manager API | Task 4 |
| 3.2 Route Sync Mechanism | Task 4 |
| 3.3 MockManager class structure | Task 4 |
| 3.4 Request Recording + getCalls | Task 2, Task 4 |
| 4.1 State Injection reuses Riverpod | Task 5 |
| 4.2 driver.state getter | Task 5 |
| 4.3 Driver extension (mock + state) | Task 5 |
| 5 Integration Test Demo | Task 2 (HTTP integration), Task 6 (full suite) |
