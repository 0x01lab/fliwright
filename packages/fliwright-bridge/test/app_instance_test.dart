import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  setUp(() async {
    await FliwrightBridge.reset();
  });

  tearDown(() async {
    await FliwrightBridge.reset();
  });

  test(
    'init registers app instance extensions and advertises capability',
    () async {
      await FliwrightBridge.initForDioMock();

      expect(
        FliwrightBridge.registry.registeredMethods,
        containsAll([
          'ext.fliwright.app.info',
          'ext.fliwright.app.snapshot',
          'ext.fliwright.app.capabilities',
          'ext.fliwright.app.invoke',
        ]),
      );

      final handshake = await FliwrightBridge.registry.invoke(
        'ext.fliwright.handshake',
        {'protocolVersion': '1'},
      );
      final capabilities =
          handshake['bridgeCapabilities'] as Map<dynamic, dynamic>;
      expect(capabilities['appInstance'], isTrue);
      expect(capabilities['appCapabilities'], isTrue);
    },
  );

  test('app info and snapshot are generic and app-defined', () async {
    FliwrightAppInstance.configure(
      id: 'exio',
      name: 'Exio',
      environment: 'dev',
      snapshot: () => {
        'route': '/home',
        'auth': {'isAuthenticated': true, 'userId': 'u_1'},
        'featureFlags': {'newCheckout': true},
      },
    );
    FliwrightAppInstance.registerCapability(
      FliwrightAppCapability(
        name: 'auth',
        description: 'Authentication state',
        methods: {
          'getStatus': (_) => {'isAuthenticated': true},
        },
      ),
    );
    await FliwrightBridge.initForDioMock();

    final info = await FliwrightBridge.registry.invoke(
      'ext.fliwright.app.info',
      {},
    );
    expect(info['id'], 'exio');
    expect(info['name'], 'Exio');
    expect(info['environment'], 'dev');
    expect(info['capabilities'], contains('auth'));

    final snapshot = await FliwrightBridge.registry.invoke(
      'ext.fliwright.app.snapshot',
      {},
    );
    expect(snapshot['id'], 'exio');
    expect(snapshot['snapshot'], {
      'route': '/home',
      'auth': {'isAuthenticated': true, 'userId': 'u_1'},
      'featureFlags': {'newCheckout': true},
    });
  });

  test('capability descriptors and invocation use JSON input', () async {
    FliwrightAppInstance.registerCapability(
      FliwrightAppCapability(
        name: 'auth',
        description: 'Authentication state',
        methods: {
          'getStatus': (input) => {'isAuthenticated': true, 'input': input},
        },
      ),
    );
    await FliwrightBridge.initForDioMock();

    final capabilities = await FliwrightBridge.registry.invoke(
      'ext.fliwright.app.capabilities',
      {},
    );
    expect(capabilities['capabilities'], [
      {
        'name': 'auth',
        'description': 'Authentication state',
        'methods': ['getStatus'],
      },
    ]);

    final result = await FliwrightBridge.registry.invoke(
      'ext.fliwright.app.invoke',
      {
        'capability': 'auth',
        'method': 'getStatus',
        'input': jsonEncode({'refresh': true}),
      },
    );
    expect(result['success'], isTrue);
    expect(result['result'], {
      'isAuthenticated': true,
      'input': {'refresh': true},
    });
  });

  test(
    'invoke reports missing capability without throwing through registry',
    () async {
      await FliwrightBridge.initForDioMock();

      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.app.invoke',
        {'capability': 'auth', 'method': 'getStatus'},
      );

      expect(result['success'], isFalse);
      expect(result['error'], contains('Capability "auth" is not registered'));
    },
  );

  test('auth capability standardizes seeded login handlers', () async {
    final calls = <Object?>[];
    FliwrightAppInstance.registerCapability(
      FliwrightAuthCapability(
        seedLoggedIn: (input) {
          calls.add(input);
          return {
            'isAuthenticated': true,
            'userId': (input as Map)['userId'],
          };
        },
        clearSession: (_) => {'isAuthenticated': false},
      ),
    );
    await FliwrightBridge.initForDioMock();

    final capabilities = await FliwrightBridge.registry.invoke(
      'ext.fliwright.app.capabilities',
      {},
    );
    expect(capabilities['capabilities'], [
      {
        'name': 'auth',
        'description': 'Authentication test capability',
        'methods': ['seedLoggedIn', 'clearSession'],
      },
    ]);

    final seeded = await FliwrightBridge.registry.invoke(
      'ext.fliwright.app.invoke',
      {
        'capability': 'auth',
        'method': 'seedLoggedIn',
        'input': jsonEncode({'userId': 'u_1'}),
      },
    );

    expect(seeded['success'], isTrue);
    expect(seeded['result'], {'isAuthenticated': true, 'userId': 'u_1'});
    expect(calls, [
      {'userId': 'u_1'},
    ]);
  });

  test('auth capability requires at least one handler', () {
    expect(() => FliwrightAuthCapability(), throwsArgumentError);
  });
}
