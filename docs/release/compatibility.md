# Fliwright Developer Preview Compatibility

**Status:** Developer Preview
**Updated:** 2026-10-17

Direct Vitest runs using `fliwrightPreset` now include a parent recovery reporter
alongside project reporters. The editor's direct runner loads it explicitly
alongside its JSON reporter. If worker terminal persistence exhausts its budget,
the parent restores result/Timeline/Trace from the runner's recovery metadata;
evidence remains partial and original business errors remain unchanged. CLI
and reporter recovery share the core `restoreRunAttempts` implementation.
Real subprocess tests cover passing and failing bodies with hung terminal
Timeline writes; 15 additional concurrent rounds covered 165 attempts. This
fix explains a captured running Timeline, without assigning a cause to every
historical missing-Trace report. Parent disk errors still surface as failures.

This page records the compatibility claims that are safe to make for the
current release line. A platform is not considered supported merely because a
package compiles on it; it must also pass the generated Flutter smoke path or
be listed as a package-level verification only.

The remaining native macOS and exio gates will run on another computer, as
confirmed by the user; see the [machine handoff](../superpowers/plans/2026-10-16-automation-recording-completion-machine-handoff.md).
An expanded macOS replay of six unchanged files from native iOS captures failed
in round 14 at 640 × 720: the first long press reported no matching widget,
although the subsequent context dump included its key. Its start screenshot
also timed out. The failed/partial run and portable export are retained; a
100-iteration simplified reset/long-press probe passed without reproducing it.
This remains unexplained and does not extend the existing single-flow window
acceptance claim or establish native macOS recording.

A subsequent six-file cross-platform slice completed 30 consecutive rounds at
640 × 720 and 20 at 821 × 777, with scenario-driven tree rebuilding per test.
Both sizes also passed business-counterexample and restored-App checks using
the unchanged source and strict replay. All 54 runs (324 attempts) were exported
and read back while their source folders were moved; 1,902 PNGs decoded and
36 final-state samples were visually checked. This extends the listed replay
slice while retaining the original intermittent failure. Two temporary host
window-size mistakes and a separate failed/partial App-start run with no
captured screenshots remain failed evidence. Explicit foreground activation
preceded the successful counterexample rerun; its causal role is unproven.
Native macOS capture and exio remain pending on the other computer.

Navigation settlement now also waits for queued transient callbacks. A paused
Flutter lifecycle can suppress frame scheduling while a route ticker remains
pending; checking only hasScheduledFrame falsely reported stability. Three
deterministic bridge regressions and an independent real macOS paused-frame
probe went red before the fix and green afterward. On budget expiry, the
existing timedOut result makes Page navigation throw by default; resuming
frames permits normal settlement and long press. This proves the controlled
paused-frame path, without attributing historical intermittent failures to it.
The updated bridge also passed 20 unchanged six-file rounds at each window
size (40 runs, 240 attempts). All runs were exported and read back with source
folders moved; 1,400 PNGs decoded and 24 terminal samples were visually checked.

## Version matrix

| Layer | Verified / required version | Notes |
| --- | --- | --- |
| Node.js | 20 or newer | Required by all public TypeScript packages. |
| TypeScript | 5.5 or newer in the workspace | Consumer projects may use a compatible newer version. |
| Vitest | 4.1.11 | `@fliwright/vitest`, CLI peer dependency, and generated projects use this line. |
| Dart SDK | 3.5 or newer, below 4.0 | Required by the published bridge packages. |
| Flutter | Stable channel; package constraints apply | The bridge runs only in debug/profile or test builds. |
| Design QA Flutter | 3.24 or newer | `fliwright_design_qa` is an optional Labs package. |

## Platform status

