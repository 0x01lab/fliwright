import 'package:flutter/services.dart';

import 'pairing.dart';
import 'signaling_config.dart';
import 'transport.dart';

class DesignQaPlatformTransport implements DesignQaTransport {
  DesignQaPlatformTransport({
    String methodChannelName = 'fliwright_design_qa/transport',
    String controlEventChannelName = 'fliwright_design_qa/transport_control',
    this.peerKey = 'peerjs',
    MethodChannel? methodChannel,
    EventChannel? controlEventChannel,
  })  : _methodChannel = methodChannel ?? MethodChannel(methodChannelName),
        _controlEventChannel =
            controlEventChannel ?? EventChannel(controlEventChannelName);

  final String peerKey;
  final MethodChannel _methodChannel;
  final EventChannel _controlEventChannel;

  @override
  Stream<String> get controlMessages {
    return _controlEventChannel.receiveBroadcastStream().map((event) {
      if (event is String) {
        return event;
      }
      throw FormatException(
        'Design QA transport control event must be a JSON string.',
        event,
      );
    });
  }

  @override
  Future<void> connect(DesignQaPairingPayload payload) async {
    final peerServer = DesignQaPeerServerConfig.fromPairingPayload(
      payload,
      key: peerKey,
    );

    await _methodChannel.invokeMethod<void>('connect', {
      'version': payload.version,
      'signalingUrl': payload.signalingUrl,
      'roomId': payload.roomId,
      'iceConfigId': payload.iceConfigId,
      'peerServer': peerServer.toJson(),
    });
  }

  @override
  Future<void> sendControl(String message) async {
    await _methodChannel.invokeMethod<void>('sendControl', {
      'message': message,
    });
  }

  @override
  Future<void> sendBinary(Uint8List bytes) async {
    await _methodChannel.invokeMethod<void>('sendBinary', bytes);
  }

  @override
  Future<void> close() async {
    await _methodChannel.invokeMethod<void>('close');
  }
}
