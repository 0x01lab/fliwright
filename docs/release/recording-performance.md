# Recording Performance Evidence

## Capture implementation change — 2026-10-17

The bridge now captures the composited RenderView scene. The earlier shortcut
could select a nested repaint boundary belonging to an inactive Navigator route
and produce stale or clipped content. Full-page form input and submitted-value
images have been visually checked on the current real macOS app; the Extension
Host workflow is recorded in `/tmp/fliwright-ide-acceptance/acceptance.json`.

All earlier timing and soak measurements below predate this scene-capture fix.
Their business counters, event ordering, cache observations and file-copy checks
remain historical evidence. PNG structure and changing hashes do not establish
the correct page content. These measurements do not prove the performance or
long-run screenshot fidelity of the current capture implementation; current
core, full CLI/Vitest and recorder-soak revalidation are tracked separately.

A 1,002-action-per-mode rerun with the composited scene passed business counters
and file counts (`/tmp/fliwright-scene-core-1002/benchmark.json`), but visual
inspection of the last standard image showed Count: 3004 when the actual final
counter was 3006. macOS OCR confirmed the mismatch. Its 96.280ms standard capture
P95 is diagnostic only: it does not pass correct action-after-image acceptance.

The default screenshot now waits for Flutter's scheduled end-of-frame before
reading the composited layer; it does not manually drive frames or wait for
global settle. The recorder sampler explicitly keeps immediate latest-scene
capture. A deterministic Flutter regression first returned the old scene before
a pending rebuild, then passed after the fix. Twenty real clicks immediately
followed by screenshots, without an extra settle, passed actual image-counter
OCR checks (`/tmp/fliwright-frame-pixels/acceptance.json`). Current timing must
include this frame wait. The current core scale result follows; full CLI/Vitest
and ten-minute measurements are tracked independently.

The first frame-wait measurement rotates modes over three repetitions of ten
actions each. It verifies business counters, evidence counts and file readback;
thirty samples per mode do not close the 1,000-action gate.

| Mode | Actions | Capture P95 | Combined action P95 | Evidence |
| --- | --- | --- | --- | --- |
| off | 30 | 0ms | 30.721ms | disabled |
| standard | 30 | 232.339ms | 240.322ms | 30 screenshots, all captured |
| full | 30 | 654.624ms | 665.518ms | 60 screenshots and 30 snapshots, all captured |

Evidence: `/tmp/fliwright-frame-core-benchmark/benchmark.json`. This includes
frame waiting and capture/write but excludes Vitest journals and full-run
finalization. Full mode has no 300ms claim; the design's 300ms target applies
to standard additional capture cost. Larger current-version measurements remain
required even though this small standard sample is below that target.

## Current frame-wait core scale — 2026-10-17

The same Flutter 3.41.9 / Dart 3.11.5 macOS arm64 fixture at 821 × 777@1 ran
334 actions in each mode over three rotations: 1,002 actions per mode. Every
batch verified its actual counter; all 1,002 standard screenshots and 2,004 full
screenshots plus 1,002 full snapshots were captured and read back.

| Mode | Actions | Capture/write P95 | Combined action P95 | Evidence bytes |
| --- | --- | --- | --- | --- |
| off | 1,002 | 0ms | 9.611ms | 0 |
| standard | 1,002 | 222.859ms | 228.311ms | 27,738,486 |
| full | 1,002 | 487.378ms | 493.848ms | 68,880,132 |

Vision OCR checked the first, middle and last action in each standard/full
batch, including full-mode before and after images: all 27 displayed counter
values matched their action boundaries. This supplements file-count validation
with sampled image content; it does not claim OCR coverage of every screenshot.
The standard capture/write P95 satisfies the 300ms controlled-core target.
The result excludes Vitest journals and whole-run finalization, native input
and long recording, so the complete release gate remains open.

Evidence: `/tmp/fliwright-frame-core-1002/benchmark.json` and
`/tmp/fliwright-frame-core-1002/image-content.json`. Reproduce with
`scripts/benchmark-recording-vm.mjs --actions=334 --repetitions=3` against the
controlled counter fixture, passing its endpoint through the environment.

## Current full CLI/Vitest scale — 2026-10-17

The current implementation completed nine attempts with 334 actions each,
rotating mode order over three repetitions: 1,002 actions per mode. The run
took 548,848.832ms including journals and finalization; export took another
2,679.294ms. Every standard/full attempt had complete captured evidence;
off remained disabled. Timeline, Trace, result and manifest outcomes agreed.

