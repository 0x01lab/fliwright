import 'dart:async';
import 'dart:typed_data';

import 'package:fliwright_design_qa/fliwright_design_qa.dart';
import 'package:test/test.dart';

void main() {
  test('pairs and sends a clean shake-triggered capture', () async {
    final transport = _RecordingTransport();
    final provider = _FakeScreenshotProvider(
      bytes: Uint8List.fromList(List<int>.generate(5, (index) => index + 1)),
    );
    final sdk = DesignQaSdk(
      transport: transport,
      screenshotProvider: provider,
      config: const DesignQaSdkConfig(chunkBytes: 2),
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
    transport.emit(
      designQaSerializeControl(designQaReadyMessage(sessionId: sdk.sessionId!)),
    );

    final result = await sdk.handleAccelerationSample(
      DesignQaAccelerationSample(
        x: 25,
        y: 0,
        z: 0,
        at: DateTime.utc(2026, 7, 16),
      ),
    );

    expect(result, isNotNull);
    expect(result!.chunkCount, 3);
    expect(provider.captureCount, 1);
    expect(transport.events.first, 'connect:room-1');
    expect(transport.events[1], contains('"type":"hello"'));
    expect(transport.events[2], contains('"type":"capture-start"'));
    expect(transport.events[3], 'binary:2');
    expect(transport.events[4], 'binary:2');
    expect(transport.events[5], 'binary:1');
    expect(transport.events[6], contains('"type":"capture-eof"'));
  });

  test('answers Figma hello and ping control frames', () async {
    final transport = _RecordingTransport(autoAcceptCaptures: false);
    final provider = _FakeScreenshotProvider(bytes: Uint8List.fromList([1]));
    final sdk = DesignQaSdk(transport: transport, screenshotProvider: provider);

    await sdk.pairFromQrPayload(
      '{"version":2,"signalingUrl":"wss://example.test/signaling",'
      '"roomId":"room-1","pairingSecret":"AQIDBAUGBwgJCgsMDQ4PEA",'
      '"iceConfigId":"team-default"}',
    );

    const figmaSessionId = 'figma-session';
    final figmaProof = designQaComputePairingProof(
      pairingSecret: 'AQIDBAUGBwgJCgsMDQ4PEA',
      sessionId: figmaSessionId,
      role: DesignQaPeerRole.figma,
    );
    transport.emit(
      designQaSerializeControl({
        'version': designQaProtocolVersion,
        'type': 'hello',
        'sessionId': figmaSessionId,
        'role': 'figma',
        'pairingProof': figmaProof,
        'capabilities': {
          'maxChunkBytes': designQaMaxChunkBytes,
          'maxCaptureBytes': designQaMaxCaptureBytes,
          'sha256': true,
        },
      }),
    );
    await Future<void>.delayed(Duration.zero);

    expect(transport.events.last, contains('"type":"ready"'));

    transport.emit(
      designQaSerializeControl({
        'version': designQaProtocolVersion,
        'type': 'ping',
        'sessionId': figmaSessionId,
        'sentAt': '2026-07-16T00:00:00Z',
      }),
    );
    await Future<void>.delayed(Duration.zero);

    expect(transport.events.last, contains('"type":"pong"'));
    expect(transport.events.last, contains('2026-07-16T00:00:00Z'));
  });

  test('does not capture when disabled', () async {
    final transport = _RecordingTransport();
    final provider = _FakeScreenshotProvider(bytes: Uint8List.fromList([1]));
    final sdk = DesignQaSdk(
      transport: transport,
      screenshotProvider: provider,
      config: const DesignQaSdkConfig(enabled: false),
    );

    await sdk.pairFromQrPayload(
      '{"version":2,"signalingUrl":"wss://example.test/signaling",'
      '"roomId":"room-1","pairingSecret":"AQIDBAUGBwgJCgsMDQ4PEA",'
      '"iceConfigId":"team-default"}',
    );

    final result = await sdk.captureAndSend();

    expect(result, isNull);
    expect(provider.captureCount, 0);
    expect(transport.events, isEmpty);
  });

  test('does not take a screenshot before the Figma peer is ready', () async {
    final transport = _RecordingTransport(autoAcceptCaptures: false);
    final provider = _FakeScreenshotProvider(bytes: Uint8List.fromList([1]));
    final sdk = DesignQaSdk(
      transport: transport,
      screenshotProvider: provider,
      config: const DesignQaSdkConfig(readyTimeout: Duration(milliseconds: 1)),
    );

    await sdk.pairFromQrPayload(
      '{"version":2,"signalingUrl":"wss://example.test/signaling",'
      '"roomId":"room-1","pairingSecret":"AQIDBAUGBwgJCgsMDQ4PEA",'
      '"iceConfigId":"team-default"}',
    );

    await expectLater(sdk.captureAndSend(), throwsA(isA<TimeoutException>()));
    expect(provider.captureCount, 0);
  });

  test('waits for Figma capture-complete before reporting success', () async {
    final transport = _RecordingTransport(autoCompleteCaptures: false);
    final provider = _FakeScreenshotProvider(bytes: Uint8List.fromList([1]));
    final sdk = DesignQaSdk(
      transport: transport,
      screenshotProvider: provider,
      config: const DesignQaSdkConfig(
        captureCompleteTimeout: Duration(milliseconds: 1),
      ),
    );

    await sdk.pairFromQrPayload(
      '{"version":2,"signalingUrl":"wss://example.test/signaling",'
      '"roomId":"room-1","pairingSecret":"AQIDBAUGBwgJCgsMDQ4PEA",'
      '"iceConfigId":"team-default"}',
    );
    transport.emit(
      designQaSerializeControl(designQaReadyMessage(sessionId: sdk.sessionId!)),
    );

    await expectLater(sdk.captureAndSend(), throwsA(isA<TimeoutException>()));
    expect(provider.captureCount, 1);
    expect(
      transport.events.any((event) => event.contains('"type":"capture-eof"')),
      isTrue,
    );
  });

  test('reconnects an established Figma session after a transport failure',
      () async {
    final transport = _RecordingTransport();
    final sdk = DesignQaSdk(
      transport: transport,
      screenshotProvider:
          _FakeScreenshotProvider(bytes: Uint8List.fromList([1])),
      config: const DesignQaSdkConfig(
        reconnectInitialDelay: Duration.zero,
        reconnectMaxDelay: Duration.zero,
      ),
    );

    await sdk.pairFromQrPayload(
      '{"version":2,"signalingUrl":"wss://example.test/signaling",'
      '"roomId":"room-1","pairingSecret":"AQIDBAUGBwgJCgsMDQ4PEA",'
      '"iceConfigId":"team-default"}',
    );

    transport.emitError(StateError('signaling socket closed'));
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);

    expect(transport.connectCount, 2);
    expect(transport.closeCount, 1);
    expect(sdk.isPaired, isTrue);
  });
}

