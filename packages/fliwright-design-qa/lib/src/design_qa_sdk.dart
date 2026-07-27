import 'dart:async';

import 'package:flutter/foundation.dart';

import 'pairing.dart';
import 'protocol.dart';
import 'shake_detector.dart';
import 'transport.dart';

enum DesignQaTrigger { shake }

class DesignQaSdkConfig {
  const DesignQaSdkConfig({
    this.enabled = kDebugMode || kProfileMode,
    this.trigger = DesignQaTrigger.shake,
    this.chunkBytes = designQaMaxChunkBytes,
    this.readyTimeout = const Duration(seconds: 10),
    this.captureAcceptTimeout = const Duration(seconds: 10),
    this.captureCompleteTimeout = const Duration(seconds: 30),
    this.reconnectEnabled = true,
    this.reconnectInitialDelay = const Duration(seconds: 1),
    this.reconnectMaxDelay = const Duration(seconds: 30),
  });

  final bool enabled;
  final DesignQaTrigger trigger;
  final int chunkBytes;
  final Duration readyTimeout;
  final Duration captureAcceptTimeout;
  final Duration captureCompleteTimeout;
  final bool reconnectEnabled;
  final Duration reconnectInitialDelay;
  final Duration reconnectMaxDelay;
}

class DesignQaSdk {
  DesignQaSdk({
    required DesignQaTransport transport,
    required DesignQaScreenshotProvider screenshotProvider,
    DesignQaSdkConfig config = const DesignQaSdkConfig(),
    DesignQaShakeDetector? shakeDetector,
  })  : _transport = transport,
        _screenshotProvider = screenshotProvider,
        _config = config,
        _shakeDetector = shakeDetector ?? DesignQaShakeDetector();

  final DesignQaTransport _transport;
  final DesignQaScreenshotProvider _screenshotProvider;
  final DesignQaSdkConfig _config;
  final DesignQaShakeDetector _shakeDetector;

  DesignQaPairingPayload? _pairingPayload;
  String? _sessionId;
  StreamSubscription<String>? _controlSubscription;
  Completer<void>? _readyCompleter;
  Completer<void>? _captureAcceptCompleter;
  Completer<void>? _captureCompleteCompleter;
  String? _pendingTransferId;
  bool _captureInProgress = false;
  Timer? _reconnectTimer;
  int _reconnectAttempt = 0;
  bool _transportConnected = false;
  bool _reconnectInProgress = false;
  bool _isClosing = false;

  bool get isEnabled => _config.enabled;
  bool get isPaired => _pairingPayload != null;
  bool get isReady => _readyCompleter?.isCompleted ?? false;
  DesignQaPairingPayload? get pairingPayload => _pairingPayload;
  String? get sessionId => _sessionId;

  Future<void> pairFromQrPayload(String rawPayload) async {
    if (!isEnabled) {
      return;
    }

    final payload = DesignQaPairingPayload.parse(rawPayload);
    debugPrint(
      '[Fliwright Design QA] Connecting to Figma room ${payload.roomId}.',
    );
    _cancelReconnect();
    _reconnectAttempt = 0;
    if (_transportConnected) {
      _isClosing = true;
      _transportConnected = false;
      await _transport.close();
      _isClosing = false;
    }
    _pairingPayload = payload;
    await _controlSubscription?.cancel();
    _controlSubscription = _transport.controlMessages.listen(
      _handleControl,
      onError: _handleTransportError,
    );
    await _openTransportSession(payload);
  }

  Future<void> _openTransportSession(DesignQaPairingPayload payload) async {
    final sessionId = designQaGenerateId();
    _sessionId = sessionId;
    _readyCompleter = Completer<void>();
    _transportConnected = false;
    await _transport.connect(payload);
    _transportConnected = true;
    debugPrint(
      '[Fliwright Design QA] WebRTC DataChannel opened; sending pairing hello.',
    );

    final proof = designQaComputePairingProof(
      pairingSecret: payload.pairingSecret,
      sessionId: sessionId,
      role: DesignQaPeerRole.mobile,
    );

    await _transport.sendControl(
      designQaSerializeControl(
        designQaHelloMessage(sessionId: sessionId, pairingProof: proof),
      ),
    );
    debugPrint('[Fliwright Design QA] Waiting for Figma ready handshake.');
  }

  Future<DesignQaCaptureResult?> handleAccelerationSample(
    DesignQaAccelerationSample sample, {
    void Function(DesignQaCapture capture)? onCaptured,
  }) async {
    if (!isEnabled || _config.trigger != DesignQaTrigger.shake) {
      return null;
    }

    if (!_shakeDetector.addSample(sample)) {
      return null;
    }

    debugPrint(
      '[Fliwright Design QA] Shake detected at '
      '${(sample.magnitude / 9.80665).toStringAsFixed(2)} g.',
    );
    return captureAndSend(onCaptured: onCaptured);
  }

