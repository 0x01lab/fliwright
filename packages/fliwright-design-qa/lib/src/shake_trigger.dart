import 'dart:async';

import 'package:flutter/foundation.dart';

import 'design_qa_sdk.dart';
import 'protocol.dart';
import 'shake_detector.dart';
import 'transport.dart';

class DesignQaShakeTriggerBinding {
  DesignQaShakeTriggerBinding({
    required DesignQaSdk sdk,
    required Stream<DesignQaAccelerationSample> samples,
    void Function(DesignQaCapture capture)? onCaptureStarted,
    void Function(DesignQaCaptureResult result)? onCaptureResult,
    void Function(Object error, StackTrace stackTrace)? onError,
  })  : _sdk = sdk,
        _samples = samples,
        _onCaptureStarted = onCaptureStarted,
        _onCaptureResult = onCaptureResult,
        _onError = onError;

  final DesignQaSdk _sdk;
  final Stream<DesignQaAccelerationSample> _samples;
  final void Function(DesignQaCapture capture)? _onCaptureStarted;
  final void Function(DesignQaCaptureResult result)? _onCaptureResult;
  final void Function(Object error, StackTrace stackTrace)? _onError;
  StreamSubscription<DesignQaAccelerationSample>? _subscription;
  var _receivedSample = false;

  bool get isStarted => _subscription != null;

  void start() {
    if (_subscription != null) {
      return;
    }

    debugPrint('[Fliwright Design QA] Shake listener started.');
    _subscription = _samples.listen(
      (sample) {
        if (!_receivedSample) {
          _receivedSample = true;
          debugPrint('[Fliwright Design QA] Accelerometer stream is active.');
        }
        unawaited(
          _sdk
              .handleAccelerationSample(
            sample,
            onCaptured: _onCaptureStarted,
          )
              .then((result) {
            if (result != null) {
              debugPrint(
                '[Fliwright Design QA] Capture completed: '
                '${result.totalBytes} bytes in ${result.chunkCount} chunks.',
              );
              _onCaptureResult?.call(result);
            }
          }).catchError((Object error, StackTrace stackTrace) {
            debugPrint('[Fliwright Design QA] Shake capture failed: $error');
            _onError?.call(error, stackTrace);
            return null;
          }),
        );
      },
      onError: (Object error, StackTrace stackTrace) {
        debugPrint('[Fliwright Design QA] Accelerometer stream failed: $error');
        _onError?.call(error, stackTrace);
      },
    );
  }

  Future<void> stop() async {
    final subscription = _subscription;
    _subscription = null;
    await subscription?.cancel();
    debugPrint('[Fliwright Design QA] Shake listener stopped.');
  }
}
