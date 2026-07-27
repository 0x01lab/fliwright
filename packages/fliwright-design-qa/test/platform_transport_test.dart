import 'package:fliwright_design_qa/fliwright_design_qa.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'connect sends signaling details without leaking the pairing secret',
    () async {
      const channel = MethodChannel('test.designQa.transport');
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        return null;
      });
      addTearDown(() {
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null);
      });

      final transport = DesignQaPlatformTransport(
        peerKey: 'team-key',
        methodChannel: channel,
        controlEventChannel: const EventChannel('test.designQa.control'),
      );

      await transport.connect(
        const DesignQaPairingPayload(
          signalingUrl: 'https://figma-gitlab.onrender.com/signaling',
          roomId: 'room-1',
          pairingSecret: 'super-secret',
          iceConfigId: 'team-default',
        ),
      );

      expect(calls, hasLength(1));
      expect(calls.single.method, 'connect');
      final arguments = calls.single.arguments as Map<dynamic, dynamic>;
      expect(
        arguments['signalingUrl'],
        'https://figma-gitlab.onrender.com/signaling',
      );
      expect(arguments['roomId'], 'room-1');
      expect(arguments['iceConfigId'], 'team-default');
      expect(arguments['peerServer'], {
        'host': 'figma-gitlab.onrender.com',
        'path': '/signaling',
        'secure': true,
        'key': 'team-key',
      });
      expect(arguments.containsKey('pairingSecret'), isFalse);
    },
  );

  test(
    'sendControl, sendBinary, and close delegate to the method channel',
    () async {
      const channel = MethodChannel('test.designQa.transport.send');
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        return null;
      });
      addTearDown(() {
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null);
      });

      final transport = DesignQaPlatformTransport(
        methodChannel: channel,
        controlEventChannel: const EventChannel('test.designQa.control.send'),
      );

      await transport.sendControl('{"type":"ready"}');
      await transport.sendBinary(Uint8List.fromList([1, 2, 3]));
      await transport.close();

      expect(calls.map((call) => call.method), [
        'sendControl',
        'sendBinary',
        'close',
      ]);
      expect(
        (calls[0].arguments as Map<dynamic, dynamic>)['message'],
        '{"type":"ready"}',
      );
      expect(calls[1].arguments, isA<Uint8List>());
    },
  );
}
