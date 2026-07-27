import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'pairing.dart';
import 'peerjs_keep_alive.dart';
import 'peerjs_signaling.dart';
import 'signaling_config.dart';
import 'transport.dart';

const _defaultIceServers = <Map<String, Object?>>[
  {'urls': 'stun:stun.l.google.com:19302'},
];
const _peerJsRegistrationTimeout = Duration(seconds: 10);
const _dataChannelOpenTimeout = Duration(seconds: 15);
const _maxBufferedAmount = 256 * 1024;

typedef DesignQaWebSocketConnector = WebSocketChannel Function(Uri uri);
typedef DesignQaPeerConnectionFactory = Future<RTCPeerConnection> Function(
    Map<String, dynamic> configuration);

/// Dials the Figma PeerJS host and exposes its reliable, ordered DataChannel.
class DesignQaWebRtcTransport implements DesignQaTransport {
  DesignQaWebRtcTransport({
    this.peerKey = 'peerjs',
    List<Map<String, Object?>>? iceServers,
    DesignQaWebSocketConnector? webSocketConnector,
    DesignQaPeerConnectionFactory? peerConnectionFactory,
    Duration signalingHeartbeatInterval = const Duration(seconds: 5),
  })  : _iceServers = iceServers ?? _defaultIceServers,
        _webSocketConnector = webSocketConnector ?? WebSocketChannel.connect,
        _peerConnectionFactory = peerConnectionFactory ??
            ((configuration) => createPeerConnection(configuration)) {
    _signalingKeepAlive = DesignQaPeerJsSignalingKeepAlive(
      interval: signalingHeartbeatInterval,
      send: _sendSignalingKeepAlive,
    );
  }

  final String peerKey;
  final List<Map<String, Object?>> _iceServers;
  final DesignQaWebSocketConnector _webSocketConnector;
  final DesignQaPeerConnectionFactory _peerConnectionFactory;
  final _controlMessages = StreamController<String>.broadcast();
  final _pendingCandidates = <RTCIceCandidate>[];
  late final DesignQaPeerJsSignalingKeepAlive _signalingKeepAlive;

  WebSocketChannel? _signaling;
  StreamSubscription<Object?>? _signalingSubscription;
  RTCPeerConnection? _peerConnection;
  RTCDataChannel? _dataChannel;
  Completer<void>? _registeredCompleter;
  Completer<void>? _dataChannelOpenCompleter;
  String? _connectionId;
  bool _remoteDescriptionSet = false;

  @override
  Stream<String> get controlMessages => _controlMessages.stream;

  @override
  Future<void> connect(DesignQaPairingPayload payload) async {
    await close();

    final server = DesignQaPeerServerConfig.fromPairingPayload(
      payload,
      key: peerKey,
    );
    debugPrint(
      '[Fliwright Design QA] Registering mobile peer with '
      '${server.secure ? 'wss' : 'ws'}://${server.host}${server.path}.',
    );
    final peerId = designQaGenerateId();
    final token = designQaGenerateId();
    _pairedRoomId = payload.roomId;
    _connectionId = 'dc_${designQaGenerateId()}';
    _registeredCompleter = Completer<void>();
    _dataChannelOpenCompleter = Completer<void>();

    final signaling = _webSocketConnector(
      designQaPeerJsWebSocketUri(
        server: server,
        peerId: peerId,
        token: token,
      ),
    );
    _signaling = signaling;
    _signalingSubscription = signaling.stream.listen(
      _handleSignalingMessage,
      onError: _handleSignalingError,
      onDone: _handleSignalingClosed,
    );

    await signaling.ready;
    debugPrint('[Fliwright Design QA] PeerJS signaling socket connected.');
    _signalingKeepAlive.start();
    await _waitForRegistration();
    debugPrint('[Fliwright Design QA] Mobile peer registration accepted.');

    final peerConnection = await _peerConnectionFactory({
      'iceServers': _iceServers,
    });
    _peerConnection = peerConnection;
    peerConnection.onIceCandidate = _sendIceCandidate;
    peerConnection.onConnectionState = _handlePeerConnectionState;

    final connectionId = _connectionId!;
    final dataChannel = await peerConnection.createDataChannel(
      connectionId,
      RTCDataChannelInit()
        ..ordered = true
        ..protocol = 'sctp',
    );
    debugPrint('[Fliwright Design QA] WebRTC offer created for Figma room.');
    _dataChannel = dataChannel;
    dataChannel.onDataChannelState = _handleDataChannelState;
    dataChannel.onMessage = _handleDataChannelMessage;
    dataChannel.bufferedAmountLowThreshold = _maxBufferedAmount ~/ 2;

    final offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    _sendSignaling(
      designQaPeerJsOfferMessage(
        dst: _pairedRoomId,
        connectionId: connectionId,
        label: connectionId,
        sdp: _sessionDescriptionToJson(offer),
      ),
    );

    await _waitForDataChannelOpen();
  }

