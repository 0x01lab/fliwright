import 'dart:typed_data';

import 'pairing.dart';
import 'protocol.dart';

abstract interface class DesignQaTransport {
  Stream<String> get controlMessages;

  Future<void> connect(DesignQaPairingPayload payload);

  Future<void> sendControl(String message);

  Future<void> sendBinary(Uint8List bytes);

  Future<void> close();
}

abstract interface class DesignQaScreenshotProvider {
  Future<DesignQaCapture> capture();
}

class DesignQaCaptureResult {
  const DesignQaCaptureResult({
    required this.sessionId,
    required this.transferId,
    required this.totalBytes,
    required this.chunkCount,
    required this.sha256,
  });

  final String sessionId;
  final String transferId;
  final int totalBytes;
  final int chunkCount;
  final String sha256;
}
