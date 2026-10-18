# Consolidate agent and CI workflows in CLI while retaining runtime ownership

- Status: accepted
- Date: 2026-10-18
- Scope: CLI, core runtime, TDD, bridge refs, Vitest integration, editor and plugin consumers
- Evidence: `docs/superpowers/specs/2026-10-17-skill-cli-consolidation-design.md`, `packages/fliwright-cli/tests/session-ipc.test.ts`, `packages/fliwright-tdd/tests/runtime/EndpointHandoff.test.ts`, `packages/fliwright-vitest/tests/default-scenario.test.ts`, `packages/fliwright-bridge/test/ref_registry_test.dart`, `e2e/scripts/run-generated-smoke.mjs`
- Changed-Files: `packages/fliwright-core/src/index.ts`, `packages/fliwright-core/src/VmServiceEndpoint.ts`, `packages/fliwright-bridge/lib/src/ref_registry.dart`, `packages/fliwright-cli/src/capabilities/interaction.ts`, `packages/fliwright-cli/src/capabilities/session.ts`, `packages/fliwright-cli/src/commands/app.ts`, `packages/fliwright-cli/src/commands/artifacts.ts`, `packages/fliwright-cli/src/commands/doctor.ts`, `packages/fliwright-cli/src/commands/init.ts`, `packages/fliwright-cli/src/commands/mcp.ts`, `packages/fliwright-cli/src/commands/mock-management.ts`, `packages/fliwright-cli/src/commands/mock.ts`, `packages/fliwright-cli/src/commands/record.ts`, `packages/fliwright-cli/src/commands/run.ts`, `packages/fliwright-cli/src/commands/scenario.ts`, `packages/fliwright-cli/src/commands/tdd.ts`, `packages/fliwright-cli/src/config.ts`, `packages/fliwright-cli/src/index.ts`, `packages/fliwright-core/src/MockManager.ts`, `packages/fliwright-core/src/RecordingCapture.ts`, `packages/fliwright-core/src/RecordingCheckpoints.ts`, `packages/fliwright-core/src/RecordingConfig.ts`, `packages/fliwright-core/src/RecordingManifest.ts`, `packages/fliwright-core/src/flow/FlowReviewBundle.ts`, `packages/fliwright-mcp/src/cli.ts`, `packages/fliwright-mcp/src/index.ts`, `packages/fliwright-mcp/src/resources/testReport.ts`, `packages/fliwright-mcp/src/server.ts`, `packages/fliwright-mcp/src/state.ts`, `packages/fliwright-mcp/src/tools/action.ts`, `packages/fliwright-mcp/src/tools/agentDiagnose.ts`, `packages/fliwright-mcp/src/tools/connect.ts`, `packages/fliwright-mcp/src/tools/debugSnapshot.ts`, `packages/fliwright-mcp/src/tools/devassist.ts`, `packages/fliwright-mcp/src/tools/diagnostics.ts`, `packages/fliwright-mcp/src/tools/drag.ts`, `packages/fliwright-mcp/src/tools/find.ts`, `packages/fliwright-mcp/src/tools/flow.ts`, `packages/fliwright-mcp/src/tools/generateTest.ts`, `packages/fliwright-mcp/src/tools/getFailure.ts`, `packages/fliwright-mcp/src/tools/hotReloadAndSnap.ts`, `packages/fliwright-mcp/src/tools/interact.ts`, `packages/fliwright-mcp/src/tools/mock.ts`, `packages/fliwright-mcp/src/tools/mockTools.ts`, `packages/fliwright-mcp/src/tools/navigate.ts`, `packages/fliwright-mcp/src/tools/observe.ts`, `packages/fliwright-mcp/src/tools/record.ts`, `packages/fliwright-mcp/src/tools/runTest.ts`, `packages/fliwright-mcp/src/tools/scenario.ts`, `packages/fliwright-mcp/src/tools/screenshot.ts`, `packages/fliwright-mcp/src/tools/snap.ts`, `packages/fliwright-mcp/src/tools/sourceMap.ts`, `packages/fliwright-mcp/src/tools/tap.ts`, `packages/fliwright-mcp/src/tools/tdd.ts`, `packages/fliwright-mcp/src/tools/timeline.ts`, `packages/fliwright-mcp/src/tools/type.ts`, `packages/fliwright-mcp/src/tools/wait.ts`, `packages/fliwright-mcp/src/types.ts`, `packages/fliwright-tdd/src/daemon/DaemonTransport.ts`, `packages/fliwright-tdd/src/daemon/SubprocessDaemonTransport.ts`, `packages/fliwright-tdd/src/daemon/FlutterDaemonController.ts`, `packages/fliwright-tdd/src/devassist/DevAssistCoordinator.ts`, `packages/fliwright-tdd/src/diagnostics/TddFailureContext.ts`, `packages/fliwright-tdd/src/executor/PersistentTestExecutor.ts`, `packages/fliwright-tdd/src/runtime/TddRuntime.ts`, `packages/fliwright-tdd/src/types.ts`, `packages/fliwright-vitest/src/RecoveryReporter.ts`, `packages/fliwright-vitest/src/TestRegistration.ts`, `packages/fliwright-vitest/src/index.ts`, `packages/fliwright-vitest/src/preset.ts`, `packages/fliwright-vitest/src/runner.ts`, `packages/fliwright-vscode/src/extension.ts`, `packages/fliwright-vscode/src/runner/VitestRunner.ts`, `packages/fliwright-vscode/src/tddloop/TddLoopController.ts`, `packages/fliwright-vscode/src/tddloop/TddLoopStatusSource.ts`, `packages/fliwright-vscode/src/tddloop/TddLoopViewModel.ts`, `packages/fliwright-vscode/src/tddloop/index.ts`, `packages/fliwright-cli/src/CommandRegistry.ts`, `packages/fliwright-cli/src/WorkflowContext.ts`, `packages/fliwright-cli/src/commands/app-inspect.ts`, `packages/fliwright-cli/src/commands/artifact-query.ts`, `packages/fliwright-cli/src/commands/flow-runtime.ts`, `packages/fliwright-cli/src/commands/generate-test.ts`, `packages/fliwright-cli/src/registry/finite.ts`, `packages/fliwright-cli/src/registry/flow-schemas.ts`, `packages/fliwright-cli/src/registry/flow.ts`, `packages/fliwright-cli/src/registry/generation-schema.ts`, `packages/fliwright-cli/src/registry/session.ts`, `packages/fliwright-cli/src/registry/tdd.ts`, `packages/fliwright-cli/src/session/ConnectionHost.ts`, `packages/fliwright-cli/src/session/client.ts`, `packages/fliwright-cli/src/session/worker.ts`, `e2e/package.json`, `package.json`, `packages/fliwright-cli/package.json`, `packages/fliwright-core/package.json`, `packages/fliwright-mcp/package.json`, `packages/fliwright-mcp/tsconfig.json`, `packages/fliwright-plugin-riverpod/package.json`, `packages/fliwright-tdd/package.json`, `packages/fliwright-vitest/package.json`, `packages/fliwright-vscode/package.json`
- Supersedes: none