| Platform | Status | Evidence / limitation |
| --- | --- | --- |
| macOS desktop | Generated E2E smoke verified | Covers bridge startup, VM discovery, CLI execution, and report persistence. |
| macOS recording modes | Current core/full CLI scale and controlled ten-minute recording verified | Flutter 3.41.9 / Dart 3.11.5: core/full CLI each passed 1,002 actions per mode; standard core capture P95 222.859ms and full CLI combined action P95 236.271ms. A 600,000.815ms recorder run retained 1,000 reliable actions/frames and 2,001 events within cache budgets. Portable readback, PNG decoding and sampled image-counter OCR passed. Native input remains separate. |
| VS Code recording and replay | Controlled Extension Host workflow verified | VS Code 1.142.0 on macOS: init-generated configuration and test/script discovery, app-specific example execution, recording, checkpoint confirmation, unchanged replay/save, direct Vitest and CLI, real assertion counterexample, failure viewing, cancellation and portable-folder opening. Source identities select exact canonical attempts. Input is bridge driven; native input acceptance remains pending. |
| macOS native recording | Acceptance pending | Current host lacks accessibility/event-posting access. Native mouse/keyboard and IME recording, followed by unchanged generated replay across window sizes, remain separate gates. |
| macOS generated replay across windows | Controlled fixture slice verified | The same generated cross-page input/submit test passed twenty independent replays at both 821 × 777 and 640 × 720. The App was rebuilt/relaunched between sizes; every run checked image dimensions and complete evidence. Original input was bridge driven, so this does not establish native recording or every gesture/IME workflow. |
| Linux | Dart package and TypeScript CI verification | Generated desktop E2E is not the release gate on this runner. |
| Android | API 35 ARM64 emulator input/cross-page/submit slice verified | Android 15, emulator 36.6.11, Flutter 3.41.9: Android system touch/keyboard input recorded a destroying form; the unchanged generated TypeScript test passed its saved-value assertion. The same file failed against a temporary App that discarded the saved value. Both portable runs retained consistent outcomes and all eleven PNGs decoded. System IME composition, other gestures and physical devices remain separate gates. |
| iOS | iOS 26.5 ARM64 simulator input/cross-page/submit slice verified | Xcode 26.5, iPhone 15 simulator, Flutter 3.41.9: XCTest system touch/keyboard input recorded a destroying form; the unchanged generated TypeScript test passed its saved-value assertion. The same file failed against a temporary App that discarded the value. Both portable runs retained consistent outcomes and all eleven PNGs decoded. System IME composition, other gestures and physical devices remain separate gates. |
| iOS native editing and gestures | Controlled long press, clear, selected replacement, Pinyin composition, autofocus/Paste and unsupported-pinch gates verified | Native XCTest input produced unchanged generated TypeScript replays with real value/count checkpoints. Pinyin keys produced observed noncollapsed composing ranges; only committed 你好 became a fill. A real two-finger pinch remained partial/draft. Exported gesture before/after-fix, IME and Paste runs retained outcomes with 34 decoded PNGs. Other keyboards, gestures, macOS windows, physical devices and mobile fault matrices remain separate gates. |
| iOS native drag and repeated labels | Controlled slow drag and second-Save slices verified | Native XCTest captured a roughly 1,283ms drag and the second of two Save labels. Unchanged generated TypeScript files passed strict replay, failed against disabled scrolling/no-op saving, and passed after restoration. Eight portable runs and all 41 PNGs read back with sources moved, retaining the original drag failure and a historical healed false positive. Other platforms, arbitrary trajectories, physical devices and macOS window gates remain separate. |
| Android native drag and repeated labels | Controlled slow drag and second-Save slices verified | System adb input captured a roughly 1,370ms drag and the second Save. Unchanged generated files passed strict replay, failed against disabled scrolling/no-op saving and passed after restoration. Six portable runs and five recordings retained 33 decoded PNGs with source folders moved. Three earlier budget-exceeded drafts remain separate. Capture now proves an unkeyed control within its keyed list item before weaker candidates, retaining the original 12ms budget. Physical devices, arbitrary trajectories and other input/platform gates remain separate. |
| Android/iOS recording interruption | Controlled App termination, AbortSignal and CLI SIGINT slices verified separately | After native system input on each platform, real App termination returned failed with the action, raw events and prior observation preserved; cancellation returned partial/cancelled and allowed a new recording session. Actual CLI subprocesses handled OS SIGINT, verified unchanged generated tests and exited normally. Portable recording/run readback and all sixteen PNGs passed with sources moved. Physical-device and exhaustive recording faults remain separate gates. |
| Android/iOS runtime faults and endpoint lease | Controlled real VM slices verified separately | Each platform passed two-worker whole-test serialization with exactly 24 increments; worker SIGKILL/cancellation, transport loss with hung cleanup, screenshot timeout, project cleanup failure, unwritable host run directory and missing-file export checks retained the intended outcomes and original errors. Cancelled endpoint waiters never ran; a dead holder's lease was reclaimed for one exact increment. Eighty PNGs decoded across twelve portable runs. These runtime tests use bridge actions, with host process/filesystem fault injection; they do not establish physical-device or native-gesture stability. |
| Web | Not release-gated | Dart VM Service and bridge behavior require a separate validation path. |
| Windows desktop | Not release-gated | Add a generated desktop smoke job before claiming stable support. |

