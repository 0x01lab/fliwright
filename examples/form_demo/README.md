# form_demo

## Controlled camera result fixture

`lib/camera_fixture_main.dart` registers the public bridge camera test capability
only in this dedicated entrypoint. Its app-owned loaders resolve `portrait` and
`retake` from bundled assets. The UI consumes image, cancellation and error
results; retaking replaces the preview. Upload uses a local receiver, so this
fixture verifies application state rather than network/backend transport.

From this directory, launch the app on a configured Flutter target:

```sh
flutter run -d macos -t lib/camera_fixture_main.dart
```

Then, from the repository root, build the CLI and run the portable test from the
governed E2E package. Set `FLIWRIGHT_VM_SERVICE_URL` in the local environment to
the running app's VM Service URL:

```sh
pnpm build
cd e2e
node ../packages/fliwright-cli/dist/index.js run --test .fliwright/tests/camera.test.ts --scenario camera.empty --json --deadline 90000
```

The named `camera.empty` scenario resets the demo UI before each attempt. The
lazy `cameraTest` fixture separately resets its generation, verifies consumption
at teardown and clears queued results. The test covers preview, cancellation,
error, retake and local upload, consuming four results. Unused results fail the
attempt, including a skipped body; retries receive a new generation.

Evidence is marked `coverage: app-test-seam`. This workflow has been exercised
on macOS and iOS Simulator 26.5; permission dialogs, native camera UI, biometric prompts and
physical/virtual camera input require their own device acceptance. The normal
demo entrypoint does not register the seam, and release registration is refused.

