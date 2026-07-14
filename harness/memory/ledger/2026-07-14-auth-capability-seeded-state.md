# Authenticated State Uses App Capability

- Status: accepted
- Date: 2026-07-14
- Scope: fliwright bridge app capabilities and core app-instance helpers
- Evidence: `packages/fliwright-bridge/test/app_instance_test.dart`, `packages/fliwright-core/tests/AppInstance.test.ts`, `packages/fliwright-vscode/tests/Manifest.test.ts`
- Changed-Files: `packages/fliwright-bridge/lib/src/extensions/app_instance.dart`, `packages/fliwright-bridge/test/app_instance_test.dart`, `packages/fliwright-core/src/AppInstance.ts`, `packages/fliwright-core/tests/AppInstance.test.ts`, `packages/fliwright-vscode/package.json`, `packages/fliwright-vscode/src/config.ts`, `packages/fliwright-vscode/src/extension.ts`, `packages/fliwright-vscode/src/runner/TestRunner.ts`, `packages/fliwright-vscode/src/runner/VitestRunner.ts`, `packages/fliwright-vscode/src/scripts/ScriptRunner.ts`, `packages/fliwright-vscode/src/types.ts`
- Supersedes: `2026-07-14-e2e-automation-config-source.md` (withdrawn)

## Decision

Business E2E tests that target already-authenticated behavior should enter the
app through a test-only authentication capability, not through a captcha bypass
environment flag. Fliwright owns the generic app-capability protocol and the
standard `auth.seedLoggedIn` / `auth.clearSession` method names; the target app
owns the handler that writes product-specific token storage, account providers,
profile cache, router state, and any other synchronized session state.

Do not add VS Code settings, dart-defines, or environment variables whose
purpose is to disable third-party captcha globally. Keep captcha coverage as a
small login smoke path, and keep logged-in business coverage deterministic by
seeding authenticated app state through `FliwrightAppCapability`.