  @override
  Future<void> sendControl(String message) async {
    final dataChannel = _requireOpenDataChannel();
    await dataChannel.send(RTCDataChannelMessage(message));
  }

  @override
  Future<void> sendBinary(Uint8List bytes) async {
    final dataChannel = _requireOpenDataChannel();
    await _waitForBufferCapacity(dataChannel);
    await dataChannel.send(RTCDataChannelMessage.fromBinary(bytes));
  }

  @override
  Future<void> close() async {
    _signalingKeepAlive.stop();
    final signaling = _signaling;
    if (signaling != null && _pairedRoomId.isNotEmpty) {
      try {
        _sendSignaling(designQaPeerJsLeaveMessage(dst: _pairedRoomId));
      } catch (_) {
        // The signaling connection may already be closed.
      }
    }

    _signaling = null;
    await _signalingSubscription?.cancel();
    _signalingSubscription = null;
    await signaling?.sink.close();

    final dataChannel = _dataChannel;
    _dataChannel = null;
    await dataChannel?.close();

    final peerConnection = _peerConnection;
    _peerConnection = null;
    await peerConnection?.close();

    _pendingCandidates.clear();
    _registeredCompleter = null;
    _dataChannelOpenCompleter = null;
    _connectionId = null;
    _pairedRoomId = '';
    _remoteDescriptionSet = false;
  }

  Future<void> _waitForRegistration() async {
    final completer = _registeredCompleter;
    if (completer == null) {
      throw StateError('The PeerJS registration session was not initialized.');
    }
    await completer.future.timeout(
      _peerJsRegistrationTimeout,
      onTimeout: () => throw TimeoutException(
        'Timed out while registering the mobile peer with the PeerServer.',
      ),
    );
  }

  Future<void> _waitForDataChannelOpen() async {
    final completer = _dataChannelOpenCompleter;
    if (completer == null) {
      throw StateError('The WebRTC DataChannel session was not initialized.');
    }
    await completer.future.timeout(
      _dataChannelOpenTimeout,
      onTimeout: () => throw TimeoutException(
        'Timed out waiting for the Figma WebRTC DataChannel to open.',
      ),
    );
  }

  void _handleSignalingMessage(Object? rawMessage) {
    if (rawMessage is! String) {
      _failConnection(
        FormatException('PeerJS signaling messages must be JSON strings.'),
      );
      return;
    }

    final message = DesignQaPeerJsMessage.parse(rawMessage);
    if (message.type != DesignQaPeerJsMessageType.candidate &&
        message.type != DesignQaPeerJsMessageType.heartbeat) {
      debugPrint(
        '[Fliwright Design QA] PeerJS signaling: ${message.type.wireName}.',
      );
    }
    switch (message.type) {
      case DesignQaPeerJsMessageType.open:
        _registeredCompleter?.complete();
        break;
      case DesignQaPeerJsMessageType.answer:
        unawaited(_applyAnswer(message));
        break;
      case DesignQaPeerJsMessageType.candidate:
        unawaited(_applyRemoteCandidate(message));
        break;
      case DesignQaPeerJsMessageType.error:
      case DesignQaPeerJsMessageType.idTaken:
      case DesignQaPeerJsMessageType.invalidKey:
      case DesignQaPeerJsMessageType.expire:
        _failConnection(StateError('PeerJS error: ${message.type.wireName}.'));
        break;
      case DesignQaPeerJsMessageType.leave:
        unawaited(close());
        break;
      case DesignQaPeerJsMessageType.heartbeat:
        _sendSignaling(designQaPeerJsHeartbeatMessage());
        break;
      case DesignQaPeerJsMessageType.offer:
        _failConnection(
            StateError('The mobile peer only supports dialing Figma.'));
        break;
    }
  }

  Future<void> _applyAnswer(DesignQaPeerJsMessage message) async {
    if (!_matchesConnection(message)) {
      return;
    }
    final sdp = _asMap(message.payload['sdp'], 'answer SDP');
    final type = sdp['type'];
    final value = sdp['sdp'];
    if (type != 'answer' || value is! String) {
      throw FormatException('PeerJS answer did not include a valid SDP.');
    }

    final peerConnection = _peerConnection;
    if (peerConnection == null) {
      return;
    }
    await peerConnection
        .setRemoteDescription(RTCSessionDescription(value, type as String));
    _remoteDescriptionSet = true;
    for (final candidate in _pendingCandidates) {
      await peerConnection.addCandidate(candidate);
    }
    _pendingCandidates.clear();
  }