## Runtime constraints

Android VM Extension events can include `__destinationStream` inside
`extensionData`. The connector removes this VM routing field before exposing
the extension payload; recording protocol v2 remains strict for other unknown
fields. The initial real Android run rejected every event and returned partial;
that failure led to a failing connector regression and this transport fix.
The independent native-input probe and full generated replay subsequently
passed. Local evidence is under the `acceptance` directory located by
`/tmp/fliwright-android-environment.json`; these temporary files are not a
portable release attachment. This Android emulator result does not establish
macOS native input or system IME acceptance. The independently verified iOS
slice below has its own evidence.

iOS input/cross-page/submit evidence is under the `ios-acceptance` directory
located by the same temporary environment file: native XCTest result bundles,
capture events, unchanged generated source, positive and save-loss
counterexample runs, and portable/image verification reports. The simulator
ran iOS 26.5 build 23F73 on ARM64. XCTest activated the already-running App;
restarting it during capture invalidated the existing VM connection. An early
native trial reached an empty submitted value and failed its assertion; that
failure is retained and its cause is not established. The final positive
trial and unchanged generated replay passed with the expected saved value.
This result establishes the stated simulator slice, with no claim about
system IME, exhaustive input stability, other gestures or physical devices.

Further independent iOS simulator evidence is located under
`ios-gestures-acceptance`, `ios-ime-acceptance`,
`ios-paste-target-acceptance` and `ios-pinch-acceptance` in that temporary root.
These establish the additional slices in the table, including system Pinyin
composition, without expanding the original cross-page report's scope.
Native gesture replay exposed a bridge bug: pointer up was sent immediately
with a future timestamp, so Flutter's long-press timer never fired. The bridge
now holds the pointer for the requested integer or fractional milliseconds.
Native autofocus/Paste exposed a missed listener during a route transition;
the recorder now follows the actual primary-focus context and refreshes
zero-match candidates at the edit while the original element is mounted.
Deterministic widget regressions preceded both fixes. Earlier failed and draft
runs remain available; none are reported as passing replays.

Additional reports under `ios-drag-acceptance`, `ios-drag-fixed-acceptance`
and `ios-repeated-acceptance` retain native captures, original source, strict
positive/counterexample/restored verification and portable image checks. Slow
drag replay exposed lost nested selector constraints and discarded duration;
the generator now retains nested match objects and total fractional-millisecond
drag duration through TypeScript, editable Flow and bridge pointer timing.
This replays a linear interpolation, not every original pointer sample.
The first disabled-scroll counterexample was incorrectly passed by automatic
selector healing to a generic ListTile. Explicit recording verification now
disables assertion healing inside its dedicated runner subprocess; the
unchanged candidate must satisfy its confirmed targets. That historical false
positive remains available and is excluded from successful acceptance.
Independent generated Dart analysis and an actual macOS Flutter integration
test verified timedDrag and unique containing finders; the initial headless
duplicate-finder failure and temporary platform setup failures are preserved.
These Dart checks do not inherit TypeScript verification or establish native
macOS recording.

