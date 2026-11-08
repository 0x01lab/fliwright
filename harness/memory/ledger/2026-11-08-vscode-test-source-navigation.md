# Keep test source navigation independent of run artifacts

- Status: accepted
- Date: 2026-11-08
- Scope: VS Code Tests panel
- Evidence: `packages/fliwright-vscode/tests/integration/suite/index.cjs`, `packages/fliwright-vscode/src/extension.ts`, `packages/fliwright-vscode/package.json`
- Changed-Files: `packages/fliwright-vscode/src/extension.ts`, `packages/fliwright-vscode/package.json`
- Supersedes: none

## Decision

Test files and collected test cases use different source URI fields: `uri` and
`fileUri`. The source action resolves the field from the node kind and opens a
persistent editor; it does not require prior execution or available run artifacts.
Expose it on both idle and running rows so execution status does not hide source
navigation. Development-extension and installed-VSIX integration tests exercise
both node kinds against real source files and verify the active editor URI.
