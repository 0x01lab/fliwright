import 'package:fliwright_design_qa/fliwright_design_qa.dart';
import 'package:test/test.dart';

void main() {
  test('parses a secure PeerServer signaling URL', () {
    final config = DesignQaPeerServerConfig.fromSignalingUrl(
      'wss://figma-gitlab.onrender.com/signaling',
    );

    expect(config.host, 'figma-gitlab.onrender.com');
    expect(config.port, isNull);
    expect(config.path, '/signaling');
    expect(config.secure, isTrue);
    expect(config.key, 'peerjs');
  });

  test('parses an https PeerServer URL as secure signaling', () {
    final config = DesignQaPeerServerConfig.fromSignalingUrl(
      'https://figma-gitlab.onrender.com/signaling',
      key: 'team-key',
    );

    expect(config.host, 'figma-gitlab.onrender.com');
    expect(config.port, isNull);
    expect(config.path, '/signaling');
    expect(config.secure, isTrue);
    expect(config.key, 'team-key');
  });

  test('rejects insecure or non-PeerServer signaling URLs', () {
    expect(
      () => DesignQaPeerServerConfig.fromSignalingUrl(
        'ws://127.0.0.1:9000/signaling',
      ),
      throwsFormatException,
    );
    expect(
      () => DesignQaPeerServerConfig.fromSignalingUrl(
        'http://example.test/signaling',
      ),
      throwsFormatException,
    );
  });
}
