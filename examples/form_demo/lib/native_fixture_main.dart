import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter/foundation.dart';
import 'package:form_demo/native_fixture.dart';

/// Dedicated test entrypoint; never used by the normal form demo.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  var generation = 0;
  void showFixture() => runApp(NativeFixtureApp(
        key: ValueKey(generation),
        includeCamera:
            !kIsWeb && defaultTargetPlatform == TargetPlatform.android,
        includeTextInput:
            !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS,
      ));
  FliwrightAppInstance.registerCapability(FliwrightAppCapability(
    name: 'nativeDemo',
    methods: {
      'reset': (_) {
        generation++;
        showFixture();
        return {'ready': true};
      },
      'readPermissions': (_) => readNativeFixturePermissions(),
    },
  ));
  await FliwrightBridge.init();
  showFixture();
}
