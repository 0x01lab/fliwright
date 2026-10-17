# form_demo

## Controlled recording fixture

`lib/recording_fixture.dart` contains a deterministic acceptance surface for
recording work. It covers a counter, focused IME input, a form whose route is
replaced on submit, duplicate `Save` labels, a 100-row scrolling list, and a
failure probe controlled by `--dart-define=FLIWRIGHT_FIXTURE_FAIL=true`.

Run the fixture with the recording binding initialized before `runApp`:

```sh
flutter run -t lib/recording_fixture_main.dart
```

For baseline measurements, run the same scripted flow three times with
recording `off`, `standard`, and `full`. Record action count, post-action
capture latency (p50/p95), total duration, and peak artifact bytes in the run
manifest. Keep the raw `run.json`, `report.json`, and device/window details
with the measurement; do not treat a run without those artifacts as a
baseline.

## Generated Dart replay acceptance

Manual capture initializes `FliwrightRecordingBinding`. Dart integration replay
uses `lib/recording_replay_main.dart` instead: the generated test initializes
`IntegrationTestWidgetsFlutterBinding` and then calls this app-owned `main()`.
The fixture already declares `integration_test` in its dev dependencies.

From the repository root:

```sh
pnpm --filter @fliwright/core build
node scripts/verify-dart-recording.mjs --flutter /path/to/flutter --device macos --output /tmp/fliwright-dart-acceptance
```

The verifier copies the app to a temporary directory, resolves the selected
Flutter SDK with `pub get --enforce-lockfile`, generates a fresh test, analyzes
it, and runs the unchanged file
with a missing input parameter, a supplied parameter, and a configured business
failure. It checks startup, a 600 ms press, compound/scoped selectors, form input,
clear, route replacement, and confirmed text assertions. Evidence includes the
generated source, input fixture, source fingerprint, Flutter version, command
logs and `acceptance.json`; the temporary app is removed after execution.
This proves generated Dart replay on the selected device. It does not mark an
interactive recording verified or replace native-input recording acceptance.

A new Flutter project.

## Getting Started

This project is a starting point for a Flutter application.

A few resources to get you started if this is your first Flutter project:

- [Learn Flutter](https://docs.flutter.dev/get-started/learn-flutter)
- [Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Flutter learning resources](https://docs.flutter.dev/reference/learning-resources)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.
