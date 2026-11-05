# @fliwright/native

Native UI adapters for Fliwright, using device-bound Android ADB and an owned iOS Simulator XCTest Runner. No Appium or WebDriverAgent is used.

Start with the [native testing guide](../../docs/native-testing.md) for project configuration, named scenarios, mixed Flutter/native tests, permission prompt baselines and troubleshooting. Portable agent instructions ship in the CLI workflows and test-writing Skills under `references/native.md`.

The package provides owned platform sessions, task ownership across Vitest retries, device/VM process binding and read-only environment diagnostics. `@fliwright/vitest` exposes `native` / `device` fixtures and native `expect`; the CLI exposes `native doctor`, `native snapshot`, `native recovery inspect`, `native recovery verify` and explicit `native prepare`. Managed CLI acquires ownership before launch, and the Worker supervisor retains ownership through executor termination and final reset. Native-enabled managed attempts each request a fresh app launch and verified endpoint, including retries and tests without a device scenario. Device scenarios support read-only capability checks before launch/Bridge connection and on every retry. Destructive baseline preparation and the complete mixed Flutter/hardware acceptance matrix are still in progress.

```ts
import { createNativeSession } from '@fliwright/native';

const runtime = await createNativeSession({
  enabled: true,
  platform: 'android',
  deviceId: process.env.FLIWRIGHT_NATIVE_DEVICE_ID!,
  targetAppId: process.env.FLIWRIGHT_NATIVE_APP_ID!,
});
try {
  // Use resource IDs observed in the target application.
  const selector = process.env.FLIWRIGHT_NATIVE_ELEMENT_ID!;
  await runtime.native.getById(selector).expect().toBeVisible();
  await runtime.native.getById(selector).click();
} finally {
  await runtime.dispose();
}
```

Keep machine identifiers, tool paths and prepared products in local runtime configuration. The optional `native` config crosses the shared `FLIWRIGHT_CONFIG` serialization boundary for CLI run/script and Vitest. Disabled native configuration starts no platform session. Fixtures verify the current Flutter VM PID against the selected device’s target process before exposing native controls.

```sh
fliwright native doctor --strict --json
fliwright native snapshot --json
fliwright native prepare --json
```

The first two commands resolve the project/environment native configuration; `prepare` explicitly builds the unsigned iOS Simulator Runner without launching a target app. Doctor never starts a Runner. A scoped `query` can be passed to snapshot using structured input; inspect the exact shape with `fliwright schema native.snapshot --json`.

Native actions and assertions enter the same RunSession as Flutter operations. Evidence uses the native Adapter while the action still holds its queue, with an independent capture budget. Trees have a `{ surface: 'native', schemaVersion: 1, snapshot }` wrapper and surface metadata; screenshots and trees remain ordinary archived artifacts readable by CLI export, Cloud and VS Code. Sampling is not atomic, screenshots are not marked as redacted, and failed evidence never replaces the original action error.

## iOS Simulator preparation

Run this explicitly on macOS with Xcode installed:

```ts
import { prepareIosRunner, createNativeSession } from '@fliwright/native';

const product = await prepareIosRunner();
const runtime = await createNativeSession({
  enabled: true,
  platform: 'ios',
  deviceId: process.env.FLIWRIGHT_NATIVE_DEVICE_ID!,
  targetAppId: process.env.FLIWRIGHT_NATIVE_APP_ID!,
  ios: { xctestrunPath: product.xctestrunPath },
});
try {
  const image = await runtime.native.screenshot();
  // Write `image` using the calling application's artifact policy.
} finally {
  await runtime.dispose();
}
```

Preparation builds the bundled UI-test project without signing or starting a device. The cache includes source, protocol, Xcode/SDK build, host architecture and signing inputs; a host lock prevents concurrent builds of the same product. Importing this package does not run platform tools. Session startup attaches to the selected, running target and never calls its `launch()`.

## Capability and safety limits

