---
purpose: Progressive CLI command routing for Skills
---

# Fliwright CLI command index

69 commands, one page per leaf command. Read [common conventions](./common.md) once, then open only the relevant command pages. Parameters and schemas are generated from the command registry; semantic guidance is maintained with the CLI package.

## Choose a workflow

| Task | Start with | Next |
| --- | --- | --- |
| Set up a project | [init](./command-init.md) | [doctor](./command-doctor.md) |
| Run CI and collect evidence | [run](./command-run.md) | [failures](./command-artifacts.failures.md), [export](./command-artifacts.export.md) |
| Inspect and operate the app | [session open](./command-session.open.md), [snapshot](./command-app.snapshot.md) | [find](./command-app.find.md), [interact](./command-app.interact.md) |
| Prepare repeatable state | [scenario list](./command-scenario.list.md) | [resolve](./command-scenario.resolve.md), [apply](./command-scenario.apply.md) |
| Reproduce HTTP outcomes | [mock list](./command-mock.list.md) | [apply](./command-mock.apply.md), [calls](./command-mock.calls.md) |
| Investigate failed attempts | [artifacts show](./command-artifacts.show.md) | [timeline](./command-artifacts.timeline.md), [diagnose](./command-artifacts.diagnose.md) |
| Capture a human demonstration | [record](./command-record.md) | [flow get](./command-flow.get.md), [run](./command-run.md) |
| Compare UI to Figma | [review bundle](./command-flow.review-bundle.md) | [runtime capture](./command-flow.review-capture-runtime.md), [Figma capture](./command-flow.review-capture-figma.md), [report](./command-flow.review-report.md) |
| Author a behavior test | [write-fliwright-tests](../../../write-fliwright-tests/SKILL.md) | [agent-driven TDD](../tdd.md), then [focus](./command-tdd.focus.md) and [cycle](./command-tdd.cycle.md) |
| Develop with persistent TDD | [session open](./command-session.open.md) | [start](./command-tdd.start.md), [focus](./command-tdd.focus.md), [cycle](./command-tdd.cycle.md), [stop](./command-tdd.stop.md), [close](./command-session.close.md) |
| Recover/cancel uncertain work | [session status](./command-session.status.md) | [cancel](./command-session.cancel.md) |

## Discover commands and prepare a project

| Command | Purpose |
| --- | --- |
| [schema](./command-schema.md) | Discover available commands or inspect one command’s machine contract. |
| [init](./command-init.md) | Initialize project dependencies, Flutter bridge scaffolding and optional project-local Codex Skills. |
| [doctor](./command-doctor.md) | Check local tooling, configuration and the Flutter automation connection. |
| [devices list](./command-devices.list.md) | Discover local iOS and Android physical devices and simulators without a running app. |

## Run tests and scripts in CI

| Command | Purpose |
| --- | --- |
| [run](./command-run.md) | Run selected Vitest automation tests and save canonical run evidence. |
| [script](./command-script.md) | Execute one automation script through the same runner and evidence pipeline as run. |
| [record](./command-record.md) | Capture user interactions and produce recording, flow and automation draft evidence. |

## Discover project tests without connecting to an app

| Command | Purpose |
| --- | --- |
| [catalog](./command-catalog.md) | Collect configured suite files, named scenarios and dynamically registered Vitest cases without starting Flutter or running test/hook bodies. |

## Inspect and interact with a running app

| Command | Purpose |
| --- | --- |
| [app status](./command-app.status.md) | Verify a live app connection and read its Dart SDK identity. |
| [app observe](./command-app.observe.md) | List current UI candidates, optionally filtered by role. |
| [app snapshot](./command-app.snapshot.md) | Capture the app’s readable widget snapshot and opaque interaction refs. |
| [app find](./command-app.find.md) | Find snapshot refs matching text, Key, semantics, role or widget type. |
| [app source-map](./command-app.source-map.md) | Map current UI elements back to Flutter source locations. |
| [app diagnostics](./command-app.diagnostics.md) | Read, subscribe to or clear buffered app diagnostic events. |
| [app reload](./command-app.reload.md) | Hot reload Dart code and capture the resulting UI and diagnostics. |
| [app screenshot](./command-app.screenshot.md) | Save a viewport screenshot or a stitched vertical long PNG. |
| [app debug-snapshot](./command-app.debug-snapshot.md) | Collect a structural snapshot plus independent debug evidence channels. |
| [app interact](./command-app.interact.md) | Perform one tap, text entry, navigation, wait, drag or extended action. |

## Inspect native UI and prepare the XCTest Runner

Start with [native workflows](../native.md) for platform configuration, managed/attach runs, capability limits and recovery. Individual command schemas follow below.

| Command | Purpose |
| --- | --- |
| [native recovery inspect](./command-native.recovery.inspect.md) | Read the selected device’s local lease, quarantine and recovery evidence without modifying it. |
| [native recovery verify](./command-native.recovery.verify.md) | Compare an abandoned XCTest Runner journal with the selected iOS Simulator boot generation and launchd identity. |
| [native recovery restore](./command-native.recovery.restore.md) | Restore the exact isolated resource recorded for an abandoned iOS Simulator or Android Emulator lease. |
| [native doctor](./command-native.doctor.md) | Inspect the explicitly selected native device, installed target and platform prerequisites without starting a Runner. |
| [native snapshot](./command-native.snapshot.md) | Capture an explicitly selected device’s native UI hierarchy using ADB or the owned XCTest Runner. |
| [native prepare](./command-native.prepare.md) | Explicitly build or reuse the unsigned iOS Simulator XCTest Runner in the local build cache. |

