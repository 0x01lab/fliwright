import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:form_demo/camera_fixture.dart';

void main() {
  testWidgets(
    'previews and uploads the retaken fixture after cancel and error',
    (tester) async {
      final camera = FliwrightCameraTestCapability(
        fixtures: {
          for (final id in ['portrait', 'retake'])
            id: () async =>
                (await rootBundle.load('assets/camera/$id.png')).buffer
                    .asUint8List(),
        },
      );
      final state = await tester.runAsync(
        () => camera.invoke('reset', {
          'results': [
            {'kind': 'image', 'fixtureId': 'portrait'},
            {'kind': 'cancel'},
            {
              'kind': 'error',
              'code': 'camera_unavailable',
              'message': 'Try again',
            },
            {'kind': 'image', 'fixtureId': 'retake'},
          ],
        }),
      ) as Map<String, Object?>;
      final uploaded = <String>[];
      await tester.pumpWidget(
        CameraFixtureApp(
          capture: () => camera.capture(generation: camera.generation),
          upload: (image) async {
            uploaded.add(image.fixtureId);
          },
        ),
      );

      Future<void> capture() async {
        await tester.tap(find.byKey(const Key('camera_capture')));
        await tester.pumpAndSettle();
      }

      await capture();
      expect(find.byKey(const Key('camera_preview')), findsOneWidget);
      expect(find.text('Selected: portrait'), findsOneWidget);
      await capture();
      expect(find.text('Capture cancelled'), findsOneWidget);
      expect(find.text('Selected: portrait'), findsOneWidget);
      await capture();
      expect(find.text('Try again'), findsOneWidget);
      expect(find.text('Selected: portrait'), findsOneWidget);
      await capture();
      expect(find.text('Selected: retake'), findsOneWidget);
      await tester.tap(find.byKey(const Key('camera_upload')));
      await tester.pumpAndSettle();
      expect(uploaded, ['retake']);
      expect(find.text('Uploaded: retake'), findsOneWidget);
      expect(
        await camera.invoke('getStatus', {'generation': state['generation']}),
        allOf(containsPair('pending', 0), containsPair('consumed', 4)),
      );
    },
  );
}