For managed iOS validation, first generate a fresh disposable host using the
[native iOS fixture workflow](#mixed-flutter-and-native-ios-fixture). That host
stages only the native fixture by default. Before starting any run, extend it
with the maintained camera entrypoint, assets, test and named scenario. From
the repository root, set `FLIWRIGHT_FIXTURE_HOST` to that new host directory:

```sh
cp examples/form_demo/lib/camera_fixture.dart examples/form_demo/lib/camera_fixture_main.dart "$FLIWRIGHT_FIXTURE_HOST/lib/"
mkdir -p "$FLIWRIGHT_FIXTURE_HOST/assets/camera" "$FLIWRIGHT_FIXTURE_HOST/.fliwright/support"
cp examples/form_demo/assets/camera/*.png "$FLIWRIGHT_FIXTURE_HOST/assets/camera/"
cp e2e/.fliwright/tests/camera.test.ts "$FLIWRIGHT_FIXTURE_HOST/.fliwright/tests/"
cp e2e/.fliwright/support/camera-scenarios.ts "$FLIWRIGHT_FIXTURE_HOST/.fliwright/support/"
cp "$FLIWRIGHT_FIXTURE_HOST/fliwright.config.ts" "$FLIWRIGHT_FIXTURE_HOST/native.config.ts"
cat > "$FLIWRIGHT_FIXTURE_HOST/fliwright.config.ts" <<'TS'
import nativeConfig from './native.config.js';
import { cameraScenarios } from './.fliwright/support/camera-scenarios.js';
export default {
  ...nativeConfig,
  scenarios: { ...nativeConfig.scenarios, ...cameraScenarios },
};
TS
```

The generated host already declares `assets/camera/` in its pubspec. Keep the
native workflow's dedicated device and prepared Runner environment variables,
then run from the host:

```sh
node /path/to/fliwright/packages/fliwright-cli/dist/index.js run \
  --device-id "$FLIWRIGHT_NATIVE_DEVICE_ID" --target lib/camera_fixture_main.dart \
  --test .fliwright/tests/camera.test.ts --timeout 180000 --deadline 300000 --json
```

The validated iOS run consumed four queued results and passed its visible
business assertions. A preceding host-staging failure is retained separately
in the implementation plan. Keep the canonical run evidence before cleaning
the disposable host/device. This remains fixed-result application coverage.

The widget behavior can be checked without a running app:

```sh
flutter test test/camera_fixture_test.dart
```

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

## Mixed Flutter and native iOS fixture

`lib/native_fixture_main.dart` initializes the bridge and registers the app-owned
`nativeDemo.reset` screen baseline. Its buttons call the source overlay in
`native_fixtures/ios/AppDelegate.swift`: a real UIKit confirmation/cancellation
and the actual microphone permission API. The overlay never supplies an
authentication or permission decision itself. The screen reports the platform's
answer and fails visibly when the host channel is absent.

Generate an isolated iOS host from the repository root after installing workspace
dependencies and building the packages:

```sh
node scripts/prepare-native-demo.mjs --output /tmp/fliwright-native-host --flutter /path/to/flutter
```

The output directory must be new. This stages the maintained Dart/Swift sources,
usage description and TypeScript tests into a disposable Flutter project,
resolves the bridge from this checkout and links the workspace E2E dependencies.
Only that host's Simulator Debug build enables `FLIWRIGHT_NATIVE_FIXTURE`; the
fixture is absent from Release/device hosts. No device is booted or modified by
the staging command. Keep its generated project and local configuration outside
the repository, and remove the host after collecting evidence.

Use an explicitly selected dedicated iOS Simulator. Prepare the XCTest Runner
with `fliwright native prepare`, then set `FLIWRIGHT_NATIVE_DEVICE_ID`,
`FLIWRIGHT_NATIVE_APP_ID` (generated default `dev.fliwright.formDemo`) and
`FLIWRIGHT_NATIVE_XCTESTRUN` to the returned local product. From the generated
host, run the built CLI:

```sh
node /path/to/fliwright/packages/fliwright-cli/dist/index.js run \
  --device-id "$FLIWRIGHT_NATIVE_DEVICE_ID" --target lib/native_fixture_main.dart \
  --test .fliwright/tests/native-mixed.test.ts --test-name 'returns a real native' \
  --timeout 180000 --deadline 420000 --json
```

The two native confirmation cases can run together. The microphone cases must
run independently with a fresh prompt baseline. After installing the fixture,
with no active run, reset only this app on the dedicated simulator:

```sh
xcrun simctl privacy "$FLIWRIGHT_NATIVE_DEVICE_ID" reset microphone "$FLIWRIGHT_NATIVE_APP_ID"
```

Run the same CLI command with `--test-name 'allows the system microphone'`, then
reset the app's microphone prompt again and run
`--test-name 'denies the system microphone'`. These cases use English labels
from the validated Simulator recipe and explicit `system` scope. Never run both
against one unchanged permission baseline: the second prompt will not appear.
This external fixture preparation does not enable high-level permission
scenarios. Preserve each CLI result, canonical run directory and original
failure, and reset only owned permission state during cleanup. This fixture
does not cover camera frames, microphone audio capture or biometric hardware.

## Mixed Flutter and native Android fixture

`native_fixtures/android/MainActivity.java` is a source overlay for a disposable
Flutter Android host. In a debuggable app it registers the same fixture channel,
opens a real `AlertDialog`, and requests the actual Android camera/microphone
permissions. Release hosts do not register the channel. No third-party Android
automation library is added.

```sh
node scripts/prepare-native-demo.mjs --platform android --output /tmp/fliwright-native-android-host --flutter /path/to/flutter
```

This generates Java scaffolding, stages the maintained Activity, declares
`CAMERA` and `RECORD_AUDIO`, and stages the Android-specific tests/configuration.
Set `FLIWRIGHT_NATIVE_DEVICE_ID`, `FLIWRIGHT_NATIVE_APP_ID` (generated default
`dev.fliwright.form_demo`) and `FLIWRIGHT_NATIVE_PERMISSION_APP_ID` to the
permission controller package observed on the dedicated device. Android does
not use `FLIWRIGHT_NATIVE_XCTESTRUN`. Confirm the allow/deny resource IDs in the
actual permission dialog snapshot before using the supplied cases; OS recipes
may expose different IDs. These Android business cases have not yet passed
on a device and must not be counted as verified system coverage.

For managed emulator runs, also set `FLIWRIGHT_NATIVE_APK_ANALYZER` to the local
Android SDK `apkanalyzer` executable. The first actual attempt builds and owns
one Debug APK; later attempts launch that same installation. A differing
pre-existing installation is refused rather than overwritten. Cleanup stops
the app and removes only an installation created by this run. This path rejects
`--keep-app-alive`; it does not offer hot reload.

From the generated host, use the same managed CLI command shown above. Run
`--test-name 'returns a real native'` for confirmation/cancellation. Run each
permission case independently with an externally prepared fresh prompt baseline:
`allows the system camera`, `denies the system camera`,
`allows the system microphone`, or `denies the system microphone`.
The full file must not be run against one unchanged permission baseline.

After the Flutter business assertion, each permission case independently calls
the read-only app capability `nativeDemo.readPermissions`. It returns the app's
real `checkSelfPermission` and `shouldShowRequestPermissionRationale` values for
camera/microphone, without issuing a permission request. A false rationale does
not distinguish an unrequested permission from permanent denial. This app
readback does not replace the owner/child package-manager grants/flags check,
baseline restoration, or the pending managed permission pipeline. Camera
permission alone does not prove camera frames, and microphone permission alone
does not prove audio capture. The readback capability is Android-only.

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
