import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
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

    test('forwards Dio requests to tool mock controller', () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final requests = <Map<String, dynamic>>[];
      server.listen((request) async {
        final body = await utf8.decoder.bind(request).join();
        requests.add(jsonDecode(body) as Map<String, dynamic>);
        request.response
          ..statusCode = 200
          ..headers.contentType = ContentType.json
          ..write(jsonEncode({
            'matched': true,
            'status': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': {'fromTool': true},
          }));
        await request.response.close();
      });

      try {
        await FliwrightBridge.registry.invoke(
          'ext.fliwright.mock.setController',
          {'url': 'http://127.0.0.1:${server.port}'},
        );

        final dio = Dio()..interceptors.add(interceptor);
        final response = await dio.get<Map<String, dynamic>>(
          'https://dev.ex.io/api/tool',
        );

        expect(response.statusCode, 200);
        expect(response.data?['fromTool'], isTrue);
        expect(requests, hasLength(1));
        expect(requests.single['method'], 'GET');
        expect(requests.single['path'], '/api/tool');
      } finally {
        await server.close(force: true);
      }
    });
  });
}
