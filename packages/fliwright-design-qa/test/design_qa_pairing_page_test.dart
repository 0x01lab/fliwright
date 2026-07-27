import 'dart:async';

import 'package:fliwright_design_qa/fliwright_design_qa.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _payload = '{"version":2,"signalingUrl":"wss://example.test/signaling",'
    '"roomId":"room-1","pairingSecret":"AQIDBAUGBwgJCgsMDQ4PEA",'
    '"iceConfigId":"team-default"}';

void main() {
  testWidgets('pairs from a scanned payload and returns to the host page', (
    tester,
  ) async {
    final controller = _controller();
    var paired = false;

    await tester.pumpWidget(
      MaterialApp(
        home: _HostPage(
          controller: controller,
          onPaired: () => paired = true,
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('host.openPairing')));
    await tester.pumpAndSettle();
    _submitScannedPayload(tester);
    await tester.pumpAndSettle();

    expect(paired, isTrue);
    expect(controller.snapshot.state, DesignQaControllerState.paired);
    expect(find.byKey(const Key('host.openPairing')), findsOneWidget);

    await controller.close();
  });

  testWidgets('shows a retry state when pairing fails', (tester) async {
    final controller = _controller(failToConnect: true);

    await tester.pumpWidget(
      MaterialApp(
        home: _HostPage(controller: controller),
      ),
    );

    await tester.tap(find.byKey(const Key('host.openPairing')));
    await tester.pumpAndSettle();
    _submitScannedPayload(tester);
    await tester.pumpAndSettle();

    expect(find.text('Unable to pair with Figma'), findsOneWidget);
    expect(find.byKey(const Key('fliwright.designQa.pairing.retry')),
        findsOneWidget);

    await tester.tap(find.byKey(const Key('fliwright.designQa.pairing.retry')));
    await tester.pump();
    expect(find.byKey(const Key('fakeScanner.payload')), findsOneWidget);

    await controller.close();
  });
}

void _submitScannedPayload(WidgetTester tester) {
  final button = tester.widget<FilledButton>(
    find.byKey(const Key('fakeScanner.payload')),
  );
  button.onPressed!();
}

class _HostPage extends StatelessWidget {
  const _HostPage({required this.controller, this.onPaired});

  final DesignQaController controller;
  final VoidCallback? onPaired;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: FilledButton(
          key: const Key('host.openPairing'),
          onPressed: () {
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => DesignQaPairingPage(
                  controller: controller,
                  onPaired: onPaired,
                  scannerBuilder: (_, onPayload, __) => Center(
                    child: FilledButton(
                      key: const Key('fakeScanner.payload'),
                      onPressed: () => onPayload(_payload),
                      child: const Text('Scan payload'),
                    ),
                  ),
                ),
              ),
            );
          },
          child: const Text('Open pairing'),
        ),
      ),
    );
  }
}

DesignQaController _controller({bool failToConnect = false}) {
  return DesignQaController(
    transport: _PairingTransport(failToConnect: failToConnect),
    accelerationSamples: const Stream<DesignQaAccelerationSample>.empty(),
    config: const DesignQaControllerConfig(autoStartShake: false),
  );
}

class _PairingTransport implements DesignQaTransport {
  _PairingTransport({required this.failToConnect});

  final bool failToConnect;
  final _messages = StreamController<String>.broadcast();

  @override
  Stream<String> get controlMessages => _messages.stream;

  @override
  Future<void> close() => _messages.close();

  @override
  Future<void> connect(DesignQaPairingPayload payload) async {
    if (failToConnect) {
      throw StateError('connection failed');
    }
  }

  @override
  Future<void> sendBinary(List<int> bytes) async {}

  @override
  Future<void> sendControl(String message) async {}
}
