import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  group('ExtensionRegistry', () {
    late ExtensionRegistry registry;

    setUp(() { registry = ExtensionRegistry(); });

    test('registers and invokes a handler', () async {
      registry.register('ext.test.ping', (params) async {
        return {'echo': params['message'] ?? 'none'};
      });
      expect(registry.isRegistered('ext.test.ping'), isTrue);
      final result = await registry.invoke('ext.test.ping', {'message': 'hello'});
      expect(result, equals({'echo': 'hello'}));
    });

    test('throws when registering non-ext method', () {
      expect(() => registry.register('bad.method', (_) async => {}), throwsA(isA<ArgumentError>()));
    });

    test('throws when registering duplicate method', () {
      registry.register('ext.test.dup', (_) async => {});
      expect(() => registry.register('ext.test.dup', (_) async => {}), throwsA(isA<StateError>()));
    });

    test('throws when invoking unregistered method', () {
      expect(() => registry.invoke('ext.test.missing', {}), throwsA(isA<StateError>()));
    });

    test('lists registered methods', () {
      registry.register('ext.test.a', (_) async => {});
      registry.register('ext.test.b', (_) async => {});
      expect(registry.registeredMethods, containsAll(['ext.test.a', 'ext.test.b']));
    });
  });

  group('FliwrightBridge', () {
    setUp(() { FliwrightBridge.reset(); });

    test('init registers core extensions', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.ping'));
      expect(methods, contains('ext.fliwright.handshake'));
    });
  });

  group('RiverpodExtension', () {
    setUp(() { FliwrightBridge.reset(); });

    test('registers riverpod extensions on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.riverpod.list'));
      expect(methods, contains('ext.fliwright.riverpod.read'));
      expect(methods, contains('ext.fliwright.riverpod.override'));
      expect(methods, contains('ext.fliwright.riverpod.watch'));
      expect(methods, contains('ext.fliwright.riverpod.unwatch'));
    });

    test('read returns error when provider name is missing', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke('ext.fliwright.riverpod.read', {});
      expect(result, contains('error'));
    });

    test('watch returns error when provider name is missing', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke('ext.fliwright.riverpod.watch', {});
      expect(result, contains('error'));
    });
  });

  group('GestureExtension', () {
    setUp(() { FliwrightBridge.reset(); });

    test('registers click extension on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.click'));
    });

    test('click returns error when x or y is missing', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke('ext.fliwright.click', {});
      expect(result, contains('error'));
    });
  });

  group('InspectExtension', () {
    setUp(() { FliwrightBridge.reset(); });

    test('registers inspect extension on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.inspect'));
    });
  });

  group('TypeExtension', () {
    setUp(() { FliwrightBridge.reset(); });

    test('registers type extension on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.type'));
    });

    test('type returns error when selector is missing', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke('ext.fliwright.type', {});
      expect(result, contains('error'));
      expect(result['error'], contains('selector'));
    });

    test('type returns error when text is missing', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.type',
        {'selector': 'text=Hello'},
      );
      expect(result, contains('error'));
      expect(result['error'], contains('text'));
    });

    test('type returns error when no widget found', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.type',
        {'selector': 'text=NonExistent', 'text': 'hello'},
      );
      expect(result, contains('error'));
      expect(result['success'], isFalse);
    });
  });
}
