import 'dart:convert';

import 'package:fliwright_design_qa/fliwright_design_qa.dart';
import 'package:test/test.dart';

void main() {
  test('builds PeerJS WebSocket URLs compatible with peerjs-server', () {
    final uri = designQaPeerJsWebSocketUri(
      server: const DesignQaPeerServerConfig(
        host: 'figma-gitlab.onrender.com',
        path: '/signaling',
        secure: true,
        key: 'team-key',
      ),
      peerId: 'mobile-1',
      token: 'token-1',
    );

    expect(
      uri.toString(),
      contains('wss://figma-gitlab.onrender.com/signaling/peerjs?'),
    );
    expect(uri.queryParameters['key'], 'team-key');
    expect(uri.queryParameters['id'], 'mobile-1');
    expect(uri.queryParameters['token'], 'token-1');
    expect(uri.queryParameters['version'], designQaPeerJsClientVersion);
  });

  test('serializes data-channel offers using PeerJS raw serialization', () {
    final message = designQaPeerJsOfferMessage(
      dst: 'figma-room',
      connectionId: 'dc_123',
      label: 'dc_123',
      sdp: {'type': 'offer', 'sdp': 'v=0'},
    );
    final decoded = jsonDecode(message.serialize()) as Map<String, Object?>;
    final payload = decoded['payload'] as Map<String, Object?>;

    expect(decoded['type'], 'OFFER');
    expect(decoded['dst'], 'figma-room');
    expect(payload['type'], 'data');
    expect(payload['connectionId'], 'dc_123');
    expect(payload['label'], 'dc_123');
    expect(payload['serialization'], 'raw');
    expect(payload['reliable'], isTrue);
  });

  test('parses PeerJS answer and candidate messages', () {
    final answer = DesignQaPeerJsMessage.parse(
      '{"type":"ANSWER","src":"figma-room","payload":{"type":"data",'
      '"connectionId":"dc_123","sdp":{"type":"answer","sdp":"v=0"}}}',
    );
    final candidate = DesignQaPeerJsMessage.parse(
      '{"type":"CANDIDATE","src":"figma-room","payload":{"type":"data",'
      '"connectionId":"dc_123","candidate":{"candidate":"candidate:1",'
      '"sdpMid":"0","sdpMLineIndex":0}}}',
    );

    expect(answer.type, DesignQaPeerJsMessageType.answer);
    expect(answer.src, 'figma-room');
    expect(answer.payload['connectionId'], 'dc_123');
    expect(candidate.type, DesignQaPeerJsMessageType.candidate);
    expect(candidate.payload['candidate'], isA<Map<String, Object?>>());
  });
}