## Prepare a named app baseline

| Command | Purpose |
| --- | --- |
| [scenario list](./command-scenario.list.md) | List named scenarios declared in project configuration. |
| [scenario resolve](./command-scenario.resolve.md) | Resolve one named composed scenario without applying it. |
| [scenario apply](./command-scenario.apply.md) | Apply a named composed baseline to the connected app. |
| [scenario reset](./command-scenario.reset.md) | Reapply a named baseline to restore its declared state. |

## Select HTTP response scenarios and inspect calls

| Command | Purpose |
| --- | --- |
| [mock list](./command-mock.list.md) | List locally available HTTP endpoints and named response rules. |
| [mock status](./command-mock.status.md) | Compare local rule definitions with active Flutter routes and captured HTTP calls. |
| [mock calls](./command-mock.calls.md) | Read captured Flutter HTTP calls, optionally filtered by endpoint and method. |
| [mock apply](./command-mock.apply.md) | Install one named local mock response rule into Flutter. |
| [mock clear-calls](./command-mock.clear-calls.md) | Clear captured HTTP call history while keeping mock routes. |
| [mock reset](./command-mock.reset.md) | Remove Flutter mock routes, clear call history and enable passthrough. |
| [mock start](./command-mock.start.md) | Run a foreground local HTTP mock controller from the rule directory. |

## Investigate saved evidence without an app

| Command | Purpose |
| --- | --- |
| [artifacts show](./command-artifacts.show.md) | Read a saved run report, manifest and the available run list. |
| [artifacts export](./command-artifacts.export.md) | Export a saved run and its referenced evidence to a directory. |
| [artifacts report](./command-artifacts.report.md) | Generate an offline App release test review report grouped by GitLab Item. |
| [artifacts failures](./command-artifacts.failures.md) | Extract saved assertion failures and runner errors from a run. |
| [artifacts timeline](./command-artifacts.timeline.md) | Read a saved attempt timeline or inspect one node and its neighbors. |
| [artifacts diagnose](./command-artifacts.diagnose.md) | Request optional AI diagnosis of a saved or explicitly supplied agent-visible failure. |

## Inspect flows and compare runtime with Figma

| Command | Purpose |
| --- | --- |
| [flow list](./command-flow.list.md) | List readable flow documents saved under .fliwright/flows. |
| [flow get](./command-flow.get.md) | Read one complete flow document. |
| [flow bind-figma](./command-flow.bind-figma.md) | Bind one flow node to a Figma file/node and optional code component. |
| [flow agent-spec](./command-flow.agent-spec.md) | Convert a saved flow into a compact specification for agent reasoning. |
| [flow clean](./command-flow.clean.md) | Plan or apply AI-assisted cleanup of a flow document. |
| [flow review-plan](./command-flow.review-plan.md) | Derive design review targets and tolerances without capturing images. |
| [flow review-bundle](./command-flow.review-bundle.md) | Write a review bundle with target tasks, artifact locations and capture instructions. |
| [flow review-capture-figma](./command-flow.review-capture-figma.md) | Download Figma target screenshots and save a capture manifest through the REST provider. |
| [flow review-report](./command-flow.review-report.md) | Compare runtime/Figma evidence and write the design review report. |
| [flow generate-test](./command-flow.generate-test.md) | Generate a TypeScript test skeleton from a saved flow. |
| [flow validate](./command-flow.validate.md) | Validate flow structure and report design/code/runtime binding issues. |
| [flow review-capture-runtime](./command-flow.review-capture-runtime.md) | Navigate review target routes and save runtime screenshots plus a capture manifest. |
| [flow review-run](./command-flow.review-run.md) | Build a bundle, capture runtime and Figma screenshots, then write a review report. |

## Generate test drafts from source or snapshots

| Command | Purpose |
| --- | --- |
| [generate-test](./command-generate-test.md) | Generate an editable test draft from Flutter source or snapshot candidates. |

## Iterate on a focused test

| Command | Purpose |
| --- | --- |
| [tdd start](./command-tdd.start.md) | Start a persistent TDD runtime inside an existing connection session. |
| [tdd status](./command-tdd.status.md) | Read TDD status from a live session or the saved local status file. |
| [tdd focus](./command-tdd.focus.md) | Select the file and optional test name for persistent TDD cycles. |
| [tdd cycle](./command-tdd.cycle.md) | Sync the app, restore test state and rerun a focused test once. |
| [tdd reconnect](./command-tdd.reconnect.md) | Reconnect the persistent TDD runtime and refresh its host app connection. |
| [tdd sync](./command-tdd.sync.md) | Apply an explicit app synchronization level without running tests. |
| [tdd scenario](./command-tdd.scenario.md) | Select the named scenario used by subsequent focused test attempts. |
| [tdd stop](./command-tdd.stop.md) | Stop the persistent TDD runtime while leaving the connection worker available. |

## Manage a reusable local connection

| Command | Purpose |
| --- | --- |
| [session open](./command-session.open.md) | Create a reusable local worker connected to an attached or managed Flutter app. |
| [session list](./command-session.list.md) | Probe sessions registered under the current project. |
| [session status](./command-session.status.md) | Read worker state or the journal entry of one operation. |
| [session close](./command-session.close.md) | Cancel active work, release owned runtime connections and shut down the worker. |
| [session reconnect](./command-session.reconnect.md) | Refresh the host’s app connection after queued work settles. |
| [session cancel](./command-session.cancel.md) | Request cancellation of one active or queued session operation. |
