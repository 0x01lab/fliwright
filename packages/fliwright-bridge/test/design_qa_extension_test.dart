import 'dart:async';
import 'dart:typed_data';

import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_design_qa/fliwright_design_qa.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('registers VM-service methods and exposes Design QA status', () async {
    final registry = ExtensionRegistry();
    final controller = _controller();

    FliwrightDesignQaExtension(controller: controller).register(registry);

    expect(
      registry.registeredMethods,
      containsAll(FliwrightDesignQaExtension.registeredMethods),
    );

    final status = await registry.invoke(
      FliwrightDesignQaExtension.statusMethod,
      {},
    );
    expect(status['success'], isTrue);
    expect((status['designQa'] as Map)['state'], 'idle');
  });

  test('returns diagnostics for a QR payload without pairing', () async {
    final registry = ExtensionRegistry();
    FliwrightDesignQaExtension(controller: _controller()).register(registry);

    final result = await registry.invoke(
      FliwrightDesignQaExtension.diagnosticsMethod,
      {
        'qrPayload':
            '{"version":2,"signalingUrl":"https://figma-gitlab.onrender.com/signaling",'
                '"roomId":"room-1","pairingSecret":"AQIDBAUGBwgJCgsMDQ4PEA",'
                '"iceConfigId":"team-default"}',
      },
    );

    expect(result['success'], isTrue);
    expect((result['pairing'] as Map)['roomId'], 'room-1');
    expect((result['signaling'] as Map)['host'], 'figma-gitlab.onrender.com');
    expect((result['signaling'] as Map)['secure'], isTrue);
  });

  test('pair reports a missing QR payload without throwing', () async {
    final registry = ExtensionRegistry();
    FliwrightDesignQaExtension(controller: _controller()).register(registry);

    final result = await registry.invoke(
      FliwrightDesignQaExtension.pairMethod,
      {},
    );

    expect(result['success'], isFalse);
    expect(result['error'], contains('qrPayload'));
  });

  test(
    'pairs, starts shake listening, and manually captures through VM-service methods',
    () async {
      final registry = ExtensionRegistry();
      final controller = _controller();
      FliwrightDesignQaExtension(controller: controller).register(registry);

      final paired =
          await registry.invoke(FliwrightDesignQaExtension.pairMethod, {
        'qrPayload':
            '{"version":2,"signalingUrl":"wss://example.test/signaling",'
                '"roomId":"room-1","pairingSecret":"AQIDBAUGBwgJCgsMDQ4PEA",'
                '"iceConfigId":"team-default"}',
      });
      final captured = await registry.invoke(
        FliwrightDesignQaExtension.captureMethod,
        {},
      );

      expect(paired['success'], isTrue);
      expect((paired['designQa'] as Map)['state'], 'listening');
      expect((paired['signaling'] as Map)['path'], '/signaling');
      expect(captured['success'], isTrue);
      expect((captured['result'] as Map)['totalBytes'], 3);
    },
  );

  testWidgets('opens pairing on the injected root navigator', (tester) async {
    await FliwrightBridge.reset();
    addTearDown(FliwrightBridge.reset);
    final navigatorKey = GlobalKey<NavigatorState>();
    await FliwrightBridge.initForDioMock(
      router: _RouterWithNavigatorKey(
        _RouterDelegateWithNavigatorKey(navigatorKey),
      ),
    );
    final registry = ExtensionRegistry();
    FliwrightDesignQaExtension(
      controller: _controller(),
      pairingPageBuilder: (_) => const Scaffold(
        body: Text('Design QA pairing page'),
      ),
    ).register(registry);

    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: navigatorKey,
        home: const Scaffold(body: Text('Exio host page')),
      ),
    );

    final result = await registry.invoke(
      FliwrightDesignQaExtension.openPairingMethod,
      const {},
    );
    await tester.pumpAndSettle();

    expect(result['success'], isTrue);
    expect(find.text('Design QA pairing page'), findsOneWidget);
  });
}

class _RouterWithNavigatorKey {
  const _RouterWithNavigatorKey(this.routerDelegate);

  final _RouterDelegateWithNavigatorKey routerDelegate;
}

class _RouterDelegateWithNavigatorKey {
  const _RouterDelegateWithNavigatorKey(this.navigatorKey);

  final GlobalKey<NavigatorState> navigatorKey;
}

DesignQaController _controller() {
  return DesignQaController(
    transport: _AcceptingTransport(),
    accelerationSamples: const Stream<DesignQaAccelerationSample>.empty(),
    config: DesignQaControllerConfig(
      screenshotProvider: _FakeScreenshotProvider(),
    ),
  );
}

class _AcceptingTransport implements DesignQaTransport {
  final _controlController = StreamController<String>.broadcast();

  @override
  Stream<String> get controlMessages => _controlController.stream;

  @override
  Future<void> close() async {
    await _controlController.close();
  }

  @override
  Future<void> connect(DesignQaPairingPayload payload) async {
    Future<void>.microtask(() {
      _controlController.add(
        designQaSerializeControl(
          designQaReadyMessage(sessionId: 'figma-session'),
        ),
      );
    });
  }

  @override
  Future<void> sendBinary(Uint8List bytes) async {}

  @override
  Future<void> sendControl(String message) async {
    final decoded = designQaParseControl(message);
    if (decoded['type'] == 'capture-start') {
      _controlController.add(
        designQaSerializeControl({
          'version': designQaProtocolVersion,
          'type': 'capture-accept',
          'sessionId': 'figma-session',
          'transferId': decoded['transferId'],
        }),
      );
    } else if (decoded['type'] == 'capture-eof') {
      _controlController.add(
        designQaSerializeControl({
          'version': designQaProtocolVersion,
          'type': 'capture-complete',
          'sessionId': 'figma-session',
          'transferId': decoded['transferId'],
        }),
      );
    }
  }
}

class _FakeScreenshotProvider implements DesignQaScreenshotProvider {
  @override
  Future<DesignQaCapture> capture() async {
    return DesignQaCapture(
      pngBytes: Uint8List.fromList([1, 2, 3]),
      device: DesignQaDeviceContext(
        model: 'test-device',
        platform: 'ios',
        osVersion: '18',
        screenWidth: 390,
        screenHeight: 844,
        appVersionBuild: '1',
        capturedAt: DateTime.utc(2026, 7, 16),
      ),
    );
  }
}
