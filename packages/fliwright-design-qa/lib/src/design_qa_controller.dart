import 'dart:async';

import 'accelerometer_event_channel.dart';
import 'capture_success_indicator.dart';
import 'design_qa_sdk.dart';
import 'pairing.dart';
import 'protocol.dart';
import 'render_view_screenshot_provider.dart';
import 'shake_detector.dart';
import 'shake_trigger.dart';
import 'transport.dart';
import 'webrtc_transport.dart';

enum DesignQaControllerState {
  idle,
  paired,
  listening,
  capturing,
  error,
  closed,
}

class DesignQaControllerSnapshot {
  const DesignQaControllerSnapshot({
    required this.state,
    this.sessionId,
    this.lastCapture,
    this.error,
  });

  final DesignQaControllerState state;
  final String? sessionId;
  final DesignQaCaptureResult? lastCapture;
  final Object? error;
}

class DesignQaControllerConfig {
  const DesignQaControllerConfig({
    this.sdk = const DesignQaSdkConfig(),
    this.screenshotProvider = const DesignQaRenderViewScreenshotProvider(),
    this.shakeDetector,
    this.autoStartShake = true,
    this.captureFeedback,
  });

  final DesignQaSdkConfig sdk;
  final DesignQaScreenshotProvider screenshotProvider;
  final DesignQaShakeDetector? shakeDetector;
  final bool autoStartShake;
  final DesignQaCaptureFeedback? captureFeedback;
}

class DesignQaController {
  DesignQaController({
    required DesignQaTransport transport,
    required Stream<DesignQaAccelerationSample> accelerationSamples,
    DesignQaControllerConfig config = const DesignQaControllerConfig(),
  })  : _accelerationSamples = accelerationSamples,
        _autoStartShake = config.autoStartShake,
        _captureFeedback =
            config.captureFeedback ?? DesignQaCaptureSuccessIndicator(),
        _sdk = DesignQaSdk(
          transport: transport,
          screenshotProvider: config.screenshotProvider,
          config: config.sdk,
          shakeDetector: config.shakeDetector,
        );

  factory DesignQaController.withPlatformAdapters({
    DesignQaControllerConfig config = const DesignQaControllerConfig(),
    String peerKey = 'peerjs',
    List<Map<String, Object?>>? iceServers,
  }) {
    return DesignQaController(
      transport: DesignQaWebRtcTransport(
        peerKey: peerKey,
        iceServers: iceServers,
      ),
      accelerationSamples: const DesignQaAccelerometerEventChannel().samples,
      config: config,
    );
  }

  final Stream<DesignQaAccelerationSample> _accelerationSamples;
  final DesignQaSdk _sdk;
  final bool _autoStartShake;
  final DesignQaCaptureFeedback _captureFeedback;
  final _states = StreamController<DesignQaControllerSnapshot>.broadcast();
  DesignQaShakeTriggerBinding? _shakeBinding;
  DesignQaControllerSnapshot _snapshot = const DesignQaControllerSnapshot(
    state: DesignQaControllerState.idle,
  );

  Stream<DesignQaControllerSnapshot> get states => _states.stream;
  DesignQaControllerSnapshot get snapshot => _snapshot;
  DesignQaPairingPayload? get pairingPayload => _sdk.pairingPayload;
  DesignQaSdk get sdk => _sdk;

  Future<void> pairFromQrPayload(String rawPayload) async {
    try {
      await _sdk.pairFromQrPayload(rawPayload);
      _emit(
        DesignQaControllerSnapshot(
          state: DesignQaControllerState.paired,
          sessionId: _sdk.sessionId,
        ),
      );
      if (_autoStartShake) {
        startShakeCapture();
      }
    } catch (error) {
      _emitError(error);
      rethrow;
    }
  }

  void startShakeCapture() {
    if (!_sdk.isEnabled || !_sdk.isPaired) {
      return;
    }
    if (_shakeBinding != null) {
      return;
    }

    _shakeBinding = DesignQaShakeTriggerBinding(
      sdk: _sdk,
      samples: _accelerationSamples,
      onCaptureStarted: _notifyCaptureStarted,
      onCaptureResult: (result) {
        _emit(
          DesignQaControllerSnapshot(
            state: DesignQaControllerState.listening,
            sessionId: _sdk.sessionId,
            lastCapture: result,
          ),
        );
        _notifyCaptureSuccess(result);
      },
      onError: (error, _) {
        _captureFeedback.dismiss();
        _emitError(error);
      },
    );
    _shakeBinding?.start();
    _emitListening();
  }

  Future<DesignQaCaptureResult?> captureNow() async {
    if (!_sdk.isEnabled || !_sdk.isPaired) {
      return null;
    }

    _emit(
      DesignQaControllerSnapshot(
        state: DesignQaControllerState.capturing,
        sessionId: _sdk.sessionId,
        lastCapture: _snapshot.lastCapture,
      ),
    );

    try {
      final result = await _sdk.captureAndSend(
        onCaptured: _notifyCaptureStarted,
      );
      _emit(
        DesignQaControllerSnapshot(
          state: _shakeBinding == null
              ? DesignQaControllerState.paired
              : DesignQaControllerState.listening,
          sessionId: _sdk.sessionId,
          lastCapture: result ?? _snapshot.lastCapture,
        ),
      );
      if (result != null) {
        _notifyCaptureSuccess(result);
      }
      return result;
    } catch (error) {
      _captureFeedback.dismiss();
      _emitError(error);
      rethrow;
    }
  }

  Future<void> stopShakeCapture() async {
    final binding = _shakeBinding;
    _shakeBinding = null;
    await binding?.stop();
    if (_sdk.isPaired) {
      _emit(
        DesignQaControllerSnapshot(
          state: DesignQaControllerState.paired,
          sessionId: _sdk.sessionId,
        ),
      );
    }
  }

  Future<void> close() async {
    await stopShakeCapture();
    await _sdk.close();
    _captureFeedback.dismiss();
    _emit(
      const DesignQaControllerSnapshot(state: DesignQaControllerState.closed),
    );
    await _states.close();
  }

  void _emitListening() {
    _emit(
      DesignQaControllerSnapshot(
        state: DesignQaControllerState.listening,
        sessionId: _sdk.sessionId,
        lastCapture: _snapshot.lastCapture,
      ),
    );
  }

  void _emitError(Object error) {
    _emit(
      DesignQaControllerSnapshot(
        state: DesignQaControllerState.error,
        sessionId: _sdk.sessionId,
        lastCapture: _snapshot.lastCapture,
        error: error,
      ),
    );
  }

  void _notifyCaptureStarted(DesignQaCapture capture) {
    try {
      _captureFeedback.begin(capture);
    } catch (_) {
      // UI feedback must not change the outcome of a capture transfer.
    }
  }

  void _notifyCaptureSuccess(DesignQaCaptureResult result) {
    try {
      _captureFeedback.complete(result);
    } catch (_) {
      // UI feedback must not change the outcome of a confirmed transfer.
    }
  }

  void _emit(DesignQaControllerSnapshot snapshot) {
    _snapshot = snapshot;
    if (!_states.isClosed) {
      _states.add(snapshot);
    }
  }
}