- Query before acting; IDs are Android resource IDs or iOS accessibility identifiers. Multiple matching nodes fail immediately. Use explicit `system` scope or an external application allowlist where needed.
- Android ADB input supports bounded ASCII, non-password `EditText` replacement with readback. Unicode and password replacement are unsupported. iOS input remains unverified and is refused by the runtime until validated. The experimental adapter additionally refuses non-printable/non-ASCII, password and over-4096-character input before dispatch; these guards do not enable input support. An attempted Simulator validation timed out, so the presence of `native-input.test.ts` is not a support claim.
- Device operations report `supported`, `unsupported` or `unverified` and readiness. Managed `prepare-device` failures expose a fixed, known capability name and state while preserving the original platform error only in the supervisor. Subsequent fenced requests retain that sanitized first failure; they never replay uncertain platform work. Android emulator fingerprint injection remains unverified/not ready until device-bound enrollment and recovery are proven. Candidate fingerprint IDs do not certify a baseline; `baselineVerified` is rejected. Acknowledging an event does not prove application authentication.
- Face ID/Touch ID automation on iOS, permission mutation, media import and camera sources are not implemented by these adapters. Real biometric sensors require a human.
- App-owned fixed camera results are available separately through the bridge's `FliwrightCameraTestCapability` and the Vitest `cameraTest` fixture. They cover application behavior and do not require a native Adapter; they do not establish camera permission, camera UI or sensor coverage.
- Whole iOS accessibility trees can be expensive. Locator queries push filters into XCTest; a full snapshot still has a deadline and may fail.
- Sessions own a host-wide device lease. Unknown write outcomes are never replayed; cancellation or unfinished work prevents session reuse. Confirmed adapter cleanup precedes lease release, and failed cleanup quarantines the device.
- Password text is masked in snapshots. Whole-screen screenshots can still contain sensitive content; the caller must apply its evidence policy.

See [design](../../docs/superpowers/specs/2026-11-03-native-device-automation-design.md) and [implementation plan](../../docs/superpowers/plans/2026-11-03-native-device-automation.md) for the remaining integration and release gates.

## App-owned camera results

The app test entrypoint explicitly registers `FliwrightCameraTestCapability` with app-readable PNG/JPEG fixture loaders and injects its `capture(generation: ...)` method into the app's camera service. Registration is refused in release mode. Production camera plugins are never replaced automatically.

```ts
import { test, expect } from '@fliwright/vitest';

// This scenario and these Keys belong to the bundled camera demo.
test.scenario('camera.empty')('previews a fixed camera result', async ({ page, cameraTest }) => {
  await cameraTest.enqueueResult({ kind: 'image', fixtureId: 'portrait' });
  await page.getByKey('camera_capture').click();
  await expect(page.getByKey('camera_selected')).toHaveText('Selected: portrait');
  await cameraTest.assertConsumed();
});
```

`enqueueResult` also accepts `{ kind: 'cancel' }` or `{ kind: 'error', code, message? }`. Each capture consumes one queued result, and an empty queue fails. The lazy fixture starts a fresh generation for each attempt; teardown fails on unused results and resets that generation. Stale callbacks or cleanup cannot consume or reset a newer generation. Requests and finalization have bounded budgets; an unknown write outcome is never replayed.

Fixture IDs are portable names resolved inside the app. No host paths or image bytes are included in status or timeline metadata. The queue accepts at most 32 results per generation; image loaders have a five-second budget, a 10 MB byte limit and a 16 MP decoded image limit. Operations carry `coverage: 'app-test-seam'`. The demo's upload receiver is local and does not validate a network/backend upload. See the [demo workflow](../../examples/form_demo/README.md#controlled-camera-result-fixture) for a runnable entrypoint and CLI test.

## Managed ownership

A named `TestScenario` may require `{ kind: 'device', requiredCapabilities: ['native.query', 'native.click'] }`. Required capabilities must be both supported and ready. Each attempt receives a live, single-use preparation handoff bound to its scenario, mode and Adapter generation; the app stage checks readiness again and records the device summary. Declaration fields for permissions, media, camera sources and device/biometric baselines are validated, but execution rejects them before platform work until preparation, readback and restoration are implemented. Use `run --scenario` for device scenarios; the app-only `scenario.apply/reset` commands cannot prepare them.

