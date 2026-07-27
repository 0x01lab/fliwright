import 'dart:async';
import 'dart:typed_data';

import 'package:fliwright_design_qa/fliwright_design_qa.dart';
import 'package:test/test.dart';

void main() {
  test('pairs, starts shake listening, and reports capture results', () async {
    final samples = StreamController<DesignQaAccelerationSample>();
    final controller = DesignQaController(
      transport: _AcceptingTransport(),
      accelerationSamples: samples.stream,
      config: DesignQaControllerConfig(
        screenshotProvider: _FakeScreenshotProvider(),
        shakeDetector: DesignQaShakeDetector(
          thresholdGravity: 2,
          clock: () => DateTime.utc(2026, 7, 16),
        ),
      ),
    );

    final states = <DesignQaControllerSnapshot>[];
    final subscription = controller.states.listen(states.add);

    await controller.pairFromQrPayload(
      '{"version":2,"signalingUrl":"wss://example.test/signaling",'
      '"roomId":"room-1","pairingSecret":"AQIDBAUGBwgJCgsMDQ4PEA",'
      '"iceConfigId":"team-default"}',
    );

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

    expect(
      states.map((state) => state.state),
      contains(DesignQaControllerState.paired),
    );
    expect(
      states.map((state) => state.state),
      contains(DesignQaControllerState.listening),
    );
    expect(controller.snapshot.lastCapture?.totalBytes, 3);

    await controller.close();
    await subscription.cancel();
    await samples.close();
  });

  test('supports manual capture for host debug actions', () async {
    final feedback = _RecordingCaptureFeedback();
    final controller = DesignQaController(
      transport: _AcceptingTransport(),
      accelerationSamples: const Stream<DesignQaAccelerationSample>.empty(),
      config: DesignQaControllerConfig(
        autoStartShake: false,
        screenshotProvider: _FakeScreenshotProvider(),
        captureFeedback: feedback,
      ),
    );
    final states = <DesignQaControllerSnapshot>[];
    final subscription = controller.states.listen(states.add);

    await controller.pairFromQrPayload(
      '{"version":2,"signalingUrl":"wss://example.test/signaling",'
      '"roomId":"room-1","pairingSecret":"AQIDBAUGBwgJCgsMDQ4PEA",'
      '"iceConfigId":"team-default"}',
    );

    final result = await controller.captureNow();

    expect(result?.totalBytes, 3);
    expect(
      states.map((state) => state.state),
      contains(DesignQaControllerState.capturing),
    );
    expect(controller.snapshot.state, DesignQaControllerState.paired);
    expect(controller.snapshot.lastCapture?.totalBytes, 3);
    expect(feedback.captures, hasLength(1));
    expect(feedback.results, [same(result)]);

    await controller.close();
    await subscription.cancel();
  });

  test('notifies success after a shake-triggered transfer completes', () async {
    final samples = StreamController<DesignQaAccelerationSample>();
    final feedback = _RecordingCaptureFeedback();
    final controller = DesignQaController(
      transport: _AcceptingTransport(),
      accelerationSamples: samples.stream,
      config: DesignQaControllerConfig(
        screenshotProvider: _FakeScreenshotProvider(),
        shakeDetector: DesignQaShakeDetector(
          thresholdGravity: 2,
          clock: () => DateTime.utc(2026, 7, 16),
        ),
        captureFeedback: feedback,
      ),
    );

    await controller.pairFromQrPayload(
      '{"version":2,"signalingUrl":"wss://example.test/signaling",'
      '"roomId":"room-1","pairingSecret":"AQIDBAUGBwgJCgsMDQ4PEA",'
      '"iceConfigId":"team-default"}',
    );
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

    expect(feedback.captures, hasLength(1));
    expect(feedback.results, [same(controller.snapshot.lastCapture)]);

    await controller.close();
    await samples.close();
  });
}

class _RecordingCaptureFeedback implements DesignQaCaptureFeedback {
  final captures = <DesignQaCapture>[];
  final results = <DesignQaCaptureResult>[];

  @override
  void begin(DesignQaCapture capture) => captures.add(capture);

  @override
  void complete(DesignQaCaptureResult result) => results.add(result);

  @override
  void dismiss() {}
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
