import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

import 'pairing.dart';

const designQaMaxChunkBytes = 16 * 1024;
const designQaMaxCaptureBytes = 2 * 1024 * 1024;

class DesignQaDeviceContext {
  const DesignQaDeviceContext({
    required this.model,
    required this.platform,
    required this.osVersion,
    required this.screenWidth,
    required this.screenHeight,
    required this.appVersionBuild,
    required this.capturedAt,
  });

  final String model;
  final String platform;
  final String osVersion;
  final int screenWidth;
  final int screenHeight;
  final String appVersionBuild;
  final DateTime capturedAt;

  Map<String, Object?> toJson() {
    return {
      'model': model,
      'platform': platform,
      'osVersion': osVersion,
      'screenWidth': screenWidth,
      'screenHeight': screenHeight,
      'appVersionBuild': appVersionBuild,
      'capturedAt': capturedAt.toUtc().toIso8601String(),
    };
  }
}

class DesignQaCapture {
  const DesignQaCapture({
    required this.pngBytes,
    required this.device,
    this.mimeType = 'image/png',
  });

  final Uint8List pngBytes;
  final String mimeType;
  final DesignQaDeviceContext device;
}

String designQaSha256Hex(List<int> bytes) {
  return sha256.convert(bytes).bytes.map((byte) {
    return byte.toRadixString(16).padLeft(2, '0');
  }).join();
}

String designQaSerializeControl(Map<String, Object?> message) {
  return jsonEncode(message);
}

Map<String, Object?> designQaParseControl(String message) {
  final decoded = jsonDecode(message);
  if (decoded is! Map<String, Object?>) {
    throw const FormatException(
      'Design QA control frame must be a JSON object.',
    );
  }
  return decoded;
}

Map<String, Object?> designQaHelloMessage({
  required String sessionId,
  required String pairingProof,
}) {
  return {
    'version': designQaProtocolVersion,
    'type': 'hello',
    'sessionId': sessionId,
    'role': DesignQaPeerRole.mobile.wireName,
    'pairingProof': pairingProof,
    'capabilities': {
      'maxChunkBytes': designQaMaxChunkBytes,
      'maxCaptureBytes': designQaMaxCaptureBytes,
      'sha256': true,
    },
  };
}

Map<String, Object?> designQaReadyMessage({required String sessionId}) {
  return {
    'version': designQaProtocolVersion,
    'type': 'ready',
    'sessionId': sessionId,
  };
}

Map<String, Object?> designQaPongMessage({
  required String sessionId,
  required String sentAt,
}) {
  return {
    'version': designQaProtocolVersion,
    'type': 'pong',
    'sessionId': sessionId,
    'sentAt': sentAt,
  };
}

Map<String, Object?> designQaCaptureStartMessage({
  required String sessionId,
  required String transferId,
  required DesignQaCapture capture,
  int chunkBytes = designQaMaxChunkBytes,
}) {
  final totalBytes = capture.pngBytes.length;
  final chunkCount = (totalBytes / chunkBytes).ceil();

  return {
    'version': designQaProtocolVersion,
    'type': 'capture-start',
    'sessionId': sessionId,
    'transferId': transferId,
    'mimeType': capture.mimeType,
    'totalBytes': totalBytes,
    'chunkBytes': chunkBytes,
    'chunkCount': chunkCount,
    'sha256': designQaSha256Hex(capture.pngBytes),
    'device': capture.device.toJson(),
  };
}

Map<String, Object?> designQaCaptureEofMessage({
  required String sessionId,
  required String transferId,
  required Uint8List bytes,
  int chunkBytes = designQaMaxChunkBytes,
}) {
  return {
    'version': designQaProtocolVersion,
    'type': 'capture-eof',
    'sessionId': sessionId,
    'transferId': transferId,
    'totalBytes': bytes.length,
    'chunkCount': (bytes.length / chunkBytes).ceil(),
    'sha256': designQaSha256Hex(bytes),
  };
}

List<Uint8List> designQaChunkBytes(
  Uint8List bytes, {
  int chunkBytes = designQaMaxChunkBytes,
}) {
  if (chunkBytes <= 0 || chunkBytes > designQaMaxChunkBytes) {
    throw ArgumentError.value(chunkBytes, 'chunkBytes', 'Invalid chunk size.');
  }
  if (bytes.isEmpty) {
    throw ArgumentError.value(
      bytes.length,
      'bytes.length',
      'Capture is empty.',
    );
  }
  if (bytes.length > designQaMaxCaptureBytes) {
    throw ArgumentError.value(
      bytes.length,
      'bytes.length',
      'Capture exceeds the 2 MB Design QA limit.',
    );
  }

  final chunks = <Uint8List>[];
  for (var offset = 0; offset < bytes.length; offset += chunkBytes) {
    final end = math.min(offset + chunkBytes, bytes.length);
    chunks.add(Uint8List.sublistView(bytes, offset, end));
  }
  return chunks;
}