| Mode | Actions | Combined action P95 | Combined action P99 |
| --- | --- | --- | --- |
| off | 1,002 | 10.647ms | 27.930ms |
| standard | 1,002 | 236.271ms | 277.810ms |
| full | 1,002 | 576.580ms | 608.125ms |

These action timings include persistence and capture; capture cost is not
subtracted to claim negligible overhead. Export was complete with no missing
references. With the original run directory moved aside, all 3,018 portable
PNGs were read and their signatures checked; OCR verified 27 sampled first,
middle and last action-boundary counters, including full before/after images.

An earlier run overlapped development builds and package tests. All nine
business outcomes passed, but two full-mode attempts had capture timeouts and
correctly remained partial. That run failed strict acceptance and is preserved
at `/tmp/fliwright-frame-vitest-1002/acceptance.json`; its cause is not proven
solely by the successful repeat. The repeat ran without concurrent builds or
package tests and retained the same budgets and capture frequency.

Evidence: `/tmp/fliwright-frame-vitest-1002-isolated/acceptance.json` and
`/tmp/fliwright-frame-vitest-1002-isolated/image-content.json`. This completes
the controlled full-run scale slice; native input, long recording and other
platform gates remain independent.

## Current ten-minute recorder — 2026-10-17

The current composited-scene recorder ran for 600,000.815ms on the same
821 × 777@1 macOS fixture. Actual counter state advanced from 6,018 to 7,018.
All 1,000 operations, generated clicks and frames had resolved targets; all
2,001 raw events were consecutive and archived. Capture was `captured` with
no issues. This uses bridge-dispatched input and does not establish native
mouse/keyboard/IME recording.

Aggregation peaked at two events / 1,338 encoded bytes; out-of-order buffering
peaked at one event / 670 bytes. Decoded screenshot peak was 27,711 bytes
against the 8 MiB budget, with zero retained binary history. Screenshot work
peaked at one pending task and ended at zero. The sampler wrote 2,384 images;
the 1,000 frame references pointed to 1,000 distinct PNG contents.

After moving the source aside, all frame images passed PNG CRC, decompression,
scanline and dimension checks from the portable copy. Vision OCR of 21 sampled
frames, including first/last and every fifty actions, matched the actual
pre-dispatch counter values. Post-stop input created no new recorder events
or samples, and disposal closed the transport.

Periodic memory samples reached RSS 133,398,528, heap used 36,983,240,
external 7,513,981 and ArrayBuffers 3,785,376 bytes. These are sampled maxima,
not continuous peaks. Operation metadata may grow; event payloads, decoded
binary work and pending screenshot work remain separately budgeted.

Evidence: `/tmp/fliwright-frame-recorder-soak/acceptance.json`,
`png-verification.json` and `image-content.json`. The controlled current
M4.6a.4 slice passes; native input and other platform gates remain open.

## Measurement procedure and historical evidence

This document defines the repeatable performance check for the recording
pipeline. It separates TypeScript lifecycle measurements from Flutter-device
measurements so a synthetic result cannot be used as a platform claim.

Run the deterministic core check after building the workspace:

```sh
pnpm --filter @fliwright/core build
node scripts/benchmark-recording.mjs --actions=1000 --repetitions=3 --output=/tmp/fliwright-recording-benchmark.json
```

The report contains per-mode operation count, evidence count, total time,
mean, P95 and P99. `off` measures the lifecycle baseline, `standard` captures
one finish screenshot per logical action, and `full` captures start screenshot,
start snapshot and finish screenshot. The recorder section measures protocol
aggregation and records raw event/frame counts for a 1,000-action run.

The benchmark currently uses an in-process evidence source. Its output is
always marked `synthetic-only`; even a green P95 target is not release evidence.
The release gate still needs a fixed-machine Flutter VM run covering baseline,
standard and full, a ten-minute capture, and the 1,000-action binary/raw-event
cache budget. Those runs must record Flutter/Dart versions, device, window
size, VM endpoint class, and a redacted report path.

The recorder section also reports frame references and unique screenshot
files. This quick synthetic run reuses the latest sampled file; it does not
replace the separate regression with 1,000 distinct large PNG images.

Latest local synthetic run (2026-10-17, Node core, 1,000 actions, three
repetitions): standard P95 overhead over `off` was 0.006ms; the recorder
aggregated 2,000 raw events into 1,000 operations, retained 1,000 frame
references to one unique screenshot payload, and completed without protocol
issues.
This is a development signal only and does not close M4.6.