## Decision

Use a single CLI registry for human commands, progressive agent discovery and
structured input. Remove the Fliwright MCP transport and its package, plugin
configuration and release surface; retain external Figma MCP as a design input.
Skills teach workflows and CLI schemas provide current parameters. CI consumes
versioned JSON, stable exit codes, independent JUnit files and canonical run
artifacts, including failed and interrupted attempts.

Keep reusable execution, endpoint leases, recordings and run evidence in core;
keep persistent test execution in TDD/Vitest. A CLI connection worker owns its
live driver and TDD runtime and serializes commands. It does not create a new
report system. Persist operation identities for uncertain response recovery and
never automatically replay app mutations. Cancellation must reach a runtime
while it is starting, not only after startup has completed.

Release the parent endpoint lease before invoking a Vitest fork: the fixture
acquires that lease independently. Retain the host queue until the real runtime
operation settles, even when a cycle caller has already received a timeout.
Apply named scenarios in the per-attempt fixture, including retries. Propagate
managed/attach mode from actual app ownership; strict startup isolation still
requires and checks an app-side waiting bootstrap.

Snapshot refs belong to an app isolate incarnation. Transport reconnection does
not replace the Dart registry. Mint opaque incarnation-prefixed refs and avoid
reusing a semantics id for a different Element. Rotating the registry also rotates
its incarnation, so stale references cannot alias new widgets.

Concurrent Vitest 5 dependency and adapter changes are recorded separately in
`2026-10-18-vitest-5-upgrade.md`; the migration integrates with that current
runtime rather than restoring the superseded version.

Managed Flutter apps launch through `flutter run --machine`, not an `app.start`
RPC (the installed Flutter tool does not register that RPC). Capture the emitted
`app.start` identity, retain early `app.debugPort`, and wait for `app.started`
before returning the launch. Keep all machine RPCs on that resident process.
Stop owned app processes on cancellation; detach only for explicit retention.
Real generated-app smoke must exercise managed launch as well as attach, because
fake request transports cannot prove Flutter's actual supported RPC surface.

Machine-mode app readiness and bridge readiness are separate events. Poll only
the launched endpoint with a bounded, cancellable bridge handshake before
starting a test run; never fall back to another cached app during that wait.

A completed test failure normally makes Vitest exit 1. Do not synthesize a
process/runner error solely from that exit when failed tests explain it. Preserve
actual collection, suite, unhandled and abnormal-process errors separately so
CLI exit 1 means test/review failure and exit 3 means execution unavailable.


CLI command guidance is maintained in `packages/fliwright-cli/docs/` and rendered
from the actual registry into portable Skill references and generated feature
pages. Keep the Skill entrypoint short and route by task. The documentation
check parses examples through Commander/Zod without executing app mutations,
validates InteractionSpec examples, and rejects coverage, link or plugin-copy
drift. CI runs the check after building the workspace.

Dual-mode `tdd.cycle`, `tdd.sync`, and `tdd.status` must route to the connection
host when an explicit or inherited session is selected; otherwise persistent
focus is lost and finite input requirements are incorrectly enforced. Keep
finite behavior when no session is selected, and reject endpoint replacement
when routing to a session. Evidence: `packages/fliwright-cli/tests/session-routing.test.ts`.
