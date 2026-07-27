import 'package:fliwright_design_qa/fliwright_design_qa.dart';
import 'package:test/test.dart';

void main() {
  test('parses the Figma QR payload shape', () {
    final payload = DesignQaPairingPayload.parse(
      '{"version":2,"signalingUrl":"wss://example.test/signaling",'
      '"roomId":"room-1","pairingSecret":"AQIDBAUGBwgJCgsMDQ4PEA",'
      '"iceConfigId":"team-default"}',
    );

    expect(payload.version, 2);
    expect(payload.signalingUrl, 'wss://example.test/signaling');
    expect(payload.roomId, 'room-1');
    expect(payload.pairingSecret, 'AQIDBAUGBwgJCgsMDQ4PEA');
    expect(payload.iceConfigId, 'team-default');
  });

  test('computes the mobile pairing proof with HMAC-SHA-256', () {
    final proof = designQaComputePairingProof(
      pairingSecret: 'AQIDBAUGBwgJCgsMDQ4PEA',
      sessionId: 'mobile-session',
      role: DesignQaPeerRole.mobile,
    );

    expect(proof, 'HsRFK0E3lZpvdF0AxIYaakhtAtLSLj-R62BQRaE97d8');
  });
}
