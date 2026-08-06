import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge/src/extensions/context.dart';

void main() {
  setUp(() async {
    await FliwrightBridge.reset();
  });

  tearDown(() async {
    await FliwrightBridge.reset();
  });

  test('init advertises timeline bridge capabilities', () async {
    await FliwrightBridge.initForDioMock();

    expect(
      FliwrightBridge.registry.registeredMethods,
      contains('ext.fliwright.context'),
    );
    final handshake = await FliwrightBridge.registry.invoke(
      'ext.fliwright.handshake',
      {'protocolVersion': '1'},
    );
    expect(handshake['debugMode'], isA<bool>());
    expect(handshake['profileMode'], isA<bool>());
    expect(handshake['releaseMode'], isA<bool>());
    final capabilities =
        handshake['bridgeCapabilities'] as Map<dynamic, dynamic>;
    expect(capabilities['timelineContext'], isTrue);
    expect(capabilities['captureFrame'], isTrue);
    expect(capabilities['query'], isTrue);
    expect(capabilities['keyboardState'], isTrue);
    expect(capabilities['keyboardDismiss'], isTrue);
  });

  testWidgets('context returns route and frame diagnostics', (tester) async {
    final registry = ExtensionRegistry();
    RouterNavigateExtension.register(registry);
    ContextExtension.register(registry);
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: TextField(
            key: Key('email'),
            decoration: InputDecoration(labelText: 'Email'),
          ),
        ),
      ),
    );

    final result = await registry.invoke('ext.fliwright.context', {});

    expect(result['route'], isA<Map>());
    expect(result['diagnostics'], isA<Map>());
    final capabilities = result['capabilities'] as Map<dynamic, dynamic>;
    expect(capabilities['timelineContext'], isTrue);
  });

  testWidgets('context reports the visible soft keyboard inset',
      (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.viewInsets = const FakeViewPadding(bottom: 280);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetViewInsets);

    final registry = ExtensionRegistry();
    RouterNavigateExtension.register(registry);
    ContextExtension.register(registry);
    await tester.pumpWidget(const MaterialApp(home: SizedBox.expand()));

    final result = await registry.invoke('ext.fliwright.context', {});

    expect(result['keyboard'], {
      'visible': true,
      'insetBottom': 280.0,
    });
    final capabilities = result['capabilities'] as Map<dynamic, dynamic>;
    expect(capabilities['keyboardState'], isTrue);
    expect(capabilities['keyboardDismiss'], isTrue);
  });
}
