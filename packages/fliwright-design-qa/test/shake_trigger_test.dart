import 'dart:async';
import 'dart:typed_data';

import 'package:fliwright_design_qa/fliwright_design_qa.dart';
import 'package:test/test.dart';

void main() {
  test('binds acceleration samples to SDK captures', () async {
    final samples = StreamController<DesignQaAccelerationSample>();
    final provider = _FakeScreenshotProvider();
    final sdk = DesignQaSdk(
      transport: _AcceptingTransport(),
      screenshotProvider: provider,
      shakeDetector: DesignQaShakeDetector(
        thresholdGravity: 2,
        clock: () => DateTime.utc(2026, 7, 16),
      ),
    );
    await sdk.pairFromQrPayload(
      '{"version":2,"signalingUrl":"wss://example.test/signaling",'
      '"roomId":"room-1","pairingSecret":"AQIDBAUGBwgJCgsMDQ4PEA",'
      '"iceConfigId":"team-default"}',
    );

    final binding = DesignQaShakeTriggerBinding(
      sdk: sdk,
      samples: samples.stream,
    );
    binding.start();

    samples.add(
      DesignQaAccelerationSample(
        x: 25,
        y: 0,
        z: 0,
        at: DateTime.utc(2026, 7, 16),
      ),
    );
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);

    expect(binding.isStarted, isTrue);
    expect(provider.captureCount, 1);
    await binding.stop();
    expect(binding.isStarted, isFalse);
    await samples.close();
  });
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
          designQaReadyMessage(sessionId: 'mobile-session'),
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
          'sessionId': decoded['sessionId'],
          'transferId': decoded['transferId'],
        }),
      );
    } else if (decoded['type'] == 'capture-eof') {
      _controlController.add(
        designQaSerializeControl({
          'version': designQaProtocolVersion,
          'type': 'capture-complete',
          'sessionId': decoded['sessionId'],
          'transferId': decoded['transferId'],
        }),
      );
    }
  }
}

class _FakeScreenshotProvider implements DesignQaScreenshotProvider {
  int captureCount = 0;

  @override
  Future<DesignQaCapture> capture() async {
    captureCount += 1;
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
