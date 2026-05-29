import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  group('E2E Architecture Validation', () {
    setUp(() async {
      FliwrightBridge.reset();
      await FliwrightBridge.init();
    });

    test('handshake succeeds with compatible version', () async {
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.handshake',
        {'protocolVersion': '1'},
      );
      expect(result['status'], equals('ok'));
      expect(result['compatible'], isTrue);
    });

    test('ping returns ok status', () async {
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.ping',
        {},
      );
      expect(result['status'], equals('ok'));
      expect(result, contains('timestamp'));
    });

    test('riverpod list extension is registered and callable', () async {
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.riverpod.list',
        {},
      );
      // Without a ProviderScope the handler returns an error,
      // but the key point is that it IS registered and callable.
      expect(result, anyOf(
        contains('containerReady'),
        contains('error'),
      ));
    });

    test('riverpod read requires provider parameter', () async {
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.riverpod.read',
        {},
      );
      expect(result, contains('error'));
    });

    test('riverpod watch and unwatch flow', () async {
      // Without a ProviderScope, watch returns an error.
      // unwatch does NOT require a container, so it works directly.
      final watchResult = await FliwrightBridge.registry.invoke(
        'ext.fliwright.riverpod.watch',
        {'provider': 'counterProvider'},
      );
      // Watch returns error when no container is available
      expect(watchResult, contains('error'));

      // Unwatch works without a container — it just cleans up subscriptions
      final unwatchResult = await FliwrightBridge.registry.invoke(
        'ext.fliwright.riverpod.unwatch',
        {'provider': 'counterProvider'},
      );
      expect(unwatchResult['watching'], isFalse);
    });

    test('all expected extensions are registered', () async {
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, containsAll([
        'ext.fliwright.ping',
        'ext.fliwright.handshake',
        'ext.fliwright.riverpod.list',
        'ext.fliwright.riverpod.read',
        'ext.fliwright.riverpod.override',
        'ext.fliwright.riverpod.watch',
        'ext.fliwright.riverpod.unwatch',
      ]));
    });
  });
}
