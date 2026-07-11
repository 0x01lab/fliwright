# Delivery Workflow

Open this only when committing, opening a pull request, or preparing a release
artifact. For validation selection, open
[../constraints/quality.md](../constraints/quality.md).

## Commit

Use Conventional Commit messages with an imperative, scoped subject, for example
`feat(mcp): add fliwright_run tool`, `fix(core): call service extensions with
isolate id`, or `chore: ignore flutter generated files`.

Stage only intended source, tests, and hand-authored documentation. Do not stage
generated `docs/features/`, `dist`, Flutter-generated files, or local runtime
state.

## Pull Request

Describe the behavior change, list the verification commands actually run, and
link the relevant issue or design record. Include screenshots or logs for
Flutter/UI or E2E work. State any required VM-service URL or device setup.

## Release

For package publication or VS Code release work, open
[../../docs/release/publishing.md](../../docs/release/publishing.md). That
document is operationally specific and should not be loaded for normal commits.
