import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:flutter/widgets.dart';
import 'package:form_demo/recording_fixture.dart';

Future<void> main() async {
  FliwrightRecordingBinding.ensureInitialized();
  await FliwrightBridge.init();
  runApp(const RecordingFixtureApp());
}
