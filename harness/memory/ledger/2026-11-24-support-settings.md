# Share project Support Settings between the editor and automation

- Status: accepted
- Date: 2026-11-24
- Scope: Core support settings, CLI and Vitest project configuration, VS Code Support Settings
- Evidence: `packages/fliwright-core/tests/SupportSettings.test.ts`, `packages/fliwright-cli/tests/finite-contract.test.ts`, `packages/fliwright-vscode/tests/SupportSettingsView.test.ts`, `packages/fliwright-vscode/tests/BundledConfig.test.ts`
- Changed-Files: `packages/fliwright-core/src/SupportSettings.ts`, `packages/fliwright-core/src/RecordingConfig.ts`, `packages/fliwright-core/src/index.ts`, `packages/fliwright-cli/src/config.ts`, `packages/fliwright-cli/src/index.ts`, `packages/fliwright-vitest/src/preset.ts`, `packages/fliwright-vscode/package.json`, `packages/fliwright-vscode/src/WorkspaceProjectConfig.ts`, `packages/fliwright-vscode/src/extension.ts`, `packages/fliwright-vscode/src/scripts/ScriptRunner.ts`, `packages/fliwright-vscode/src/scripts/VitestScriptConfig.ts`, `packages/fliwright-vscode/src/support/SupportSettingsView.ts`, `packages/fliwright-vscode/src/support/app.ts`, `packages/fliwright-vscode/src/support/messages.ts`
- Supersedes: none

## Decision

Share one serializable project declaration between the trusted VS Code view and
the support's typed runtime reader. Import declarations during discovery and
read values when the support runs, so a missing field affects the operation
that needs it. Core owns validation and project identity for both consumers.
Save only explicit local edits per project and support. Check the file revision
with the write so an older editor draft cannot overwrite a newer save.

Resolve fields independently and preserve explicit `false`, `0`, and permitted
empty strings. A reset removes the local override. Keep project declarations
in configuration snapshots and actual saved values on the execution host.
Regression coverage checks that a saved value reaches an independent Node
script and a CLI-launched Vitest run, in addition to the panel's own reload.

Core reports a missing required value with the support ID, field, local file,
and optional declared environment variable. The CLI adds runtime override
guidance, and VS Code offers to open Support Settings. The Core diagnostic
also survives test reporters that retain only the error message or stack.
