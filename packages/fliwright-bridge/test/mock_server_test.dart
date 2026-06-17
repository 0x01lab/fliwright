import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:hive_ce_flutter/hive_flutter.dart';

void main() {
  group('MockRuleStore', () {
    test('adds, finds, replaces, removes, and clears routes', () async {
      final store = MockRuleStore();
      await store.addRoute(MockRoute(
        id: 'get-users-1',
        method: 'GET',
        pathPattern: '/api/users',
        status: 200,
        body: {'version': 1},
      ));
      await store.addRoute(MockRoute(
        id: 'get-users-2',
        method: 'GET',
        pathPattern: '/api/users',
        status: 201,
        body: {'version': 2},
      ));
      await store.addRoute(MockRoute(
        id: 'post-users',
        method: 'POST',
        pathPattern: '/api/users',
        status: 202,
      ));

      expect(store.getAllRoutes(), hasLength(2));
      expect(store.findRoute('GET', '/api/users')?.id, 'get-users-2');
      expect(store.findRoute('POST', '/api/users')?.id, 'post-users');
      expect(store.findRoute('DELETE', '/api/users'), isNull);

      expect(
          await store.removeRoute(path: '/api/users', method: 'GET'), isTrue);
      expect(store.findRoute('GET', '/api/users'), isNull);
      expect(store.findRoute('POST', '/api/users')?.id, 'post-users');

      expect(await store.clearRoutes(), 1);
      expect(store.getAllRoutes(), isEmpty);
    });

    test('persists and loads routes with FileMockRuleStorage', () async {
      final temp = await Directory.systemTemp.createTemp('fliwright_store_');
      final filePath = '${temp.path}/rules.json';
      try {
        final store = MockRuleStore(storage: FileMockRuleStorage(filePath));
        await store.addRoute(MockRoute(
          id: 'persisted',
          method: 'GET',
          pathPattern: '/api/persisted',
          status: 200,
          headers: {'Content-Type': 'application/json'},
          body: {'ok': true},
          delayMs: 5,
        ));

        final loaded = MockRuleStore(storage: FileMockRuleStorage(filePath));
        await loaded.loadFromStorage();
        final route = loaded.findRoute('GET', '/api/persisted');

        expect(route, isNotNull);
        expect(route!.id, 'persisted');
        expect(route.status, 200);
        expect(route.headers['Content-Type'], 'application/json');
        expect(route.body, {'ok': true});
        expect(route.delayMs, 5);
      } finally {
        await temp.delete(recursive: true);
      }
    });

    test('persists and loads routes with HiveMockRuleStorage', () async {
      final temp = await Directory.systemTemp.createTemp('fliwright_hive_');
      final boxName =
          'fliwright_mock_rules_${DateTime.now().microsecondsSinceEpoch}';
      try {
        Hive.init(temp.path);
        final box = await Hive.openBox<dynamic>(boxName);
        final storage = HiveMockRuleStorage.fromBox(box);
        final store = MockRuleStore(storage: storage);
        await store.addRoute(MockRoute(
          id: 'hive-route',
          method: 'POST',
          pathPattern: '/api/hive',
          status: 202,
          headers: {'Content-Type': 'application/json'},
          body: {
            'ok': true,
            'items': [1, 2, 3],
          },
          delayMs: 7,
        ));

        expect(storage.box.get(HiveMockRuleStorage.defaultVersionKey), 1);
        expect(storage.box.get(HiveMockRuleStorage.defaultRouteIndexKey), [
          'route:POST /api/hive',
        ]);
        final rawRoute = storage.box.get('route:POST /api/hive');
        expect(rawRoute, isA<Map>());
        final rawRouteMap =
            Map<dynamic, dynamic>.from(rawRoute as Map<dynamic, dynamic>);
        expect(rawRouteMap['id'], 'hive-route');
        expect(rawRouteMap['method'], 'POST');
        expect(rawRouteMap['pathPattern'], '/api/hive');
        expect(storage.box.get(HiveMockRuleStorage.legacyRulesKey), isNull);

        final loaded = MockRuleStore(storage: storage);
        await loaded.loadFromStorage();
        final route = loaded.findRoute('POST', '/api/hive');

        expect(route, isNotNull);
        expect(route!.id, 'hive-route');
        expect(route.status, 202);
        expect(route.body, {
          'ok': true,
          'items': [1, 2, 3],
        });
        expect(route.delayMs, 7);
      } finally {
        if (Hive.isBoxOpen(boxName)) {
          await Hive.box<dynamic>(boxName).close();
        }
        await temp.delete(recursive: true);
      }
    });

    test('clearRoutes clears persisted Hive routes from an empty memory store',
        () async {
      final temp = await Directory.systemTemp.createTemp('fliwright_hive_');
      final boxName =
          'fliwright_mock_rules_${DateTime.now().microsecondsSinceEpoch}';
      try {
        Hive.init(temp.path);
        final box = await Hive.openBox<dynamic>(boxName);
        final storage = HiveMockRuleStorage.fromBox(box);
        final writer = MockRuleStore(storage: storage);
        await writer.addRoute(MockRoute(
          id: 'cached-route',
          method: 'POST',
          pathPattern: '/api/cached',
          status: 202,
          body: {'cached': true},
        ));

        final emptyMemoryStore = MockRuleStore(storage: storage);
        final cleared = await emptyMemoryStore.clearRoutes();

        expect(cleared, 1);
        expect(storage.box.get(HiveMockRuleStorage.defaultRouteIndexKey), []);
        expect(storage.box.get('route:POST /api/cached'), isNull);

        final loaded = MockRuleStore(storage: storage);
        await loaded.loadFromStorage();
        expect(loaded.getAllRoutes(), isEmpty);
      } finally {
        if (Hive.isBoxOpen(boxName)) {
          await Hive.box<dynamic>(boxName).close();
        }
        await temp.delete(recursive: true);
      }
    });

    test('removeRoute removes persisted Hive route after rehydrating storage',
        () async {
      final temp = await Directory.systemTemp.createTemp('fliwright_hive_');
      final boxName =
          'fliwright_mock_rules_${DateTime.now().microsecondsSinceEpoch}';
      try {
        Hive.init(temp.path);
        final box = await Hive.openBox<dynamic>(boxName);
        final storage = HiveMockRuleStorage.fromBox(box);
        final writer = MockRuleStore(storage: storage);
        await writer.addRoute(MockRoute(
          id: 'cached-remove',
          method: 'POST',
          pathPattern: '/api/remove',
          status: 202,
        ));
        await writer.addRoute(MockRoute(
          id: 'cached-keep',
          method: 'GET',
          pathPattern: '/api/keep',
          status: 200,
        ));

        final emptyMemoryStore = MockRuleStore(storage: storage);
        final removed = await emptyMemoryStore.removeRoute(
          path: '/api/remove',
          method: 'POST',
        );

        expect(removed, isTrue);
        expect(storage.box.get('route:POST /api/remove'), isNull);
        expect(storage.box.get('route:GET /api/keep'), isNotNull);

        final loaded = MockRuleStore(storage: storage);
        await loaded.loadFromStorage();
        expect(loaded.findRoute('POST', '/api/remove'), isNull);
        expect(loaded.findRoute('GET', '/api/keep')?.id, 'cached-keep');
      } finally {
        if (Hive.isBoxOpen(boxName)) {
          await Hive.box<dynamic>(boxName).close();
        }
        await temp.delete(recursive: true);
      }
    });

    test('loads legacy Hive activeRules payload', () async {
      final temp =
          await Directory.systemTemp.createTemp('fliwright_hive_legacy_');
      final boxName =
          'fliwright_mock_rules_${DateTime.now().microsecondsSinceEpoch}';
      try {
        Hive.init(temp.path);
        final box = await Hive.openBox<dynamic>(boxName);
        await box.put(HiveMockRuleStorage.legacyRulesKey, {
          'version': 1,
          'rules': [
            {
              'id': 'legacy-route',
              'method': 'GET',
              'pathPattern': '/api/legacy',
              'status': 200,
              'headers': {'Content-Type': 'application/json'},
              'body': {'legacy': true},
              'delayMs': 0,
            },
          ],
        });
        final storage = HiveMockRuleStorage.fromBox(box);
        final loaded = MockRuleStore(storage: storage);
        await loaded.loadFromStorage();

        final route = loaded.findRoute('GET', '/api/legacy');
        expect(route, isNotNull);
        expect(route!.id, 'legacy-route');
        expect(route.body, {'legacy': true});
      } finally {
        if (Hive.isBoxOpen(boxName)) {
          await Hive.box<dynamic>(boxName).close();
        }
        await temp.delete(recursive: true);
      }
    });
  });

  group('MockServerExtension', () {
    setUp(() async {
      await FliwrightBridge.reset();
    });

    test('registers all 7 extensions on init', () async {
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

    test('addRoute accepts valid JSON route config', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'r1',
            'method': 'GET',
            'path': '/api/users',
            'response': {
              'status': 200,
              'body': {'users': []}
            },
          }),
        },
      );
      expect(result['success'], isTrue);
      expect(result['id'], 'r1');
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
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'r1',
            'method': 'GET',
            'path': '/api/users',
            'response': {},
          }),
        },
      );
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'r2',
            'method': 'POST',
            'path': '/api/items',
            'response': {},
          }),
        },
      );
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.listRoutes',
        {},
      );
      final routes = result['routes'] as List<dynamic>;
      expect(routes.length, 2);
      expect(routes[0]['id'], 'r1');
      expect(routes[1]['id'], 'r2');
    });

    test('clearRoutes removes all routes', () async {
      await FliwrightBridge.init();
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({'id': 'r1', 'path': '/a', 'response': {}})
        },
      );
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({'id': 'r2', 'path': '/b', 'response': {}})
        },
      );
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.clearRoutes',
        {},
      );
      expect(result['cleared'], 2);
      final listResult = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.listRoutes',
        {},
      );
      expect((listResult['routes'] as List<dynamic>).length, 0);
    });

    test('removeRoute removes by id', () async {
      await FliwrightBridge.init();
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({'id': 'r1', 'path': '/a', 'response': {}})
        },
      );
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({'id': 'r2', 'path': '/b', 'response': {}})
        },
      );
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.removeRoute',
        {'id': 'r1'},
      );
      expect(result['removed'], isTrue);
      final listResult = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.listRoutes',
        {},
      );
      final routes = listResult['routes'] as List<dynamic>;
      expect(routes.length, 1);
      expect(routes[0]['id'], 'r2');
    });

    test('removeRoute can remove only one method for a path', () async {
      await FliwrightBridge.init();
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'get-user',
            'method': 'GET',
            'path': '/api/user',
            'response': {}
          })
        },
      );
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'post-user',
            'method': 'POST',
            'path': '/api/user',
            'response': {}
          })
        },
      );

      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.removeRoute',
        {'path': '/api/user', 'method': 'GET'},
      );
      expect(result['removed'], isTrue);

      final listResult = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.listRoutes',
        {},
      );
      final routes = listResult['routes'] as List<dynamic>;
      expect(routes, hasLength(1));
      expect(routes.single['id'], 'post-user');
    });

    test('setPassthrough toggles behavior', () async {
      await FliwrightBridge.init();
      var result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.setPassthrough',
        {'enabled': 'true'},
      );
      expect(result['passthrough'], isTrue);
      result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.setPassthrough',
        {'enabled': 'false'},
      );
      expect(result['passthrough'], isFalse);
    });
  });

  group('MockServerExtension HTTP', () {
    setUp(() async {
      await FliwrightBridge.reset();
      await FliwrightBridge.init();
    });

    test('mock server responds to matching route', () async {
      final port = MockServerExtension.serverPort;
      expect(port, isNotNull);

      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'hello-route',
            'method': 'GET',
            'path': '/api/hello',
            'response': {
              'status': 200,
              'body': {'message': 'mocked'},
            },
          }),
        },
      );

      final client = HttpClient();
      try {
        final request = await client.get('127.0.0.1', port!, '/api/hello');
        final response = await request.close();
        expect(response.statusCode, 200);
        final body = await utf8.decoder.bind(response).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded, contains('message'));
        expect(decoded['message'], 'mocked');
      } finally {
        client.close();
      }
    });

    test('mock server returns 404 for unmatched route', () async {
      final port = MockServerExtension.serverPort;
      expect(port, isNotNull);

      final client = HttpClient();
      try {
        final request =
            await client.get('127.0.0.1', port!, '/api/nonexistent');
        final response = await request.close();
        expect(response.statusCode, 404);
        final body = await utf8.decoder.bind(response).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded, contains('error'));
        expect(decoded['path'], '/api/nonexistent');
      } finally {
        client.close();
      }
    });

    test('mock server records calls', () async {
      final port = MockServerExtension.serverPort;
      expect(port, isNotNull);

      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'ping-route',
            'method': 'GET',
            'path': '/api/ping',
            'response': {
              'status': 200,
              'body': {'pong': true},
            },
          }),
        },
      );

      final client = HttpClient();
      try {
        final request = await client.get('127.0.0.1', port!, '/api/ping');
        await request.close();
      } finally {
        client.close();
      }

      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.getCalls',
        {},
      );
      final calls = result['calls'] as List<dynamic>;
      expect(calls, isNotEmpty);
      final lastCall = calls.last as Map<String, dynamic>;
      expect(lastCall['path'], '/api/ping');
      expect(lastCall['method'], 'GET');
    });

    test('mock server records POST body (including chunked via proxy)',
        () async {
      final port = MockServerExtension.serverPort;
      expect(port, isNotNull);

      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'post-route',
            'method': 'POST',
            'path': '/api/data',
            'response': {
              'status': 201,
              'body': {'ok': true},
            },
          }),
        },
      );

      // Send directly to mock server (explicit Content-Length).
      final client = HttpClient();
      try {
        final request = await client.post('127.0.0.1', port!, '/api/data');
        request.headers.contentType = ContentType.json;
        request.write(jsonEncode({'key': 'value'}));
        final response = await request.close();
        expect(response.statusCode, 201);
      } finally {
        client.close();
      }

      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.getCalls',
        {'path': '/api/data'},
      );
      final calls = result['calls'] as List<dynamic>;
      expect(calls, hasLength(1));
      final call = calls.first as Map<String, dynamic>;
      expect(call['method'], 'POST');
      expect(call['path'], '/api/data');
      // Body must be captured (was null before the contentLength fix).
      expect(call['body'], isNotNull);
      final body = jsonDecode(call['body'] as String) as Map<String, dynamic>;
      expect(body['key'], 'value');
    });

    test('HttpOverrides redirects app HttpClient requests to mock server',
        () async {
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'override-route',
            'method': 'GET',
            'path': '/api/override',
            'response': {
              'status': 200,
              'body': {'source': 'override'},
            },
          }),
        },
      );

      final client = HttpClient();
      try {
        final request = await client.getUrl(
          Uri.parse('http://example.test/api/override?x=1'),
        );
        final response = await request.close();
        expect(response.statusCode, 200);
        final body = await utf8.decoder.bind(response).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded['source'], 'override');
      } finally {
        client.close();
      }

      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.getCalls',
        {'path': '/api/override'},
      );
      final calls = result['calls'] as List<dynamic>;
      expect(calls, isNotEmpty);
      expect(calls.last['path'], '/api/override');
    });

    test('HttpOverrides leaves unmocked app HttpClient requests direct',
        () async {
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'enabled-route',
            'method': 'GET',
            'path': '/api/enabled',
            'response': {},
          }),
        },
      );

      final target = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      target.listen((request) async {
        request.response
          ..statusCode = 204
          ..headers.contentType = ContentType.json;
        await request.response.close();
      });

      final client = HttpClient();
      try {
        final request = await client.getUrl(
          Uri.parse('http://127.0.0.1:${target.port}/api/live'),
        );
        final response = await request.close();
        expect(response.statusCode, 204);
      } finally {
        client.close();
        await target.close(force: true);
      }

      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.getCalls',
        {},
      );
      final calls = result['calls'] as List<dynamic>;
      expect(calls, isEmpty);
    });

    test('re-registering the same method and path replaces previous route',
        () async {
      final port = MockServerExtension.serverPort;
      expect(port, isNotNull);

      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'replace-route-1',
            'method': 'GET',
            'path': '/api/replace',
            'response': {
              'status': 200,
              'body': {'version': 1},
            },
          }),
        },
      );
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'replace-route-2',
            'method': 'GET',
            'path': '/api/replace',
            'response': {
              'status': 201,
              'body': {'version': 2},
            },
          }),
        },
      );

      final routesResult = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.listRoutes',
        {},
      );
      final routes = routesResult['routes'] as List<dynamic>;
      expect(routes, hasLength(1));
      expect(routes.first['id'], 'replace-route-2');

      final client = HttpClient();
      try {
        final request = await client.get('127.0.0.1', port!, '/api/replace');
        final response = await request.close();
        expect(response.statusCode, 201);
        final body = await utf8.decoder.bind(response).join();
        final decoded = jsonDecode(body) as Map<String, dynamic>;
        expect(decoded['version'], 2);
      } finally {
        client.close();
      }
    });
  });

  group('DioMockExtension', () {
    late FliwrightDioMockInterceptor interceptor;

    setUp(() async {
      await FliwrightBridge.reset();
      interceptor = FliwrightDioMockInterceptor();
      DioMockExtension.setInterceptor(interceptor);
      await FliwrightBridge.initForDioMock();
    });

    test('matches full Dio URL requests by URI path', () async {
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'dio-route',
            'method': 'POST',
            'path': '/api/register',
            'response': {
              'status': 200,
              'body': {'ok': true},
            },
          }),
        },
      );

      final dio = Dio()..interceptors.add(interceptor);
      final response = await dio.post<Map<String, dynamic>>(
        'http://api.example.com/api/register',
        data: {'name': 'Test'},
      );

      expect(response.statusCode, 200);
      expect(response.data?['ok'], isTrue);
      expect(interceptor.callLog, hasLength(1));
      expect(interceptor.callLog.single.path, '/api/register');
    });

    test('re-registering a Dio route replaces the previous response', () async {
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'dio-replace-1',
            'method': 'GET',
            'path': '/api/replace',
            'response': {
              'status': 200,
              'body': {'version': 1},
            },
          }),
        },
      );
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'dio-replace-2',
            'method': 'GET',
            'path': '/api/replace',
            'response': {
              'status': 202,
              'body': {'version': 2},
            },
          }),
        },
      );

      expect(interceptor.routes, hasLength(1));
      expect(interceptor.routes.single.id, 'dio-replace-2');

      final dio = Dio()..interceptors.add(interceptor);
      final response = await dio.get<Map<String, dynamic>>(
        'http://api.example.com/api/replace',
      );

      expect(response.statusCode, 202);
      expect(response.data?['version'], 2);
    });

    test('removeRoute can remove only one Dio method for a path', () async {
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'dio-get-user',
            'method': 'GET',
            'path': '/api/user',
            'response': {}
          }),
        },
      );
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'dio-post-user',
            'method': 'POST',
            'path': '/api/user',
            'response': {}
          }),
        },
      );

      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.removeRoute',
        {'path': '/api/user', 'method': 'GET'},
      );
      expect(result['removed'], isTrue);
      expect(interceptor.routes, hasLength(1));
      expect(interceptor.routes.single.id, 'dio-post-user');
    });

    test('newly injected Dio interceptor inherits registered routes', () async {
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'preserved-route',
            'method': 'GET',
            'path': '/api/preserved',
            'response': {
              'status': 200,
              'body': {'preserved': true},
            },
          }),
        },
      );

      final replacement = FliwrightDioMockInterceptor();
      DioMockExtension.setInterceptor(replacement);

      expect(replacement.routes, hasLength(1));
      expect(replacement.routes.single.id, 'preserved-route');

      final dio = Dio()..interceptors.add(replacement);
      final response = await dio.get<Map<String, dynamic>>(
        'https://dev.ex.io/api/preserved',
      );

      expect(response.statusCode, 200);
      expect(response.data?['preserved'], isTrue);
    });

    test('newly injected Dio interceptor replaces and neutralizes old entry',
        () async {
      final olderInterceptor = interceptor;
      final newerInterceptor = FliwrightDioMockInterceptor();
      DioMockExtension.setInterceptor(newerInterceptor);

      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'shared-route',
            'method': 'GET',
            'path': '/api/shared',
            'response': {
              'status': 200,
              'body': {'shared': true},
            },
          }),
        },
      );

      final newerDio = Dio()..interceptors.add(newerInterceptor);
      final newerResponse = await newerDio.get<Map<String, dynamic>>(
        'https://dev.ex.io/api/shared',
      );

      expect(olderInterceptor.routes, isEmpty);
      expect(olderInterceptor.passthrough, isTrue);
      expect(newerResponse.statusCode, 200);
      expect(newerResponse.data?['shared'], isTrue);
    });

    test('only the latest injected Dio interceptor receives routes after init',
        () async {
      await FliwrightBridge.reset();
      final firstInterceptor = FliwrightDioMockInterceptor();
      final secondInterceptor = FliwrightDioMockInterceptor();
      DioMockExtension.setInterceptor(firstInterceptor);
      DioMockExtension.setInterceptor(secondInterceptor);
      await FliwrightBridge.initForDioMock();

      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'post-init-route',
            'method': 'GET',
            'path': '/api/post-init',
            'response': {
              'status': 200,
              'body': {'postInit': true},
            },
          }),
        },
      );

      final secondDio = Dio()..interceptors.add(secondInterceptor);
      final secondResponse = await secondDio.get<Map<String, dynamic>>(
        'https://dev.ex.io/api/post-init',
      );

      expect(firstInterceptor.routes, isEmpty);
      expect(secondResponse.statusCode, 200);
      expect(secondResponse.data?['postInit'], isTrue);
    });

    test('getCalls and clearCalls use only the active Dio interceptor',
        () async {
      final secondInterceptor = FliwrightDioMockInterceptor();
      DioMockExtension.setInterceptor(secondInterceptor);

      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'aggregate-route',
            'method': 'GET',
            'path': '/api/aggregate',
            'response': {
              'status': 200,
              'body': {'ok': true},
            },
          }),
        },
      );

      await (Dio()..interceptors.add(secondInterceptor)).get<void>(
        'https://dev.ex.io/api/aggregate',
      );

      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.getCalls',
        {'path': '/api/aggregate'},
      );
      final calls = result['calls'] as List<dynamic>;
      expect(calls, hasLength(1));

      final clearResult = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.clearCalls',
        {},
      );
      expect(clearResult['cleared'], 1);
      expect(interceptor.callLog, isEmpty);
      expect(secondInterceptor.callLog, isEmpty);
    });

    test('setPassthrough applies only to the active Dio interceptor', () async {
      final secondInterceptor = FliwrightDioMockInterceptor();
      DioMockExtension.setInterceptor(secondInterceptor);

      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.setPassthrough',
        {'enabled': 'false'},
      );

      expect(interceptor.passthrough, isTrue);
      expect(secondInterceptor.passthrough, isFalse);
    });

    test('debugState reports a single active Dio interceptor', () async {
      DioMockExtension.setInterceptor(FliwrightDioMockInterceptor());

      final state = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.debugState',
        {},
      );

      expect(state['interceptorInjected'], isTrue);
      expect(state['interceptors'], 1);
      expect(state['interceptorState'], isA<Map<dynamic, dynamic>>());
      expect(state.containsKey('interceptorStates'), isFalse);
    });

    test('listRoutes resyncs a stale Dio interceptor store', () async {
      final staleStore = MockRuleStore();
      await staleStore.addRoute(MockRoute(
        id: 'stale-route',
        method: 'POST',
        pathPattern: '/api/v1/user/onboard/knowledge-test',
        status: 200,
        body: {'stale': true},
      ));
      interceptor.ruleStore = staleStore;

      final list = await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.listRoutes',
        {},
      );

      expect((list['routes'] as List<dynamic>), isEmpty);
      expect(interceptor.routes, isEmpty);

      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.setPassthrough',
        {'enabled': 'false'},
      );
      final dio = Dio()..interceptors.add(interceptor);
      await expectLater(
        dio.post<void>(
          'https://dev.ex.io/api/v1/user/onboard/knowledge-test',
        ),
        throwsA(isA<DioException>().having(
          (error) => error.response?.statusCode,
          'statusCode',
          404,
        )),
      );
    });

    test('unsetInterceptor neutralizes stale Dio interceptor routes', () async {
      final staleStore = MockRuleStore();
      await staleStore.addRoute(MockRoute(
        id: 'unset-stale-route',
        method: 'GET',
        pathPattern: '/api/unset-stale',
        status: 209,
        body: {'stale': true},
      ));
      final staleInterceptor =
          FliwrightDioMockInterceptor(ruleStore: staleStore);
      DioMockExtension.setInterceptor(staleInterceptor);
      staleInterceptor.ruleStore = staleStore;

      DioMockExtension.unsetInterceptor(staleInterceptor);

      expect(staleInterceptor.routes, isEmpty);
      expect(staleInterceptor.passthrough, isTrue);
    });

    test('Dio requests resolve directly from the in-process rule store',
        () async {
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {
          'route': jsonEncode({
            'id': 'tool-route',
            'method': 'GET',
            'path': '/api/tool',
            'response': {
              'status': 200,
              'body': {'fromStore': true},
            },
          }),
        },
      );

      final dio = Dio()..interceptors.add(interceptor);
      final response = await dio.get<Map<String, dynamic>>(
        'https://dev.ex.io/api/tool',
      );

      expect(response.statusCode, 200);
      expect(response.data?['fromStore'], isTrue);
    });

    test('unmocked Dio requests passthrough without controller forwarding',
        () async {
      final upstream = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      upstream.listen((request) async {
        request.response
          ..statusCode = 204
          ..headers.contentType = ContentType.json;
        await request.response.close();
      });

      try {
        await FliwrightBridge.registry.invoke(
          'ext.fliwright.mock.addRoute',
          {
            'route': jsonEncode({
              'id': 'only-enabled-route',
              'method': 'GET',
              'path': '/api/enabled',
              'response': {},
            }),
          },
        );

        final dio = Dio()..interceptors.add(interceptor);
        final response = await dio.get<void>(
          'http://127.0.0.1:${upstream.port}/api/live',
        );

        expect(response.statusCode, 204);
        expect(interceptor.callLog, isEmpty);
      } finally {
        await upstream.close(force: true);
      }
    });

    test('loads persisted Dio routes during initForDioMock', () async {
      await FliwrightBridge.reset();
      final temp = await Directory.systemTemp.createTemp('fliwright_mock_');
      final file = File('${temp.path}/active-rules.json');
      await file.writeAsString(jsonEncode({
        'version': 1,
        'rules': [
          {
            'id': 'persisted-route',
            'method': 'GET',
            'pathPattern': '/api/persisted',
            'status': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': {'persisted': true},
            'delayMs': 0,
          }
        ],
      }));
      final persistedInterceptor = FliwrightDioMockInterceptor();
      DioMockExtension.setInterceptor(persistedInterceptor);
      await FliwrightBridge.initForDioMock(
        mockStorage: FileMockRuleStorage(file.path),
      );

      try {
        final dio = Dio()..interceptors.add(persistedInterceptor);
        final response = await dio.get<Map<String, dynamic>>(
          'https://dev.ex.io/api/persisted',
        );

        expect(response.statusCode, 200);
        expect(response.data?['persisted'], isTrue);
        expect(persistedInterceptor.routes.single.id, 'persisted-route');
      } finally {
        await temp.delete(recursive: true);
      }
    });
  });
}
