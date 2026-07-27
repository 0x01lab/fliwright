import 'pairing.dart';

class DesignQaPeerServerConfig {
  const DesignQaPeerServerConfig({
    required this.host,
    required this.path,
    required this.secure,
    this.port,
    this.key = 'peerjs',
  });

  final String host;
  final int? port;
  final String path;
  final bool secure;
  final String key;

  static DesignQaPeerServerConfig fromSignalingUrl(
    String signalingUrl, {
    String key = 'peerjs',
  }) {
    final uri = Uri.parse(signalingUrl.trim());
    if (uri.scheme != 'wss' && uri.scheme != 'https') {
      throw FormatException(
        'Design QA signaling URL must use wss:// or https://.',
        signalingUrl,
      );
    }
    if (uri.host.isEmpty) {
      throw FormatException(
        'Design QA signaling URL must include a host.',
        signalingUrl,
      );
    }

    return DesignQaPeerServerConfig(
      host: uri.host,
      port: uri.hasPort ? uri.port : null,
      path: uri.path.isEmpty ? '/' : uri.path,
      secure: true,
      key: key,
    );
  }

  static DesignQaPeerServerConfig fromPairingPayload(
    DesignQaPairingPayload payload, {
    String key = 'peerjs',
  }) {
    return fromSignalingUrl(payload.signalingUrl, key: key);
  }

  Map<String, Object?> toJson() {
    return {
      'host': host,
      if (port != null) 'port': port,
      'path': path,
      'secure': secure,
      'key': key,
    };
  }
}
