# Preserve saved evidence in VS Code report and mock workflows

- Status: accepted
- Date: 2026-11-11
- Scope: core logging and VS Code mock/report tooling
- Evidence: `packages/fliwright-core/tests/Logging.test.ts`, `packages/fliwright-vscode/tests/TestReportService.test.ts`, `packages/fliwright-vscode/tests/MockApiSearchController.test.ts`, `packages/fliwright-vscode/tests/MockApiTreeProvider.test.ts`, `packages/fliwright-vscode/tests/viewer/ViewerPanel.test.ts`
- Changed-Files: `packages/fliwright-core/src/logging.ts`, `packages/fliwright-vscode/src/extension.ts`, `packages/fliwright-vscode/src/viewer/ViewerPanel.ts`, `packages/fliwright-vscode/src/views/MockApiTreeProvider.ts`, `packages/fliwright-vscode/src/webview/viewer/app.tsx`, `packages/fliwright-vscode/src/webview/viewer/components/LogsTab.tsx`, `packages/fliwright-vscode/src/webview/viewer/components/RunStatusBar.tsx`, `packages/fliwright-vscode/src/webview/viewer/types.ts`, `packages/fliwright-vscode/src/testing/TestReportService.ts`, `packages/fliwright-vscode/src/views/MockApiSearchController.ts`, `packages/fliwright-vscode/package.json`
- Supersedes: none

## Decision

VS Code HTML reports reuse the existing CLI report generator and canonical saved
run manifests. A selected test identifies eligible completed runs; the generated
report covers the complete run, including failed or partial evidence. Attempt
views resolve their owning manifest and report generation stays disabled while
the run is active. Cancellation must preserve existing output.

Mock API search and active-rule filtering derive from the loaded endpoint tree
and current applied-rule state. Clearing the filter restores the complete tree;
filtering must not apply or stop mock rules.

Serialized error objects retain their structured fields through core logging and
Run Viewer rendering so offline diagnostics do not discard runtime evidence.
