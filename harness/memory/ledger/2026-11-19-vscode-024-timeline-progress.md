# Share recorded time and live test attempts across editor views

- Status: accepted
- Date: 2026-11-19
- Scope: core timeline, CLI progress, VS Code test and trace views, Cloud replay
- Evidence: `packages/fliwright-core/tests/timeline/TimelineTimeAxis.test.ts`, `packages/fliwright-cli/tests/VitestProgress.test.ts`, `packages/fliwright-vscode/tests/viewer/ViewerApp.test.ts`, `packages/fliwright-vscode/tests/WorkspaceConfigCache.test.ts`, `packages/fliwright-vscode/tests/TestsTreeProvider.test.ts`
- Changed-Files: `packages/fliwright-cli/src/commands/run.ts`, `packages/fliwright-cli/src/config.ts`, `packages/fliwright-cli/src/index.ts`, `packages/fliwright-cli/src/run.ts`, `packages/fliwright-cloud/src/ReportStore.ts`, `packages/fliwright-cloud/src/web/app.tsx`, `packages/fliwright-cloud/src/web/components/ui/navigation-menu.tsx`, `packages/fliwright-cloud/src/web/replay-model.ts`, `packages/fliwright-core/src/index.ts`, `packages/fliwright-vscode/src/config.ts`, `packages/fliwright-vscode/src/extension.ts`, `packages/fliwright-vscode/src/runner/ProjectTestRunner.ts`, `packages/fliwright-vscode/src/runner/TestRunner.ts`, `packages/fliwright-vscode/src/runner/VitestRunner.ts`, `packages/fliwright-vscode/src/testing/ProjectRunsRoot.ts`, `packages/fliwright-vscode/src/testing/TestCollectionWatcher.ts`, `packages/fliwright-vscode/src/testing/types.ts`, `packages/fliwright-vscode/src/views/MockApiTreeProvider.ts`, `packages/fliwright-vscode/src/views/TestsTreeProvider.ts`, `packages/fliwright-vscode/src/webview/components/ui/resizable.tsx`, `packages/fliwright-vscode/src/webview/viewer/app.tsx`, `packages/fliwright-vscode/src/webview/viewer/artifacts.ts`, `packages/fliwright-vscode/src/webview/viewer/components/DetailTabs.tsx`, `packages/fliwright-vscode/src/webview/viewer/components/RunStatusBar.tsx`, `packages/fliwright-vscode/src/webview/viewer/components/StepsPane.tsx`, `packages/fliwright-vscode/src/webview/viewer/components/Viewport.tsx`, `packages/fliwright-vscode/src/webview/viewer/types.ts`, `packages/fliwright-cli/src/VitestProgress.ts`, `packages/fliwright-cli/src/artifacts.ts`, `packages/fliwright-core/src/timeline/TimelineTimeAxis.ts`, `packages/fliwright-vscode/src/WorkspaceProjectConfig.ts`, `packages/fliwright-vscode/src/webview/viewer/components/ExecutionTimeline.tsx`, `packages/fliwright-vscode/src/webview/viewer/timeScale.ts`, `packages/fliwright-cli/package.json`, `packages/fliwright-core/package.json`, `packages/fliwright-vscode/package.json`, `packages/fliwright-vitest/src/runner.ts`
- Supersedes: none

## Decision

Project replay nodes onto the shared recorded clock in the browser-safe
`@fliwright/core/timeline` entry point. Keep idle intervals and nested durations;
views may change ticks and presentation without changing the time domain. Map
trace actions by operation identity and retain screenshot source and time anchors.

Use actual Vitest case events for live editor status. Treat queued, running and
interrupted attempts separately from saved results so previous assertions do not
appear as evidence for an active attempt. Run artifact writes must not invalidate
test collection. Share project config imports across editor views, invalidate on
source changes, and reapply environment and explicit overrides at each boundary.

Vitest 5 task updates are throttled; Linux timer boundary behavior can postpone
reporter callbacks until a later task finishes. Wrap the configured runner while preserving its lifecycle hooks, and send live
case events through a temporary per-run append-only channel and drain it before
cleanup. Use one event producer per configured runner so status is not duplicated. The CLI live-progress integration test blocks a second case until
the first result arrives, so final-only reporting cannot pass it.
