import 'dart:convert';

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
            'response': {'status': 200, 'body': {'users': []}},
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
        {'route': jsonEncode({'id': 'r1', 'path': '/a', 'response': {}})},
      );
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {'route': jsonEncode({'id': 'r2', 'path': '/b', 'response': {}})},
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
        {'route': jsonEncode({'id': 'r1', 'path': '/a', 'response': {}})},
      );
      await FliwrightBridge.registry.invoke(
        'ext.fliwright.mock.addRoute',
        {'route': jsonEncode({'id': 'r2', 'path': '/b', 'response': {}})},
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
}