iOS recording-interruption evidence is under `ios-recording-kill-acceptance`,
`ios-recording-abort-acceptance` and `ios-cli-record-sigint-acceptance` in the
same temporary root. Public capture finalization took about 106ms after App
termination and 7ms after AbortSignal; CLI SIGINT stop, generated replay and
process exit took about 2.6 seconds. Each recording retained one native action,
three raw events and one screenshot. These recording screenshots are earlier
observations showing Count: 0, not evidence of the UI at failure time; the
native assertion and the verified replay independently observed Count: 1.
The verified run exported with complete evidence and consistent manifest,
result, Timeline and Trace outcomes. These are temporary local acceptance
records, not portable release attachments.

Android has independent matching native-recording fault reports under
`android-recording-kill-acceptance`, `android-recording-abort-acceptance` and
`android-cli-record-sigint-acceptance`. App force-stop returned failed with
`Service has disappeared` in about 37ms, AbortSignal returned partial/cancelled
in about 11ms, and CLI SIGINT plus verified replay/exit took about 1.2 seconds.
All eight Android portable PNGs decoded; the replay's final Count: 1 image was
visually checked independently of the recording's earlier observation.

Runtime fault reports are `/tmp/fliwright-{android,ios}-scenario-real-matrix/acceptance.json`,
`/tmp/fliwright-{android,ios}-vm-interruptions/acceptance.json` and
`/tmp/fliwright-{android,ios}-vm-disconnect/acceptance.json`; whole-test lease
reports are `/tmp/fliwright-{android,ios}-whole-test-live-acceptance.json`.
Missing-evidence exports and cancelled-waiter/dead-holder recovery have
independent reports in `/tmp/fliwright-{android,ios}-missing-export` and
`/tmp/fliwright-{android,ios}-lease-recovery-polling`. Each report describes its
scope. Screenshot loss is injected through a transparent WebSocket proxy;
unwritable directories and signals affect the macOS host running Node workers,
while actual actions and evidence come from the mobile Flutter App.

- Add a test-only Flutter entrypoint that calls `FliwrightBridge.init()`.
- Run the app in debug/profile or a Flutter test build; the bridge is inert in
  release mode and does not register VM Service extensions or mock servers.
- The app must expose a locally reachable Dart VM Service endpoint.
- `fliwright_design_qa`, Riverpod, MCP, and TDD are optional packages and are
  not required for the core CLI/Vitest journey.

Project fixtures created through `extendFliwrightTest` retain named scenario
support through nested extensions. Scenario preparation completes before the
test body; fixture setup follows Vitest dependency ordering. Real Vitest
subprocess checks cover lazy fixture injection, preparation failure and project
cleanup failure. A controlled macOS Flutter check also exercised the public
extended `test.scenario` entry and verified the applied scenario fingerprint.
The editor and terminal route standard `.script.*` files through the shared
Vitest preset, including scripts importing project fixtures from support
modules. Real subprocess tests verify indirect TypeScript imports, script
source identity and editor canonical artifacts, and execute the generated
terminal command.

## Release confidence

The current repository gate covers npm and pnpm local tarball consumers, an
exact-version npm registry consumer after publish, Dart package
analysis/tests, and one generated macOS Flutter smoke run. Stable 1.0 still
requires at least three independent external Flutter applications and a
declared compatibility/deprecation policy.

