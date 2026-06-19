import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge/src/extensions/capture_frame.dart';
import 'package:fliwright_bridge/src/extensions/context.dart';
import 'package:fliwright_bridge/src/extensions/router_navigate.dart';
import 'package:fliwright_bridge/src/extensions/snap.dart';

void main() {
  testWidgets('captureFrame composes route snap and diagnostics', (
    tester,
  ) async {
    final registry = ExtensionRegistry();
    RouterNavigateExtension.register(registry);
    ContextExtension.register(registry);
    SnapExtension.register(registry);
    CaptureFrameExtension.register(registry);
    await tester.pumpWidget(
      const MaterialApp(home: Material(child: Text('Register'))),
    );

    final result = await registry.invoke('ext.fliwright.captureFrame', {
      'screenshot': 'false',
      'snapshot': 'true',
      'diagnostics': 'true',
    });

    expect(result['success'], isTrue);
    expect(result['frameId'], startsWith('frame-'));
    expect(result['capturedAt'], isA<String>());
    expect(result['route'], isA<Map>());
    expect(result['snap'], isA<Map>());
    expect(result['diagnostics'], isA<Map>());
  });

  testWidgets(
    'captureFrame captures screenshots without forcing a frame pump',
    (tester) async {
      final registry = ExtensionRegistry();
      final calls = <Map<String, String>>[];
      registry.register('ext.fliwright.context', (_) async => {});
      registry.register('ext.fliwright.screenshot', (params) async {
        calls.add(params);
        return {
          'success': true,
          'format': 'png',
          'screenshot': 'cG5n',
          'width': 100,
          'height': 200,
        };
      });
      registry.register('ext.fliwright.snap', (_) async => {});
      CaptureFrameExtension.register(registry);

      final result = await registry.invoke('ext.fliwright.captureFrame', {
        'screenshot': 'true',
        'snapshot': 'false',
        'diagnostics': 'false',
      });

      expect(result['success'], isTrue);
      expect(result['screenshot'], isA<Map>());
      expect(calls.single, {'pixelRatio': '1.0', 'waitForFrame': 'false'});
    },
  );
}
