import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  tearDown(FliwrightBridge.reset);

  test('reports capture unavailable before any widget binding is installed',
      () async {
    await FliwrightBridge.init();
    final handshake = await FliwrightBridge.registry
        .invoke('ext.fliwright.handshake', {'protocolVersion': '2'});
    expect(handshake['bridgeCapabilities'],
        containsPair('recordingBeforeDispatchTarget', false));
    final start = await FliwrightBridge.registry.invoke(
        'ext.fliwright.startRecording',
        {'protocolVersion': '2', 'sessionId': 'owner'});
    expect(start, containsPair('success', false));
    expect(start['error'], contains('FliwrightRecordingBinding'));
  });
}