class _RecordingTransport implements DesignQaTransport {
  _RecordingTransport({
    this.autoAcceptCaptures = true,
    this.autoCompleteCaptures = true,
  });

  final bool autoAcceptCaptures;
  final bool autoCompleteCaptures;
  final events = <String>[];
  final _controlController = StreamController<String>.broadcast();
  int connectCount = 0;
  int closeCount = 0;

  @override
  Stream<String> get controlMessages => _controlController.stream;

  void emit(String message) {
    _controlController.add(message);
  }

  void emitError(Object error) {
    _controlController.addError(error);
  }

  @override
  Future<void> close() async {
    closeCount += 1;
    events.add('close');
  }

  @override
  Future<void> connect(DesignQaPairingPayload payload) async {
    connectCount += 1;
    events.add('connect:${payload.roomId}');
  }

  @override
  Future<void> sendBinary(Uint8List bytes) async {
    events.add('binary:${bytes.length}');
  }

  @override
  Future<void> sendControl(String message) async {
    events.add(message);
    if (!autoAcceptCaptures) {
      return;
    }
    final decoded = designQaParseControl(message);
    if (decoded['type'] == 'capture-start') {
      emit(
        designQaSerializeControl({
          'version': designQaProtocolVersion,
          'type': 'capture-accept',
          'sessionId': decoded['sessionId'],
          'transferId': decoded['transferId'],
        }),
      );
    } else if (decoded['type'] == 'capture-eof' && autoCompleteCaptures) {
      emit(
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
  _FakeScreenshotProvider({required this.bytes});

  final Uint8List bytes;
  int captureCount = 0;

  @override
  Future<DesignQaCapture> capture() async {
    captureCount += 1;
    return DesignQaCapture(
      pngBytes: bytes,
      device: DesignQaDeviceContext(
        model: 'test-device',
        platform: 'ios',
        osVersion: '18.0',
        screenWidth: 390,
        screenHeight: 844,
        appVersionBuild: '1.0.0+1',
        capturedAt: DateTime.utc(2026, 7, 16),
      ),
    );
  }
}