Managed relaunch uses an authenticated, private loopback control channel. It retains device ownership while disposing the old attempt, releasing its endpoint and stopping the old Flutter process before launching again. Each attempt uses its new endpoint and rechecks VM process binding. Writes are requested once; failures or unknown outcomes fence later attempts. Driver cleanup follows passive diagnosis, and unconfirmed cleanup fails the test and quarantines the device. This lifecycle has subprocess/worker regression coverage and a real iOS Simulator two-case confirmation/cancellation run with separate attempt generations. Full mobile acceptance remains pending. Attach runs keep their existing app and reject destructive preparation.

Preparation failures identify a fixed stage such as `launch-app` or `verify-endpoint`, including when preparation times out while work remains active. Original platform errors remain supervisor-only; the public preparation error contains no raw VM URL, token or path. A stage name does not confirm an operation's outcome. Quarantined devices still require verified baseline recovery. Use `native recovery inspect`, `verify`, and the scoped `restore` workflow described below; there is no generic clear command, and removing a dirty marker is not recovery.

## Inspecting retained recovery evidence

```sh
fliwright native recovery inspect --json
```

This command reads the configured device's local lease storage without creating
directories, acquiring ownership, invoking platform tools or modifying records.
It works while the device is offline. The library equivalent is
`inspectDeviceLease({ platform, deviceId })`; an optional private `rootDir`
supports embedding and isolated tests.

The report contains a hashed device key and evidence fingerprint, local owner,
delegate, operation and recovery-process states (`absent/live/exited/invalid`),
owned host tool/process-group state (`hostTool`), retained record states and
fixed issue codes. During a managed device operation, the native executor
persists an opaque resource and process-group identity before dispatch. Inspection
uses a bounded host process listing to detect a surviving tool descendant after
its owner exits; zombie-only groups are reported exited. It omits raw credentials, journal
contents, arbitrary saved error text and storage paths. `present` means a
bounded JSON object was readable; it does not validate a platform baseline.

For an abandoned iOS Runner with a valid owner-bound journal, run
`fliwright native recovery verify --json` while its Simulator is online. The
library equivalent is `inspectIosRunnerRecovery({ platform: 'ios', deviceId })`.
This reads the exact Simulator's boot timestamp and complete launchd inventory,
then checks that local evidence and the Simulator boot did not change during
readback. It rejects live owners/tools, existing recovery claims, cancellation,
malformed output and evidence replacement. The result is `runner-absent`,
`runner-matches-record` or `runner-mismatch`, plus
`recordedBootGenerationMatches`. A matching PID and boot timestamp cannot rule
out PID reuse within the same boot and cannot establish process ownership.
The check does not terminate a Runner, acquire a recovery claim, rewrite evidence
or clear quarantine.

Normal XCTest sessions also recheck their initial Simulator boot generation
before committing readiness and during teardown. Rebooted Simulators retain
their Runner journal and exclusion instead of terminating a same-numbered PID
from a new boot. These checks also constrain the explicit `native recovery restore`
transaction: only a matching owner-bound Runner record may be restored.

The internal recovery-control primitive now has a Swift Network loopback listener
and a Node HMAC challenge client. It accepts only `identify` and a single
generation-bound `shutdown`; a lost shutdown reply is never replayed. The same
Swift source is compiled in host protocol tests and in a temporary Simulator
XCTest entry for transport validation. Production `testServe` now starts the
control endpoint, and protocol v2 readiness binds its port. Before xcodebuild
starts, a private schema v2 journal persists the session and recovery key;
readiness is committed only after platform identity checks and a signed challenge.
Normal teardown authenticates again and requests self-shutdown, then confirms
both host-group and Simulator exit before completing the journal. It never uses
bundle/PID termination as a fallback. Lost ACKs are read back without replay;
unconfirmed results retain evidence. Legacy journals remain isolated. The public
restore command uses the same authenticated control and independent platform readback;
a mismatched Runner is never terminated by bundle or PID fallback.

