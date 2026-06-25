import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/src/extension_registry.dart';
import 'package:fliwright_bridge/src/extensions/storage_reset.dart';

void main() {
  late ExtensionRegistry registry;

  setUp(() {
    StorageResetExtension.reset();
    registry = ExtensionRegistry();
    StorageResetExtension.register(registry);
  });

  tearDown(() {
    StorageResetExtension.reset();
  });

  test('is registered as ext.fliwright.storage.reset', () {
    expect(registry.isRegistered('ext.fliwright.storage.reset'), isTrue);
    expect(registry.registeredMethods, contains('ext.fliwright.storage.reset'));
  });

  group('when no host handler is registered', () {
    test('reports unsupported without throwing', () async {
      final result = await registry.invoke('ext.fliwright.storage.reset', {});

      expect(result['success'], false);
      expect(result['code'], 'unsupported');
      expect(result['action'], 'storage.reset');
      expect(result['recoveryHints'], isA<List>());
    });
  });

  group('with a host handler', () {
    test('invokes the handler with an empty seed and reports cleared counts',
        () async {
      var seenSeed = <String, Object?>{'__sentinel__': null};
      StorageResetExtension.setHandler((seed) async {
        seenSeed = seed;
        return {'clearedKeys': 7, 'seededKeys': 0};
      });

      final result = await registry.invoke('ext.fliwright.storage.reset', {});

      expect(result['success'], true);
      expect(result['action'], 'storage.reset');
      expect(result['clearedKeys'], 7);
      expect(result['seededKeys'], 0);
      expect(seenSeed, <String, Object?>{});
    });

    test('decodes the seed JSON object and forwards it to the handler',
        () async {
      Map<String, Object?>? capturedSeed;
      StorageResetExtension.setHandler((seed) async {
        capturedSeed = seed;
        return const {'clearedKeys': 3, 'seededKeys': 2};
      });

      final result = await registry.invoke('ext.fliwright.storage.reset', {
        'seed': '{"theme":"dark","attempts":3,"flag":true}',
      });

      expect(result['success'], true);
      expect(result['clearedKeys'], 3);
      expect(result['seededKeys'], 2);
      expect(capturedSeed, {
        'theme': 'dark',
        'attempts': 3,
        'flag': true,
      });
    });

    test('falls back to seed.length for seededKeys when handler omits it',
        () async {
      StorageResetExtension.setHandler((seed) async {
        return const {'clearedKeys': 1};
      });

      final result = await registry.invoke('ext.fliwright.storage.reset', {
        'seed': '{"a":1,"b":2}',
      });

      expect(result['success'], true);
      expect(result['seededKeys'], 2);
    });

    test('surfaces a handler failure as a normalized failure map', () async {
      StorageResetExtension.setHandler((seed) async {
        throw StateError('disk full');
      });

      final result = await registry.invoke('ext.fliwright.storage.reset', {});

      expect(result['success'], false);
      expect(result['code'], 'storage_reset_failed');
      expect(result['message'], contains('disk full'));
      expect(result['action'], 'storage.reset');
    });

    test('rejects a non-object seed with a FormatException failure', () async {
      StorageResetExtension.setHandler((seed) async {
        return const {};
      });

      final result = await registry.invoke('ext.fliwright.storage.reset', {
        'seed': '[1,2,3]',
      });

      expect(result['success'], false);
      expect(result['code'], 'storage_reset_failed');
      expect(result['message'], contains('JSON object'));
    });
  });

  test('hasHandler reflects setHandler / reset', () {
    expect(StorageResetExtension.hasHandler, isFalse);
    StorageResetExtension.setHandler((seed) async => null);
    expect(StorageResetExtension.hasHandler, isTrue);
    StorageResetExtension.reset();
    expect(StorageResetExtension.hasHandler, isFalse);
  });
}