  Future<DesignQaCaptureResult?> captureAndSend({
    void Function(DesignQaCapture capture)? onCaptured,
  }) async {
    if (!isEnabled || !isPaired || _captureInProgress) {
      return null;
    }

    final sessionId = _sessionId;
    if (sessionId == null) {
      return null;
    }

    _captureInProgress = true;
    try {
      debugPrint(
          '[Fliwright Design QA] Waiting for Figma ready before capture.');
      await _waitForReady();

      final capture = await _screenshotProvider.capture();
      debugPrint(
        '[Fliwright Design QA] Screenshot captured: '
        '${capture.pngBytes.length} PNG bytes.',
      );
      onCaptured?.call(capture);
      final chunks = designQaChunkBytes(
        capture.pngBytes,
        chunkBytes: _config.chunkBytes,
      );
      final transferId = designQaGenerateId();
      final sha256Hex = designQaSha256Hex(capture.pngBytes);

      _pendingTransferId = transferId;
      _captureAcceptCompleter = Completer<void>();
      _captureCompleteCompleter = Completer<void>();

      await _transport.sendControl(
        designQaSerializeControl(
          designQaCaptureStartMessage(
            sessionId: sessionId,
            transferId: transferId,
            capture: capture,
            chunkBytes: _config.chunkBytes,
          ),
        ),
      );
      debugPrint(
          '[Fliwright Design QA] Capture request sent; waiting for accept.');

      await _waitForCaptureAccept(transferId);
      debugPrint(
          '[Fliwright Design QA] Figma accepted capture; sending chunks.');

      for (final chunk in chunks) {
        await _transport.sendBinary(chunk);
      }

      await _transport.sendControl(
        designQaSerializeControl(
          designQaCaptureEofMessage(
            sessionId: sessionId,
            transferId: transferId,
            bytes: capture.pngBytes,
            chunkBytes: _config.chunkBytes,
          ),
        ),
      );
      debugPrint(
          '[Fliwright Design QA] Capture EOF sent; waiting for completion.');

      await _waitForCaptureComplete(transferId);
      debugPrint('[Fliwright Design QA] Figma confirmed capture completion.');

      return DesignQaCaptureResult(
        sessionId: sessionId,
        transferId: transferId,
        totalBytes: capture.pngBytes.length,
        chunkCount: chunks.length,
        sha256: sha256Hex,
      );
    } catch (error) {
      debugPrint('[Fliwright Design QA] Capture failed: $error');
      rethrow;
    } finally {
      _pendingTransferId = null;
      _captureAcceptCompleter = null;
      _captureCompleteCompleter = null;
      _captureInProgress = false;
    }
  }

  Future<void> close() async {
    _isClosing = true;
    _cancelReconnect();
    _transportConnected = false;
    _pairingPayload = null;
    _sessionId = null;
    await _controlSubscription?.cancel();
    _controlSubscription = null;
    _readyCompleter = null;
    _captureAcceptCompleter = null;
    _captureCompleteCompleter = null;
    _pendingTransferId = null;
    _shakeDetector.reset();
    try {
      await _transport.close();
    } finally {
      _isClosing = false;
    }
  }

  void _handleTransportError(Object error, StackTrace stackTrace) {
    debugPrint('[Fliwright Design QA] Transport connection lost: $error');
    if (_isClosing || _reconnectInProgress || !_transportConnected) {
      return;
    }

    _transportConnected = false;
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (!_config.reconnectEnabled ||
        _pairingPayload == null ||
        _reconnectTimer != null) {
      return;
    }

    final delay = _nextReconnectDelay();
    debugPrint(
      '[Fliwright Design QA] Reconnecting to Figma in ${delay.inSeconds}s.',
    );
    _reconnectTimer = Timer(delay, () {
      _reconnectTimer = null;
      unawaited(_reconnect());
    });
  }

  Future<void> _reconnect() async {
    final payload = _pairingPayload;
    if (payload == null || _isClosing) {
      return;
    }

    _reconnectInProgress = true;
    try {
      await _transport.close();
      await _openTransportSession(payload);
      _reconnectAttempt = 0;
      debugPrint('[Fliwright Design QA] Reconnected to Figma.');
    } catch (error) {
      debugPrint('[Fliwright Design QA] Figma reconnect failed: $error');
      _scheduleReconnect();
    } finally {
      _reconnectInProgress = false;
    }
  }

  Duration _nextReconnectDelay() {
    final exponent = _reconnectAttempt > 5 ? 5 : _reconnectAttempt;
    final multiplier = 1 << exponent;
    _reconnectAttempt += 1;
    final delay = Duration(
      microseconds: _config.reconnectInitialDelay.inMicroseconds * multiplier,
    );
    return delay > _config.reconnectMaxDelay
        ? _config.reconnectMaxDelay
        : delay;
  }

