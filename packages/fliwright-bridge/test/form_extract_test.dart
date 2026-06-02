import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  group('FormExtractExtension', () {
    setUp(() async {
      await FliwrightBridge.reset();
    });

    test('registers ext.fliwright.extractForm on init', () async {
      await FliwrightBridge.initForDioMock();
      expect(
        FliwrightBridge.registry.registeredMethods,
        contains('ext.fliwright.extractForm'),
      );
    });

    test('returns fields array and count', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await FliwrightBridge.initForDioMock();
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

    testWidgets('extracts stable metadata from ancestors and semantics',
        (tester) async {
      await FliwrightBridge.initForDioMock();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Semantics(
              identifier: 'login.email',
              label: 'Email address',
              child: Container(
                key: const ValueKey('emailContainer'),
                child: const TextField(
                  decoration: InputDecoration(
                    labelText: 'Username / Email',
                    hintText: 'Email',
                  ),
                ),
              ),
            ),
          ),
        ),
      );

      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.extractForm',
        {},
      );
      final fields = result['fields'] as List;
      expect(fields, hasLength(1));
      expect(fields.first, containsPair('ancestorKey', 'emailContainer'));
      expect(fields.first, containsPair('semanticsId', 'login.email'));
      expect(fields.first, containsPair('semanticsLabel', 'Email address'));
      expect(fields.first, containsPair('selector', 'semanticsId=login.email'));
    });
  });
}