For development validation after building this package, run
`node packages/fliwright-native/scripts/verify-ios-recovery-control.mjs <dedicated-Simulator-UDID>`
from the repository root; an optional second dedicated UDID runs both Runners
concurrently and checks cross-device rejection. The selected Simulators must be
booted and available under the normal device lease. The experiment uses temporary
XCTest entries, kills their private broker processes, authenticates again, asks
the Runners to end themselves and independently reads back their absence. It
retains private result artifacts and keeps unresolved lease evidence on failure.
It does not bypass existing quarantine or validate production recovery.

`node packages/fliwright-native/scripts/verify-ios-production-session.mjs <dedicated-Simulator-UDID>`
instead runs the shipped Runner/session for two independent start/screenshot/stop
cycles. `verify-ios-owner-crash.mjs` uses the same argument on a disposable
Simulator, kills its actual production owner, checks host-group/Runner exit and
confirms that original evidence still blocks acquisition. The crash experiment
deliberately retains its recovery journal; it does not restore or release the
abandoned device. Use its retained result for subsequent recovery verification.

Long-lived XCTest `xcodebuild` is tracked separately from short device operations
for the full session lifetime, including delegated Vitest sessions. Session
teardown waits for the owned host process group and pipes to close before it
checks the Simulator Runner process list. These checks establish host and
Simulator process cleanup only; they do not restore app, permission, media or
device baselines.
Unknown files, links, nonregular/oversized/malformed records and changed storage
remain in place. Exit 0 means inspection completed, including when issues are
reported. An `available` local inventory does not prove platform readiness.

The low-level recovery reservation primitive is internal; public callers use
`native recovery restore` or `restoreIosRunner` / `restoreAndroidApp`. It requires the exact inspected
fingerprint and refuses live or invalid prior owners, delegates and operations.
It excludes normal acquisitions and other recoverers, checks original evidence
and claim identity before/after work, and retains the reservation while work is
unresolved. Cancellation and the total budget fence work; releasing a settled
reservation retains quarantine and all original journals. A raw crashed reservation is not automatically adopted. No reservation callback
or boolean result can clear quarantine. The public restore transaction requires
owner-bound resource evidence, durable epochs and independent platform readback
before archival. A quarantine without a recoverable Runner/app record is not
an eligible restore candidate; retain it rather than deleting the lock.

Device release now refuses any retained app or permission recovery record,
including a dangling link, even if no earlier dirty marker exists. It preserves
the original record and lock and records quarantine instead of discarding
unconfirmed cleanup evidence.