Recording performance remains a separate release gate.
[`recording-performance.md`](./recording-performance.md) records the synthetic
benchmark and controlled real macOS VM measurements, including operation,
capture/write and combined timings, with separate full CLI/Vitest measurements
including journal persistence. Recorder caches now have bounded event buffers,
bounded screenshot work and file-backed binary references; deterministic scale
regressions and real VM soaks report their observations. Historical soaks include
a partial run and a successful repeat before the composited screenshot and frame
wait fixes. The current implementation passed a 600,000.815ms repeat with 1,000
reliable actions/frames and 2,001 ordered events. All 1,000 referenced PNGs passed
portable decoding; 21 sampled frames passed image-counter OCR, and resources
stopped. This verifies the controlled macOS VM stability slice. Reliable native
input recording and the remaining
platform gates are still unverified. Recording
manifests now use the shared schemaVersion 2; replaced base64 manifests are
rejected without a compatibility reader.

Same-endpoint tests now retain one lease through setup, retries, body,
afterEach, fixture cleanup and final runner evidence. The default lease root
is user-wide, so separate working directories coordinate; tokenized HTTP and
WebSocket aliases use the existing VM URL normalization. Different endpoints
keep separate cached driver connections. Real Vitest worker regressions cover
whole-test ordering and failure/skip/retry release. Two real macOS Flutter
workers also passed exact counter checks from 0 → 12 → 24, including afterEach
and project fixture cleanup; both attempts had complete evidence. All 28 PNGs
were decoded from a portable export after moving the original run. Input was
bridge driven. Evidence: `/tmp/fliwright-whole-test-live-acceptance.json`.

A live process keeps its lease even if its heartbeat is delayed. A real child
process check blocks heartbeat timers, verifies its parent cannot steal the
lease, then verifies acquisition after release. Dead owners remain reclaimable;
staleAfterMs controls the grace period for missing or malformed owner records.
Owner-record write/publication failures clean up the newly created lock and
retain the original error. ENOSPC/EEXIST fault regressions verify subsequent
acquisition through the same and independent managers. These checks exercise
filesystem/process coordination without new Flutter input coverage.

The runner acquires that lease before Vitest starts the body timeout. A real
subprocess regression verifies a 250ms body can wait behind 600ms of App work
without timing out. Registration preserves fluent variants, parameterized
tests, project fixtures and user metadata. With aroundEach and retries, a new
attempt is established before automatic scenario fixtures resolve. Vitest 4
continues to reject removed third-argument option objects and duplicate handler
functions. A real
macOS Flutter check retained separate failed/passed attempts, one Scenario node
per attempt, a final passed/flaky result and complete evidence. Its first run
retained partial evidence after a final screenshot timeout; the independent
repeat passed without changing capture budgets. Evidence:
`/tmp/fliwright-registration-live-acceptance.json`.

Cancellation while waiting for the App lease also finalizes interrupted before
the body runs. The runner aborts preparation independently of Vitest's running
test signal and retains the base runner cancellation behavior. Standard mode
records partial evidence; off mode keeps evidence disabled even when configured
only in the fixture. Real worker and CLI subprocess checks verify cancellation,
subsequent lease acquisition and interrupted projections in a relocated partial
export. These are process-lifecycle checks without new Flutter input coverage.

App preparation errors also remain local to the affected test. The runner
preserves the original error, finalizes failed projections and releases its
lease before another test uses the same App. Real worker and CLI subprocess
regressions inject a failure after acquiring a lease, verify the next test
passes, and read the same failed outcome from a relocated partial export.
Preparation fails before user setup or body execution; it is reported through
Vitest's early-failure path.

