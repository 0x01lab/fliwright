# Publish the tested VSIX through trusted GitHub identity

- Status: accepted
- Date: 2026-11-05
- Scope: VS Code extension release
- Evidence: `.github/workflows/release-vscode.yml`, `packages/fliwright-vscode/scripts/run-integration.mjs`, `packages/fliwright-vscode/tests/integration/suite/index.cjs`, `scripts/tests/publish-vscode.test.mjs`
- Changed-Files: `packages/fliwright-vscode/package.json`, `packages/fliwright-vscode/scripts/run-integration.mjs`, `packages/fliwright-vscode/tests/integration/suite/index.cjs`, `scripts/publish-vscode.mjs`, `harness/stack/framework.json`
- Supersedes: none

## Decision

The VS Code Marketplace release job uses GitHub OIDC and a publisher-specific Trusted Publishing policy instead of a repository PAT secret. Keep the approved `@vscode/vsce` version high enough to support `publish --oidc`, and grant `id-token: write` only to the publish job.

Run the extension integration suite against both the development directory and the generated VSIX installed in a disposable VS Code profile. A development-host test can pass while the VSIX omits an entry point or webview resource; the installed-package check must precede Marketplace publication.
Use a short temporary user-data path for macOS extension-host tests because Unix-domain socket paths can exceed the platform limit in deep CI checkouts.
