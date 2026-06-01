import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  group('SnapshotExtension', () {
    setUp(() async {
      await FliwrightBridge.reset();
    });

    tearDown(() async {
      await FliwrightBridge.reset();
    });

    test('registers ext.fliwright.snapshot on init', () async {
      await FliwrightBridge.init();
      expect(
        FliwrightBridge.registry.registeredMethods,
        contains('ext.fliwright.snapshot'),
      );
    });

    test('registers ext.fliwright.screenshot on init', () async {
      await FliwrightBridge.init();
      expect(
        FliwrightBridge.registry.registeredMethods,
        contains('ext.fliwright.screenshot'),
      );
    });

    test('returns widgets array from snapshot', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.snapshot',
        {},
      );
      expect(result, contains('widgets'));
      expect(result['widgets'], isA<List>());
    });

    test('returns a structured error when screenshot has no widget tree',
        () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.screenshot',
        {},
      );

      expect(result['success'], isFalse);
      expect(result, contains('error'));
    });
  });
}