Real macOS fixture check (2026-10-17): Flutter 3.41.9, Dart 3.11.5,
macOS arm64 (Darwin 27.0.0), logical viewport 821 × 777 at pixel ratio 1.
The VM is the local debug Dart VM Service; its address is deliberately omitted.
The controlled counter fixture ran ten actions per mode, repeated three times
with rotating mode order. Every batch verified the actual counter text.

| Mode | Actions | Operation total | Capture/write total | Combined action total | Capture P95 | Evidence bytes |
| --- | --- | --- | --- | --- | --- | --- |
| off | 30 | 231ms | 0ms | 231ms | 0ms | 0 |
| standard | 30 | 228ms | 1,583ms | 1,811ms | 88ms | 711,215 |
| full | 30 | 281ms | 6,019ms | 6,300ms | 265ms | 1,859,667 |

This early benchmark measures core RunSession actions and evidence writes;
it excludes Vitest journal/progress persistence, test start/finish captures and
native input recording. Its capture interval also includes reading artifacts
back to count bytes. The checked-in benchmark below moves verification reads
outside the measured interval. Neither sample proves fixed recorder cache
budgets or ten-minute stability.

The first real run exposed repeated dynamic `.name` lookups in snapshot label
fallback: a single snapshot took 5,422ms. Deferring fallback until a candidate
needs a name, and caching each element's name only within that snapshot, reduced
the same 19-ref snapshot to 236ms. Regression tests preserve ancestor fallback,
skip irrelevant lookups for labelled targets, and verify fresh values on the
next snapshot. The bridge suite passed 172 tests, with two existing skips.

Separately, the real CLI/Vitest run passed all three mode fixtures, each with
two actual locator clicks, a locator assertion and an explicit frame. Standard
and full evidence was complete, off retained only explicit evidence, and the
portable export reported no missing files. These are mode correctness checks;
they do not establish high-volume journal performance.

Reproduce the real VM timing check with the controlled fixture home page open:

```sh
pnpm --filter @fliwright/core build
# Provide FLIWRIGHT_VM_SERVICE_URL through the environment.
node scripts/benchmark-recording-vm.mjs --actions=334 --repetitions=3 --flutter-version=3.41.9 --output=/tmp/fliwright-real-vm-recording-1002
```

The script rotates modes, verifies business counts and exact action evidence
counts, saves result/Timeline/Trace and binary artifacts, and writes a redacted
`benchmark.json`. It reports capture/write and combined action timings
separately. Its report explicitly leaves `releaseGateComplete` false.

The checked-in script subsequently passed 334 actions × three repetitions per
mode on the same fixture and machine. All 1,002 actions per mode verified the
business counter; standard saved 1,002 screenshots and full saved 2,004
screenshots plus 1,002 snapshots, with every evidence item captured and readable.

| Mode | Actions | Operation total | Capture/write total | Combined action total | Capture P95 / P99 | Combined action P95 / P99 | Evidence bytes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| off | 1,002 | 5.735s | 0s | 5.735s | 0 / 0ms | 9.870 / 39.110ms | 0 |
| standard | 1,002 | 5.968s | 75.878s | 81.846s | 94.984 / 102.407ms | 101.854 / 115.673ms | 23,904,981 |
| full | 1,002 | 6.327s | 214.122s | 220.449s | 261.469 / 298.118ms | 268.339 / 305.184ms | 62,384,181 |

The standard capture P95 is below the 300ms target in this controlled core
measurement. The exclusions above still apply: 1,002 successful automatic
actions do not establish raw-event/binary cache bounds for manual recording or
ten-minute stability, and capture-only timing does not include Vitest journals.

The same fixture also passed the complete CLI/Vitest path: nine attempts,
334 actions each, three repetitions per mode with rotating order. The action
interval now includes capture, queued Timeline progress and journal writes.
Each attempt verified its real business counter, final result, Timeline, Trace,
evidence count and nonempty journal. Standard/full evidence was complete; off
evidence was disabled. The run took 400.102s including setup and final artifacts;
portable export took a further 2.343s and reported no missing files.
With the original runs directory temporarily moved away, the portable package
independently loaded all nine attempts, 3,018 PNG screenshots, 1,002 JSON
snapshots, six journals, and the corresponding Timeline/Trace projections.

| Mode | Actions | Combined action total | Action P95 | Action P99 | Captured evidence including test start/end |
| --- | --- | --- | --- | --- | --- |
| off | 1,002 | 6.778s | 10.729ms | 28.292ms | 0 |
| standard | 1,002 | 104.778s | 120.090ms | 128.983ms | 1,008 |
| full | 1,002 | 285.523s | 320.679ms | 376.909ms | 3,012 |

