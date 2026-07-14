# E2E Automation Uses Workspace Config

- Status: accepted
- Date: 2026-07-14
- Scope: packages/fliwright-core workspace config and packages/fliwright-vscode automation workflow
- Evidence: `harness/memory/runtime-configuration.md`, `packages/fliwright-core/tests/WorkspaceConfig.test.ts`, `packages/fliwright-vscode/tests/Config.test.ts`, `packages/fliwright-vscode/tests/E2eAutomation.test.ts`, `packages/fliwright-vscode/tests/Manifest.test.ts`
- Changed-Files: `packages/fliwright-core/src/WorkspaceConfig.ts`, `packages/fliwright-core/src/index.ts`, `packages/fliwright-vscode/src/config.ts`, `packages/fliwright-vscode/src/extension.ts`, `packages/fliwright-vscode/src/runner/TestRunner.ts`, `packages/fliwright-vscode/src/runner/VitestRunner.ts`, `packages/fliwright-vscode/src/scripts/ScriptRunner.ts`, `packages/fliwright-vscode/src/types.ts`, `packages/fliwright-vscode/src/automation/E2eAutomation.ts`, `packages/fliwright-vscode/src/status/E2eAutomationStatusBarService.ts`, `packages/fliwright-vscode/package.json`
- Supersedes: none

## Decision

E2E automation environment state is project runtime state and must live in
`.fliwright/config.json`, not in VS Code settings. The VS Code extension may
expose commands, status UI, and debug/test launch behavior for this state, but
the editable source of truth is the workspace config field
`e2eAutomation.enabled` plus its observable `env` and `dartDefines` metadata.

This keeps local automation state visible to humans and agents, lets command
line and editor workflows share the same project state, and avoids hiding
captcha-bypass behavior in editor-specific settings.
