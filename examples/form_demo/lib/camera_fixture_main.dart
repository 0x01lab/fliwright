import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:form_demo/camera_fixture.dart';

/// Dedicated app-test-seam entrypoint; the normal form demo does not register it.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final camera = FliwrightCameraTestCapability(
    fixtures: {
      for (final id in ['portrait', 'retake'])
        id: () async => (await rootBundle.load('assets/camera/$id.png'))
            .buffer
            .asUint8List(),
    },
  );
  FliwrightAppInstance.registerCapability(camera);
  var resetCount = 0;
  Widget buildApp() => CameraFixtureApp(
        key: ValueKey('camera-demo-$resetCount'),
        capture: () => camera.capture(generation: camera.generation),
        // Local receiver; transport/backend coverage is outside this demo.
        upload: (image) async {
          if (image.bytes.isEmpty) throw StateError('Empty upload');
        },
      );
  FliwrightAppInstance.registerCapability(FliwrightAppCapability(
    name: 'cameraDemo',
    methods: {
      'reset': (_) {
        resetCount++;
        runApp(buildApp());
        return {'ready': true};
      },
    },
  ));
  await FliwrightBridge.init();
  runApp(buildApp());
}
