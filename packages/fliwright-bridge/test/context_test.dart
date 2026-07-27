import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge/src/extensions/context.dart';
import 'package:fliwright_bridge/src/extensions/router_navigate.dart';

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
}
