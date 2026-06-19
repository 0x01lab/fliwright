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
}
