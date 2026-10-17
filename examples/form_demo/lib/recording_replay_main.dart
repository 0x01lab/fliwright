import 'package:flutter/widgets.dart';
import 'package:form_demo/recording_fixture.dart';

/// App-owned entrypoint for generated integration tests. The test installs
/// IntegrationTestWidgetsFlutterBinding before calling main(). Manual capture
/// uses recording_fixture_main.dart and its FliwrightRecordingBinding instead.
void main() {
  runApp(const RecordingFixtureApp());
}
