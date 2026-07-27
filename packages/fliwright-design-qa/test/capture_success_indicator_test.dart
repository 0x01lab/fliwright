import 'dart:typed_data';

import 'package:fliwright_design_qa/fliwright_design_qa.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('shrinks the capture, confirms delivery, then disappears', (
    tester,
  ) async {
    var taps = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: FilledButton(
              onPressed: () => taps += 1,
              child: const Text('Host action'),
            ),
          ),
        ),
      ),
    );

    final feedback = DesignQaCaptureSuccessIndicator();
    feedback.begin(_capture());
    await tester.pump();

    expect(
      find.byKey(DesignQaCaptureSuccessIndicator.indicatorKey),
      findsOneWidget,
    );
    expect(find.byType(Image), findsOneWidget);
    expect(
      find.byKey(DesignQaCaptureSuccessIndicator.confirmationKey),
      findsNothing,
    );

    await tester.tap(find.text('Host action'));
    expect(taps, 1);

    feedback.complete(_result());
    await tester.pump(DesignQaCaptureSuccessIndicator.travelDuration);
    await tester.pump(DesignQaCaptureSuccessIndicator.confirmationDuration);
    await tester.pump();
    expect(
      find.byKey(DesignQaCaptureSuccessIndicator.confirmationKey),
      findsOneWidget,
    );

    await tester.pump(
      DesignQaCaptureSuccessIndicator.confirmationVisibleDuration,
    );
    await tester.pump();
    await tester.pump(DesignQaCaptureSuccessIndicator.dismissDuration);
    expect(
      find.byKey(DesignQaCaptureSuccessIndicator.indicatorKey),
      findsNothing,
    );
  });
}

DesignQaCapture _capture() {
  return DesignQaCapture(
    pngBytes: Uint8List.fromList(<int>[
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      0,
      0,
      0,
      13,
      73,
      72,
      68,
      82,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      8,
      6,
      0,
      0,
      0,
      31,
      21,
      196,
      137,
      0,
      0,
      0,
      13,
      73,
      68,
      65,
      84,
      8,
      215,
      99,
      248,
      207,
      192,
      240,
      31,
      0,
      5,
      0,
      1,
      255,
      137,
      153,
      61,
      29,
      0,
      0,
      0,
      0,
      73,
      69,
      78,
      68,
      174,
      66,
      96,
      130,
    ]),
    device: DesignQaDeviceContext(
      model: 'test-device',
      platform: 'ios',
      osVersion: '18',
      screenWidth: 390,
      screenHeight: 844,
      appVersionBuild: '1',
      capturedAt: DateTime.utc(2026, 7, 16),
    ),
  );
}

DesignQaCaptureResult _result() {
  return const DesignQaCaptureResult(
    sessionId: 'session-1',
    transferId: 'transfer-1',
    totalBytes: 3,
    chunkCount: 1,
    sha256: 'abc',
  );
}