  void _cancelReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
  }

  Future<void> _waitForReady() async {
    final readyCompleter = _readyCompleter;
    if (readyCompleter == null || readyCompleter.isCompleted) {
      return;
    }

    await readyCompleter.future.timeout(
      _config.readyTimeout,
      onTimeout: () => throw TimeoutException(
        'Timed out waiting for the Figma plugin to finish the Design QA handshake.',
      ),
    );
  }

  Future<void> _waitForCaptureAccept(String transferId) async {
    final acceptCompleter = _captureAcceptCompleter;
    if (acceptCompleter == null) {
      return;
    }

    await acceptCompleter.future.timeout(
      _config.captureAcceptTimeout,
      onTimeout: () => throw TimeoutException(
        'Timed out waiting for the Figma plugin to accept capture $transferId.',
      ),
    );
  }

  Future<void> _waitForCaptureComplete(String transferId) async {
    final completeCompleter = _captureCompleteCompleter;
    if (completeCompleter == null) {
      return;
    }

    await completeCompleter.future.timeout(
      _config.captureCompleteTimeout,
      onTimeout: () => throw TimeoutException(
        'Timed out waiting for the Figma plugin to complete capture $transferId.',
      ),
    );
  }

  void _handleControl(String rawMessage) {
    final sessionId = _sessionId;
    final pairingPayload = _pairingPayload;
    if (sessionId == null || pairingPayload == null) {
      return;
    }

    final Map<String, Object?> message;
    try {
      message = designQaParseControl(rawMessage);
    } on FormatException {
      debugPrint(
          '[Fliwright Design QA] Ignored malformed Figma control frame.');
      return;
    }

    if (message['version'] != designQaProtocolVersion) {
      debugPrint(
          '[Fliwright Design QA] Ignored control frame with wrong version.');
      return;
    }

    switch (message['type']) {
      case 'hello':
        _handleHello(message, pairingPayload);
        break;
      case 'ready':
        debugPrint('[Fliwright Design QA] Figma ready handshake received.');
        _completeReady();
        break;
      case 'capture-accept':
        debugPrint('[Fliwright Design QA] Figma capture accept received.');
        _handleCaptureAccept(message);
        break;
      case 'capture-complete':
        debugPrint('[Fliwright Design QA] Figma capture complete received.');
        _handleCaptureComplete(message);
        break;
      case 'capture-reject':
      case 'capture-cancel':
      case 'error':
        _handleRemoteError(message);
        break;
      case 'ping':
        _handlePing(message);
        break;
      default:
        break;
    }
  }

  void _handleHello(
    Map<String, Object?> message,
    DesignQaPairingPayload pairingPayload,
  ) {
    final remoteSessionId = message['sessionId'];
    final role = message['role'];
    final proof = message['pairingProof'];
    if (remoteSessionId is! String || role != 'figma' || proof is! String) {
      return;
    }

    final proofOk = designQaVerifyPairingProof(
      pairingSecret: pairingPayload.pairingSecret,
      sessionId: remoteSessionId,
      role: DesignQaPeerRole.figma,
      proof: proof,
    );
    if (!proofOk) {
      debugPrint(
          '[Fliwright Design QA] Rejected Figma hello with invalid proof.');
      return;
    }

    final sessionId = _sessionId;
    if (sessionId == null) {
      return;
    }

    unawaited(
      _transport.sendControl(
        designQaSerializeControl(designQaReadyMessage(sessionId: sessionId)),
      ),
    );
    debugPrint(
        '[Fliwright Design QA] Figma hello verified; sent ready response.');
  }

  void _completeReady() {
    final readyCompleter = _readyCompleter;
    if (readyCompleter != null && !readyCompleter.isCompleted) {
      readyCompleter.complete();
    }
  }

  void _handleCaptureAccept(Map<String, Object?> message) {
    if (message['transferId'] != _pendingTransferId) {
      return;
    }
    final acceptCompleter = _captureAcceptCompleter;
    if (acceptCompleter != null && !acceptCompleter.isCompleted) {
      acceptCompleter.complete();
    }
  }

  void _handleCaptureComplete(Map<String, Object?> message) {
    if (message['transferId'] != _pendingTransferId) {
      return;
    }
    final completeCompleter = _captureCompleteCompleter;
    if (completeCompleter != null && !completeCompleter.isCompleted) {
      completeCompleter.complete();
    }
  }

  void _handleRemoteError(Map<String, Object?> message) {
    final acceptCompleter = _captureAcceptCompleter;
    final completeCompleter = _captureCompleteCompleter;
    if (message['transferId'] != _pendingTransferId) {
      return;
    }

    final error = StateError(
      'Figma rejected the capture: '
      '${message['code'] ?? 'UNKNOWN'} ${message['message'] ?? ''}',
    );
    debugPrint('[Fliwright Design QA] Figma rejected capture: $error');
    if (acceptCompleter != null && !acceptCompleter.isCompleted) {
      acceptCompleter.completeError(error);
    }
    if (completeCompleter != null && !completeCompleter.isCompleted) {
      completeCompleter.completeError(error);
    }
  }

  void _handlePing(Map<String, Object?> message) {
    final sessionId = _sessionId;
    final sentAt = message['sentAt'];
    if (sessionId == null || sentAt is! String) {
      return;
    }

    unawaited(
      _transport.sendControl(
        designQaSerializeControl(
          designQaPongMessage(sessionId: sessionId, sentAt: sentAt),
        ),
      ),
    );
  }
}
