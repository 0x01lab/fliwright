import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  group('FormExtractExtension', () {
    setUp(() async {
      await FliwrightBridge.reset();
    });

    test('registers ext.fliwright.extractForm on init', () async {
      await FliwrightBridge.init();
      expect(
        FliwrightBridge.registry.registeredMethods,
        contains('ext.fliwright.extractForm'),
      );
    });

    test('returns fields array and count', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.extractForm',
        {},
      );
      expect(result, contains('fields'));
      expect(result['fields'], isA<List>());
      expect(result, contains('count'));
    });

    test('returns empty fields when no EditableText in tree', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.extractForm',
        {},
      );
      expect(result['count'], equals(0));
      expect((result['fields'] as List).length, equals(0));
    });
  });
}
