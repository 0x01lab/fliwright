import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

const designQaProtocolVersion = 2;

enum DesignQaPeerRole {
  mobile,
  figma;

  String get wireName => name;
}

class DesignQaPairingPayload {
  const DesignQaPairingPayload({
    required this.signalingUrl,
    required this.roomId,
    required this.pairingSecret,
    required this.iceConfigId,
    this.version = designQaProtocolVersion,
  });

  final int version;
  final String signalingUrl;
  final String roomId;
  final String pairingSecret;
  final String iceConfigId;

  static DesignQaPairingPayload parse(String rawPayload) {
    final decoded = jsonDecode(rawPayload);
    if (decoded is! Map<String, Object?>) {
      throw const FormatException(
        'Design QA QR payload must be a JSON object.',
      );
    }

    final version = decoded['version'];
    if (version != designQaProtocolVersion) {
      throw FormatException(
        'Unsupported Design QA protocol version: $version.',
      );
    }

    String readString(String key) {
      final value = decoded[key];
      if (value is String && value.trim().isNotEmpty) {
        return value.trim();
      }
      throw FormatException('Design QA QR payload is missing "$key".');
    }

    return DesignQaPairingPayload(
      version: version as int,
      signalingUrl: readString('signalingUrl'),
      roomId: readString('roomId'),
      pairingSecret: readString('pairingSecret'),
      iceConfigId: readString('iceConfigId'),
    );
  }
}

String designQaGenerateId({int byteLength = 16}) {
  final random = Random.secure();
  final bytes = Uint8List.fromList(
    List<int>.generate(byteLength, (_) => random.nextInt(256)),
  );
  return bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
}

Uint8List designQaBase64UrlDecode(String value) {
  final normalized = base64Url.normalize(value);
  return Uint8List.fromList(base64Url.decode(normalized));
}

String designQaBase64UrlEncode(List<int> bytes) {
  return base64Url.encode(bytes).replaceAll('=', '');
}

String designQaComputePairingProof({
  required String pairingSecret,
  required String sessionId,
  required DesignQaPeerRole role,
}) {
  final key = designQaBase64UrlDecode(pairingSecret);
  final message = utf8.encode('$sessionId:${role.wireName}');
  final digest = Hmac(sha256, key).convert(message);
  return designQaBase64UrlEncode(digest.bytes);
}

bool designQaConstantTimeEqual(String a, String b) {
  if (a.length != b.length) {
    return false;
  }

  var mismatch = 0;
  for (var index = 0; index < a.length; index += 1) {
    mismatch |= a.codeUnitAt(index) ^ b.codeUnitAt(index);
  }
  return mismatch == 0;
}

bool designQaVerifyPairingProof({
  required String pairingSecret,
  required String sessionId,
  required DesignQaPeerRole role,
  required String proof,
}) {
  final expected = designQaComputePairingProof(
    pairingSecret: pairingSecret,
    sessionId: sessionId,
    role: role,
  );
  return designQaConstantTimeEqual(expected, proof);
}