  Future<void> _applyRemoteCandidate(DesignQaPeerJsMessage message) async {
    if (!_matchesConnection(message)) {
      return;
    }
    final map = _asMap(message.payload['candidate'], 'ICE candidate');
    final candidate = RTCIceCandidate(
      map['candidate'] as String?,
      map['sdpMid'] as String?,
      _asInt(map['sdpMLineIndex']),
    );
    final peerConnection = _peerConnection;
    if (peerConnection == null || !_remoteDescriptionSet) {
      _pendingCandidates.add(candidate);
      return;
    }
    await peerConnection.addCandidate(candidate);
  }

  void _sendIceCandidate(RTCIceCandidate candidate) {
    final connectionId = _connectionId;
    if (connectionId == null || candidate.candidate == null) {
      return;
    }
    _sendSignaling(
      designQaPeerJsCandidateMessage(
        dst: _pairedRoomId,
        connectionId: connectionId,
        candidate: Map<String, Object?>.from(candidate.toMap()),
      ),
    );
  }

  String _pairedRoomId = '';

  void _sendSignaling(DesignQaPeerJsMessage message) {
    final signaling = _signaling;
    if (signaling == null) {
      throw StateError('The PeerJS signaling socket is not connected.');
    }
    signaling.sink.add(message.serialize());
  }

  void _sendSignalingKeepAlive(DesignQaPeerJsMessage message) {
    try {
      _sendSignaling(message);
    } catch (error, stackTrace) {
      _failConnection(error, stackTrace);
    }
  }

  void _handleDataChannelState(RTCDataChannelState state) {
    debugPrint('[Fliwright Design QA] DataChannel state: ${state.name}.');
    if (state == RTCDataChannelState.RTCDataChannelOpen) {
      final completer = _dataChannelOpenCompleter;
      if (completer != null && !completer.isCompleted) {
        completer.complete();
      }
    } else if (state == RTCDataChannelState.RTCDataChannelClosed) {
      _failConnection(StateError('The Figma WebRTC DataChannel was closed.'));
    }
  }

  void _handleDataChannelMessage(RTCDataChannelMessage message) {
    if (!message.isBinary) {
      _controlMessages.add(message.text);
    }
  }

  void _handlePeerConnectionState(RTCPeerConnectionState state) {
    debugPrint('[Fliwright Design QA] PeerConnection state: ${state.name}.');
    if (state == RTCPeerConnectionState.RTCPeerConnectionStateFailed) {
      _failConnection(StateError('The Figma WebRTC peer connection failed.'));
    }
  }

  void _handleSignalingError(Object error, StackTrace stackTrace) {
    debugPrint('[Fliwright Design QA] PeerJS signaling error: $error');
    _failConnection(error, stackTrace);
  }

  void _handleSignalingClosed() {
    debugPrint('[Fliwright Design QA] PeerJS signaling socket closed.');
    _failConnection(StateError('The PeerJS signaling socket was closed.'));
  }

  void _failConnection(Object error, [StackTrace? stackTrace]) {
    _signalingKeepAlive.stop();
    debugPrint('[Fliwright Design QA] WebRTC connection failed: $error');
    final registration = _registeredCompleter;
    if (registration != null && !registration.isCompleted) {
      registration.completeError(error, stackTrace);
    }
    final dataChannel = _dataChannelOpenCompleter;
    if (dataChannel != null && !dataChannel.isCompleted) {
      dataChannel.completeError(error, stackTrace);
    }
    if (!_controlMessages.isClosed) {
      _controlMessages.addError(error, stackTrace);
    }
  }

  bool _matchesConnection(DesignQaPeerJsMessage message) {
    return message.payload['connectionId'] == _connectionId;
  }

  RTCDataChannel _requireOpenDataChannel() {
    final dataChannel = _dataChannel;
    if (dataChannel == null ||
        dataChannel.state != RTCDataChannelState.RTCDataChannelOpen) {
      throw StateError('The Figma WebRTC DataChannel is not open.');
    }
    return dataChannel;
  }

  Future<void> _waitForBufferCapacity(RTCDataChannel dataChannel) async {
    while ((await dataChannel.getBufferedAmount()) > _maxBufferedAmount) {
      await Future<void>.delayed(const Duration(milliseconds: 16));
    }
  }

  Map<String, Object?> _sessionDescriptionToJson(
    RTCSessionDescription description,
  ) {
    return {
      'type': description.type,
      'sdp': description.sdp,
    };
  }

  Map<String, Object?> _asMap(Object? value, String name) {
    if (value is Map) {
      return Map<String, Object?>.from(value);
    }
    throw FormatException('PeerJS $name must be an object.');
  }

  int? _asInt(Object? value) {
    if (value is int) {
      return value;
    }
    if (value is num) {
      return value.toInt();
    }
    return null;
  }
}