The full-path timings include all overhead within each action; subtracting the
core-only measurement would not isolate journal cost because these are separate
runs. The continuous run was about 6.7 minutes of automated execution across
nine attempts. It is not a ten-minute manual recording stability result.

Local evidence paths (temporary development artifacts):

- `/tmp/fliwright-real-vm-recording-evidence-bounded/benchmark.json`
- `/tmp/fliwright-real-vm-recording-1002-verified/benchmark.json`
- `/tmp/fliwright-real-vm-vitest-scale/acceptance.json`
- `/tmp/fliwright-real-vm-vitest-scale/portable-verification.json`
- `/tmp/fliwright-real-mode-fixture-evidence-after-snapshot-fix/acceptance.json`
- `/tmp/fliwright-snapshot-latency-green.log`

The cache implementation and recorder soaks are described below. The latest
controlled VM soak passes ten-minute stability; platform and native input
acceptance remain separate tasks.

The raw-event portion now has a bounded core implementation. Valid unique
events are synchronously appended to a per-session `events.jsonl`; normal
aggregation retains only the current gesture/edit segment and compact completed
operations. Continuous final-value edits replace the previous hot value while
the archive preserves every event. `eventCache` defaults to 128 events and
1 MiB for each of the aggregation and out-of-order buffers. Overflow and archive
write failures preserve reviewable operations and mark the recording partial.
The public result reports current/peak event counts and encoded bytes. The
explicit `getRawEvents()` diagnostic loads history from disk; progress uses
`getRawEventCount()` instead.

The 1,000-action synthetic check archived all 2,000 events and generated all
1,000 operations. Its aggregation peak was two events / 794 encoded bytes;
the out-of-order peak was one event / 483 bytes. Regression tests also cover
long edits ending in clear, text-before-up, routing/focus/multi-pointer boundaries,
archive initialization/write failure, cache overflow and session reset.

Pending screenshot work uses a set that removes completed promises,
with `maxPendingScreenshots` defaulting to eight. An outage test recorded
1,000 operations/frames with a configured four-task limit, verified at most
four admitted frame requests plus the initial sample, and reported the affected
frames and capture as partial.

Historical frames now contain relative `path`, `byteLength` and image metadata,
with no base64 payload. Each screenshot is written through a temporary file and
atomic rename before its reference is published. `maxScreenshotBytes` defaults
to 8 MiB decoded; oversized captures fail before allocating a decoded copy.
`binaryCache` reports the observed decoded peak, limit and write count, with no
retained binary history. This limit does not prevent the VM transport from
receiving the original base64 response. Screenshot timeouts remain issues after
later success, and late responses cannot publish files into a subsequent session.

CLI, MCP and VS Code use the shared schemaVersion 2 recording manifest and
preserve referenced screenshots plus `events.jsonl` in the saved recording.
The editor loads metadata only and serves validated local resource URLs for
visible/lazy images. Replaced base64 manifests are rejected. Replay archives
copy their evidence and omit the runtime artifact directory. Confirmed
checkpoints are included in saved generation options so regeneration retains
the same executable assertions.

The deterministic scale regression uses 1,000 different valid PNGs, each about
128 KiB, preserves 1,000 operations and generated clicks, removes the original
artifact directory, and decompresses every copied image. It also covers disk
write failure, byte budget exhaustion, late responses, session restart, missing
references and source/destination symlink escapes. CLI/MCP portable save,
replay preservation and editor metadata-only load have focused regressions.
The first real long-recording attempt below remained partial; a later repeat
after the latency fixes passed.

Evidence: `/tmp/fliwright-cache-budgets-benchmark.json` and
`/tmp/fliwright-{recorder-cache,screenshot-queue}-{red,green}.log`.

The first real recorder soak on the same macOS fixture ran approximately ten
minutes (599,999.449ms), performing 1,000 bridge-dispatched counter clicks.
The counter advanced from 201 to 1,201. All 1,000 operations, frames and 2,001
ordered events survived. However, one screenshot exceeded the 3-second request
budget, and 11 target captures exceeded the bridge budget, producing coordinate
drafts. The final capture correctly remained partial. This does not pass the
long-recording or reliable-selector gate.

The real aggregation peak was two events / 2,706 encoded bytes, with one event /
1,354 bytes pending out of order. The decoded screenshot peak was 23,935 bytes
against an 8 MiB limit; binary history retained zero bytes. Screenshot work
peaked at one task and ended at zero. Sampled process peaks were RSS 121,389,056,
heap used 39,581,432, external 4,765,184 and ArrayBuffers 1,037,720 bytes.
These are periodic memory samples, not continuous process peak measurements.