On macOS/Linux, CLI cancellation owns and signals the runner process group,
including remaining fork workers and subprocesses. A real macOS fixture
verified cancellation and worker kill after a saved action, with interrupted
projections and portable PNG evidence. Windows retains direct child signaling;
this POSIX process-group behavior has not been validated there. A controlled
real-VM proxy check also verified loss of an action response with hung cleanup,
original-error retention and portable partial evidence. A separate real App
SIGKILL check retained the original connection error, failed/partial projections
and portable last-known PNG after an actual business action. Further real
macOS checks passed screenshot-response loss combined with hung cleanup,
project fixture cleanup failure, and an unwritable parent run directory.
The first retained failed/partial projections and a readable last-known image;
the cleanup failure retained failed/complete evidence. Parent persistence
failure throws `RunFinalizationError`, retaining the original runner outcome,
run identity and filesystem cause, without claiming durable publication.
Canonical manifest, report mirror and worker-recovery write failures have
real subprocess regressions. The complete platform fault matrix remains open.

Direct Vitest cancellation now also signals the owned POSIX process group;
regressions verify connected descendants, including a process that ignores
SIGTERM, are terminated. A real Extension Host cancellation retained a saved
Flutter action, marked its unfinished attempt interrupted/partial, and exited
the worker. Windows direct-child signaling remains separately unverified.
The latest-status index resolves filesystem aliases consistently with discovery
and preserves older canonical runs. Open Failure reads the latest failed or
interrupted canonical attempt rather than requiring a workspace failures folder.

The current composited screenshot path has visually verified full-page form and
submitted-value content on the controlled macOS app. Historical nested-boundary
captures can show inactive routes; their timing and image-validity results are
not current screenshot-fidelity evidence. The headless scene pixel test remains
skipped because that engine returns transparent pixels; the nested-boundary
regression and real-app visual inspection are separate evidence.

Default screenshots also wait for the scheduled Flutter frame to complete.
Twenty successive real click/screenshot pairs passed image-counter OCR checks;
a prior composited-scene scale run still read stale frames and is diagnostic,
not a performance acceptance result. Current full-scale performance and soak
results must include the new frame wait. The editor's independent traceMode
setting and Trace environment switches have been removed; recording.mode is
the shared control.

Local evidence: `/tmp/fliwright-ide-acceptance/acceptance.json`,
`/tmp/fliwright-real-app-kill/acceptance.json`, and
`/tmp/fliwright-ide-cancel-descendants-{red,green}.log`.

Additional current evidence: `/tmp/fliwright-init-host-acceptance/acceptance.json`,
`/tmp/fliwright-frame-window-replays/acceptance.json`, and
`/tmp/fliwright-frame-missing-export-verified/acceptance.json`. The init check
uses local workspace dependencies with installation skipped; generated config,
preset and tsconfig files remain unchanged while example selectors are adapted
to the fixture. Tests/scripts produce canonical reports and open their exact
source attempts. The missing-image check rejects default export, lists the
missing references in an explicit partial export, and reads the remaining six
PNGs after the original run is moved aside; source files are restored afterward.

Dart output has independent compilation and replay evidence. The controlled
macOS fixture verifier emits `verification.json` and `readiness.json` after
analysis, unchanged-source replay, missing-input and business-counterexample
checks. A failed evidence record always leaves a draft, including an empty
diagnostic list; a generic TypeScript run identity cannot verify Dart. The editor
retains that failed state across reload/save, uses `.dart` output and a Dart save
filter, opens Dart source in the default editor, and writes the exact source bytes.
CLI `record --dart-verification <file>` and the editor's Import Dart Verification
command validate the shared evidence JSON before changing capture/session state.
CLI/MCP evidence-consumption checks
use the same fingerprint as the actual compiled source; their capture input is
reconstructed from the fixture and does not prove native recording. Evidence:
`/tmp/fliwright-dart-evidence-producer/acceptance.json` and
`/tmp/fliwright-dart-evidence-consumers/acceptance.json`. A real VS Code 1.142.0
Extension Host also verified the import command, actual quick-pick/open/save
dialogs, unchanged `.dart` source saving, source-editor routing and failed
evidence downgrade. Renderer CDP drove those IDE dialogs; native Flutter input
remains unverified. Report: `/tmp/fliwright-dart-import-host/acceptance.json`.