The maintained [mixed iOS fixture](../../examples/form_demo/README.md#mixed-flutter-and-native-ios-fixture) also passes real system microphone Allow/Don’t Allow flows with Flutter business assertions on iOS 26.5 / Xcode 26.6. Each microphone case uses an independently reset external prompt baseline; this does not enable permission scenarios or prove automatic restoration, audio capture or camera/biometric hardware. The temporary host explicitly enables its source overlay only for Simulator Debug. VM binding accepts the observed iOS 26 `UIKitApplication:<bundle>[hex][rb-legacy]` label only with an exact bundle and current PID. Earlier failed runs are retained in the acceptance record; these smoke cases are not a reliability sample. During a later input experiment,
a timed-out operation and unconfirmed cleanup retained quarantine. A mismatched
Runner identity refused restoration, and a separate startup failure retained an
empty-resource quarantine; neither condition authorizes deleting lease evidence.
Input remains unverified. See the troubleshooting section in the native testing guide.

`openNativeDevice()` retains task ownership while `createRuntime()` replaces attempt adapters. A managed launcher can call `delegate()` before creating an adapter, then pass the opaque grant only to its supervised test child. The parent retains device exclusion; delegated task claims serialize within that owner. `DeviceLeaseManager.fromEnvironment()` validates the host/device key, grant digest, live parent and generation. Parent loss fences operations and stops owned adapters; unconfirmed cleanup retains quarantine. CLI run/script and the Cloud Worker use this mechanism internally. Do not persist grants in project configuration or artifacts.

## Android permission preparation primitive

`NativeDeviceSession.preparePermissions(requests, { mode: 'managed-start', timeout?, signal? })` is a low-level owner API. It is not wired into device scenarios or `device.permissions.set`, and does not make those capabilities supported. Its current evidence is deterministic regression coverage; actual Android permission UI and business acceptance remain pending.

It accepts only camera/microphone on a dedicated Android emulator, primary user 0, targetSdk ≥ 23 and an isolated app UID. The managed launcher must force-stop the app first; preparation also checks that no process of its UID is running. The entire batch is validated before writing. Unknown/fixed/policy/one-time flags and custom or UID-wide app-op modes are rejected. Only default package app-op policy is accepted, and app-op modes are never changed. The returned state proves package-manager grants/flags readback, not effective camera access or a permission dialog.

The same owner offers these low-level Android APIs:

- `stopApp({ mode: 'managed-start', timeout?, signal? })` validates the installed package, primary user and isolated UID before sending one force-stop command. It confirms both the force-stopped flag and absence of all processes of that UID. Dispose the owner's active Adapter before calling it. A lost reply, surviving process or cancelled dispatched stop leaves an unknown result and quarantines the device.
- `inspectPermissions(['camera', 'microphone'], { timeout?, signal? })` independently reads grants, flags and default app-op policy while the app may be running. It can coexist with an active Adapter through the shared operation mutex. It never writes or captures a restoration baseline, so disposing an observer cannot restore another owner's state. Observation still requires the dedicated emulator and supported permission state described above.

`inspectAppState(names, { timeout?, signal? })` independently observes the single installed base APK SHA-256, isolated primary-user UID, current main PID and requested camera/microphone grant/flags/default app-op. It checks installation/process identity before and after permission observation, then rechecks device ownership. It supports an active Adapter under the shared operation mutex and never captures a restoration baseline. An empty permission set still verifies installation and process identity. These sequential observations are not an atomic platform snapshot.

`prompt` revokes and clears USER_SET/USER_FIXED; `denied` revokes and sets USER_SET while clearing USER_FIXED (prior denial, not permanent denial); `granted` grants and clears those two flags. Other recognized user-sensitive flags are preserved. Each call replaces the previous declaration; omitted permissions restore their captured originals. Owner disposal restores and reads back the originals under its own cleanup budget. An owner with a managed installation verifies and stops it during cleanup before restoration. A caller using only the permission primitive must confirm the final app stop before disposal. A dispatched write with an unknown result fences later writes/restoration and quarantines the device.

The retained parent and delegated child share an operation mutex inside the device lock. Whole preparation/restoration batches, Adapter/Runner initialization, Adapter requests and VM process binding cannot overlap across processes. Lock waits consume operation budgets. Cancellation retains unresolved platform work; release refuses an active operation and retains quarantine. Initialization, cleanup, quarantine and release failures preserve their original causes.

The owner's cleanup has one deadline for waiting on outstanding work, disposing the Adapter and restoring permissions. Restoration uses the remaining time and the same cancellation signal; it does not receive a fresh budget after Adapter disposal. If cleanup expires during a read or lock wait, the device remains quarantined and no subsequent restoration command is dispatched after that work returns. Already-dispatched platform commands can still have an unknown outcome.

A maintained [Android mixed fixture](../../examples/form_demo/README.md#mixed-flutter-and-native-android-fixture) provides a debug-only real confirmation dialog, camera/microphone permission requests and an independent app-side permission readback. The staging script creates its host outside the repository with the required manifest permissions and Android-specific test/configuration files. Its business acceptance remains pending a runnable dedicated Android device; it does not enable high-level permission declarations or establish biometric/camera-frame coverage.

Managed CLI and Worker now call the retained owner's attempt preparation between confirmed app stop and relaunch. The owner revalidates the scenario against its frozen configuration and probes required capabilities with a fresh preparation Adapter, then closes it before launch. The Worker passes only project/attempt/scenario identity through bounded supervisor IPC, with cancellation, replay/concurrency rejection and fencing after failure. Final supervisor reset cancels and waits for preparation; unresolved work prevents reset and reuse. The child independently checks readiness after relaunch. This path currently executes read-only requirements; permission declarations remain rejected pending mutation integration and platform acceptance.

## Android installed app lifecycle primitives

The retained `NativeDeviceSession` exposes `installApp({ apkPath, apkAnalyzerPath }, { mode: 'managed-start', timeout?, signal? })` and `launchApp({ mode: 'managed-start', timeout?, signal? })`. Managed CLI/Worker Android emulator runs consume these methods through a retained supervisor control; device permission scenarios remain gated. Android platform acceptance remains pending; their current evidence is deterministic lifecycle/ownership tests and actual host APK inspection.

Installation inspects a private temporary APK copy with the explicit Android SDK APK analyzer, computes SHA-256 and validates the target package, Debug flag, runtime SDK, default app/launcher process and one exported launcher. The single APK is limited to 512 MiB. An existing install must expose one matching `/data/app/.../base.apk` and an isolated User 0 UID; differing, unavailable and split installations are refused. New installation additionally requires a dedicated emulator with only User 0. It sends one install without replace/grant-all options, journals ownership before dispatch and reads back the installed hash and UID. It does not launch the application or prepare permissions. A second installation in the same lifecycle is refused.

After the caller stops the app and prepares permissions, `launchApp` verifies the artifact/UID and stopped processes, captures a device log cursor and launches the installed Activity directly. It polls bounded current-PID log samples newer than that cursor, accepts only authenticated loopback VM endpoints, allocates a device-bound forwarding port and verifies that mapping and the live process. The result contains `url`, `pid` and a fresh `generation`. The supervisor must still verify VM/Bridge readiness and use the existing process binding before exposing a test driver. Neither `flutter run`, `flutter install`, global log clearing nor service-auth disabling is used. This finite launch path does not provide Flutter hot reload.

With an owned installation, stop and permission writes first recheck its artifact/UID; stop also verifies and removes only the session's forwarding mapping. `quiesce()` cancels and awaits outstanding work, disposes the local Adapter, verifies the original installation, force-stops its processes and restores permissions before removing only a newly installed app. It retains device exclusion through the Worker reset; `dispose()` performs the same cleanup if needed and then releases ownership. Matching pre-existing apps are kept. If another Android user appeared, a newly installed app is not uninstalled. Cleanup has an independent bounded signal, so top-level cancellation does not skip restoration or redirect it to a replacement app.

All lifecycle work shares the parent's cross-process operation mutex and tracked cancellation/cleanup budget. Delegated child leases have no installation recovery path and cannot install. A private, synced recovery record is written before platform mutations and contains artifact/ownership state, never VM authentication URLs. Unknown writes are not replayed or blindly undone. Unconfirmed cleanup retains quarantine; a real parent lease also retains its managed app recovery record and lock. This record covers installation/launch ownership; crash recovery of complete permission scenarios remains unfinished.

Normal quiescence completes the permission journal after readback and owned app cleanup, then completes the installation journal before lease release. New installation records use version 2 with random journal and hashed device identities. First publication is exclusive; later checkpoints and completion verify the original file identity, exact bytes and enclosing directory. Copies with equal contents, hardlinks, symlinks and changed records fence further writes and remain in place. An app journal is removed only by its own settled, closed lifecycle; permission-completion failure retains the app record and quarantine. This closes the normal cleanup path, and does not add an old-journal adoption or device recovery API.

Managed Android emulator launches require `native.tools.apkAnalyzer` from the local Android SDK. Project/entry/Flutter executable/build arguments remain with the supervisor; the executor receives only a private delegation and authenticated control. Static skips do no build, install or launch. The first real attempt builds/stages/installs once; later attempts stop and launch those same verified bytes, independently verify Bridge capabilities and VM PID, and bind the current process before returning an endpoint. Build/installation/verification failures fence further attempts without a Flutter launcher fallback. Keepalive is rejected for this owned installation path. The control returns strict installation/launch expectations; the test child independently verifies its VM PID and observes APK/UID/PID/permissions before any body, including tests without a driver fixture. A single-use readback binds the attempt, scenario, managed/launch/Adapter generations and hashed device identity; sanitized metadata is recorded in the timeline. Ordinary attempts currently replace permissions with an empty declaration. Nonempty permission scenarios, actual Android business acceptance and hardware support remain pending.
