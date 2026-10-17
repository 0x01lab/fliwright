import 'package:flutter/gestures.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  final binding = FliwrightRecordingBinding.ensureInitialized();

  setUp(() async {
    await FliwrightBridge.reset();
    await FliwrightBridge.init();
  });
  tearDown(FliwrightBridge.reset);

  Future<Map<String, dynamic>> start(String sessionId,
          {String version = '2'}) =>
      FliwrightBridge.registry.invoke('ext.fliwright.startRecording', {
        'protocolVersion': version,
        'sessionId': sessionId,
      });
  Future<Map<String, dynamic>> stop(String sessionId) =>
      FliwrightBridge.registry
          .invoke('ext.fliwright.stopRecording', {'sessionId': sessionId});

  test('handshake advertises the installed recording binding', () async {
    final result = await FliwrightBridge.registry
        .invoke('ext.fliwright.handshake', {'protocolVersion': '2'});
    expect(result['bridgeCapabilities'],
        containsPair('recordingProtocolVersion', 2));
    expect(result['bridgeCapabilities'],
        containsPair('recordingBeforeDispatchTarget', true));
    expect(result['bridgeCapabilities'],
        containsPair('recordingFocusedInputController', true));
  });

  test('requires protocol v2 and a nonempty client session id', () async {
    expect(await start('old', version: '1'), containsPair('success', false));
    expect(await start(''), containsPair('success', false));
    expect(await start('  '), containsPair('success', false));
    expect(await start('owner'), {
      'success': true,
      'protocolVersion': 2,
      'recording': true,
      'sessionId': 'owner',
    });
  });

  test('start and stop preserve ownership and cannot interrupt another session',
      () async {
    final started = await start('owner');
    final callback = FliwrightRecordingBinding.beforePointerDispatch;
    expect(await start('owner'), started);
    expect(await start('intruder'), containsPair('success', false));
    expect(await stop('intruder'), containsPair('success', false));
    expect(FliwrightRecordingBinding.beforePointerDispatch, same(callback));
    expect(await stop('owner'), {
      'success': true,
      'protocolVersion': 2,
      'recording': false,
      'sessionId': 'owner',
      'lastSequence': 0,
    });
    expect(FliwrightRecordingBinding.beforePointerDispatch, isNull);
    expect(FliwrightRecordingBinding.afterFrame, isNull);
  });

  test('stop returns the final sequence and repeats the same flush response',
      () async {
    await start('owner');
    binding.dispatchEvent(
        const PointerDownEvent(pointer: 1, position: Offset(3, 4)),
        HitTestResult());
    binding.dispatchEvent(
        const PointerUpEvent(pointer: 1, position: Offset(3, 4)),
        HitTestResult());
    final result = await stop('owner');
    expect(result, {
      'success': true,
      'protocolVersion': 2,
      'recording': false,
      'sessionId': 'owner',
      'lastSequence': 2,
    });
    expect(await stop('owner'), result);
    expect(await stop('intruder'), containsPair('success', false));
    await start('next');
    expect(await stop('owner'), containsPair('success', false));
    expect((await stop('next'))['sessionId'], 'next');
  });

  test(
      'reset releases recording resources without accepting a public ownerless stop',
      () async {
    await start('owner');
    expect(await stop(''), containsPair('success', false));
    expect(FliwrightRecordingBinding.beforePointerDispatch, isNotNull);
    await FliwrightBridge.reset();
    expect(FliwrightRecordingBinding.beforePointerDispatch, isNull);
    expect(FliwrightRecordingBinding.afterFrame, isNull);
    await FliwrightBridge.init();
    expect(await stop('owner'), containsPair('success', false));
    expect(await start('next'), containsPair('sessionId', 'next'));
  });
}
