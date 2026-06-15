import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge/src/extensions/inspect.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('InspectExtension enrichment', () {
    testWidgets(
        'extractWidgetInfo captures descendant text, tooltip, and keyed ancestors',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            key: const ValueKey('scaffoldKey'),
            body: GestureDetector(
              key: const ValueKey('tapTarget'),
              child: const Icon(Icons.add),
            ),
          ),
        ),
      );
      final element = tester.element(find.byKey(const ValueKey('tapTarget')));

      final info = InspectExtension.extractWidgetInfo(
        element,
        includeDescendantText: true,
        includeDescendantIcon: true,
        includeTooltip: true,
        includeKeyedAncestors: true,
      )!;

      expect(info['type'], 'GestureDetector');
      expect(info['descendantIcon'], isNotNull);
      expect((info['descendantIcon'] as Map)['codePoint'], Icons.add.codePoint);
      final ancestors = info['keyedAncestors'] as List;
      expect(ancestors.any((a) => a['key'] == 'scaffoldKey'), isTrue);
    });

    testWidgets('findDescendantText returns the inner Text of a wrapper',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
            home: Scaffold(body: GestureDetector(child: const Text('Login')))),
      );
      final element = tester.element(find.byType(GestureDetector));
      expect(InspectExtension.findDescendantText(element), 'Login');
    });
  });

  group('RecordingExtension', () {
    setUp(() async {
      await FliwrightBridge.reset();
    });

    test('registers startRecording and stopRecording on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.startRecording'));
      expect(methods, contains('ext.fliwright.stopRecording'));
    });

    test('registers hitTest extension on init', () async {
      await FliwrightBridge.init();
      expect(FliwrightBridge.registry.registeredMethods,
          contains('ext.fliwright.hitTest'));
    });

    test('startRecording returns recording=true', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry
          .invoke('ext.fliwright.startRecording', {});
      expect(result['recording'], isTrue);
    });

    test('stopRecording returns recording=false after start', () async {
      await FliwrightBridge.init();
      await FliwrightBridge.registry.invoke('ext.fliwright.startRecording', {});
      final result = await FliwrightBridge.registry
          .invoke('ext.fliwright.stopRecording', {});
      expect(result['recording'], isFalse);
    });

    test('hitTest returns widget map', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry
          .invoke('ext.fliwright.hitTest', {'x': '100', 'y': '200'});
      expect(result, contains('widget'));
    });
  });
}