The sampler wrote 411 images. After moving the source aside, all 1,000 frame
references and the complete event archive loaded from the portable copy. All
referenced PNGs passed chunk CRC and decompression checks at 821 × 777; there
were 399 distinct image contents because frames reuse the latest sample.
This is separate from the deterministic 1,000-distinct-large-PNG regression.
The run process and owned Flutter fixture were stopped after collecting evidence.

Evidence: `/tmp/fliwright-binary-real-vm-soak-verified/acceptance.json`,
`partial-verification.json`, and `png-verification.json` in the same directory.
The checked-in `scripts/benchmark-recording-cache-vm.mjs` preserves capture
diagnostics, validates portable evidence, and requires both complete capture
and reliable targets. Next work is to isolate screenshot and target-capture
latency, then repeat the soak; native input remains a separate acceptance task.

The subsequent diagnosis used a 500-action real VM probe and deterministic
bridge/core regressions. Screenshot RPCs were generally below 130ms while
global settle requests took up to 1,422ms during continued input. The manual
recorder sampler now captures the latest composited frame without global
settle; automatic action evidence keeps its separate policy and the existing
screenshot deadline remains in force.

Removing dynamic target-name fallback alone was insufficient: a later run
still captured two unresolved targets and was stopped early, with its raw
archive and `early-failure.json` preserved. Stage-specific instrumentation
showed fallback capture for `InkWell`. The fixture's actual `FilledButton`
was missing from interactive target scoring, allowing its internal `InkWell`
to win. The bridge now recognizes normal and tonal `FilledButton` controls,
and returns immediately after proving a unique key or semantics candidate
instead of spending the remaining budget on weaker candidates. Unproven
candidates still become unresolved when the unchanged 12ms budget expires.
Temporary stage instrumentation was removed.

Regression evidence: both FilledButton dispatch variants first failed with
actual target `InkWell`; the green cases select the exact keyed FilledButton.
A traversal-budget regression first lost a proven key during subsequent
ancestor traversal and now preserves it. A core regression first timed out
while settle was pending and now saves the rendered screenshot. After these
fixes, 500 real clicks retained all reliable targets; 93 screenshot RPCs had
P95 103.341ms and maximum 200.486ms. This short result is a diagnosis check,
not the ten-minute gate.

Local evidence: `/tmp/fliwright-{filled-button,target-proof-budget}-{red,green}.log`,
`/tmp/fliwright-sampler-settle-{red,green}.log`,
`/tmp/fliwright-recording-soak-after-latency-fix/early-failure.json`, and
`/tmp/fliwright-recording-latency-screenshots.json`.

The final repeat passed on the same Flutter 3.41.9 / Dart 3.11.5 macOS fixture
at 821 × 777@1. It recorded for 600,000.343ms with 1,000 bridge-dispatched
clicks, advancing the actual counter from 500 to 1,500. Capture was `captured`
with no issues; all 1,000 operations had resolved targets and all 1,000 generated
clicks, frames and 2,001 consecutive raw events were preserved.

Aggregation peaked at two events / 1,338 encoded bytes; out-of-order payloads
peaked at one event / 670 bytes, below the configured 128-event / 1 MiB limits.
Decoded screenshot peak was 24,140 bytes against 8 MiB, with zero retained
binary history. Pending screenshot work peaked at one and ended at zero.
The sampler wrote 2,380 images; frame history referenced 999 distinct files
and 999 distinct PNG contents. Moving the original artifact directory aside
left every frame and raw event readable from the portable copy. All 1,000
frame images passed PNG chunk CRC, decompression, scanline-filter and dimension
checks. Post-stop actions produced no further recorded events or sampled
files, and disposal closed the transport.

Periodic process samples reached RSS 132,300,800, heap used 35,780,656,
external 6,781,006 and ArrayBuffers 3,053,502 bytes. These are sampled maxima,
not continuous process peaks or a claim that all operation metadata is bounded.
This closes the controlled-VM M4.6a.4 slice and supplements M4.6a.3 cache
evidence. It does not establish native mouse/keyboard/IME, Extension Host,
other window sizes, exio, or Android/iOS acceptance; M4.6 as a whole remains open.

Evidence: `/tmp/fliwright-recording-soak-keyed-target/acceptance.json` and
`/tmp/fliwright-recording-soak-keyed-target/png-verification.json`.
