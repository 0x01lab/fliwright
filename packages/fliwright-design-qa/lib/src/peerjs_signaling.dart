import 'dart:convert';

import 'signaling_config.dart';

const designQaPeerJsClientVersion = '1.5.5';

enum DesignQaPeerJsMessageType {
  open('OPEN'),
  error('ERROR'),
  idTaken('ID-TAKEN'),
  invalidKey('INVALID-KEY'),
  offer('OFFER'),
  answer('ANSWER'),
  candidate('CANDIDATE'),
  leave('LEAVE'),
  expire('EXPIRE'),
  heartbeat('HEARTBEAT');

  const DesignQaPeerJsMessageType(this.wireName);

  final String wireName;

  static DesignQaPeerJsMessageType? fromWireName(String value) {
    for (final type in values) {
      if (type.wireName == value) {
        return type;
      }
    }
    return null;
  }
}

class DesignQaPeerJsMessage {
  const DesignQaPeerJsMessage({
    required this.type,
    this.src,
    this.dst,
    this.payload = const <String, Object?>{},
  });

  final DesignQaPeerJsMessageType type;
  final String? src;
  final String? dst;
  final Map<String, Object?> payload;

  static DesignQaPeerJsMessage parse(String rawMessage) {
    final decoded = jsonDecode(rawMessage);
    if (decoded is! Map<String, Object?>) {
      throw const FormatException('PeerJS message must be a JSON object.');
    }

    final typeName = decoded['type'];
    if (typeName is! String) {
      throw const FormatException('PeerJS message is missing type.');
    }
    final type = DesignQaPeerJsMessageType.fromWireName(typeName);
    if (type == null) {
      throw FormatException('Unsupported PeerJS message type: $typeName.');
    }

    final payload = decoded['payload'];
    return DesignQaPeerJsMessage(
      type: type,
      src: decoded['src'] is String ? decoded['src'] as String : null,
      dst: decoded['dst'] is String ? decoded['dst'] as String : null,
      payload: payload is Map
          ? Map<String, Object?>.from(payload)
          : const <String, Object?>{},
    );
  }

  String serialize() {
    return jsonEncode(toJson());
  }

  Map<String, Object?> toJson() {
    return {
      'type': type.wireName,
      if (src != null) 'src': src,
      if (dst != null) 'dst': dst,
      if (payload.isNotEmpty) 'payload': payload,
    };
  }
}

Uri designQaPeerJsWebSocketUri({
  required DesignQaPeerServerConfig server,
  required String peerId,
  required String token,
  String peerJsVersion = designQaPeerJsClientVersion,
}) {
  final peerPath = server.path.endsWith('/')
      ? '${server.path}peerjs'
      : '${server.path}/peerjs';
  return Uri(
    scheme: server.secure ? 'wss' : 'ws',
    host: server.host,
    port: server.port,
    path: peerPath,
    queryParameters: {
      'key': server.key,
      'id': peerId,
      'token': token,
      'version': peerJsVersion,
    },
  );
}

DesignQaPeerJsMessage designQaPeerJsHeartbeatMessage() {
  return const DesignQaPeerJsMessage(type: DesignQaPeerJsMessageType.heartbeat);
}

DesignQaPeerJsMessage designQaPeerJsLeaveMessage({required String dst}) {
  return DesignQaPeerJsMessage(type: DesignQaPeerJsMessageType.leave, dst: dst);
}

DesignQaPeerJsMessage designQaPeerJsOfferMessage({
  required String dst,
  required String connectionId,
  required Map<String, Object?> sdp,
  required String label,
  Object? metadata,
}) {
  return DesignQaPeerJsMessage(
    type: DesignQaPeerJsMessageType.offer,
    dst: dst,
    payload: {
      'sdp': sdp,
      'type': 'data',
      'connectionId': connectionId,
      if (metadata != null) 'metadata': metadata,
      'label': label,
      'reliable': true,
      'serialization': 'raw',
    },
  );
}

DesignQaPeerJsMessage designQaPeerJsCandidateMessage({
  required String dst,
  required String connectionId,
  required Map<String, Object?> candidate,
}) {
  return DesignQaPeerJsMessage(
    type: DesignQaPeerJsMessageType.candidate,
    dst: dst,
    payload: {
      'candidate': candidate,
      'type': 'data',
      'connectionId': connectionId,
    },
  );
}
