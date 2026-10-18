# Skill + CLI + CI implementation

Source design: [consolidation](../specs/2026-10-17-skill-cli-consolidation-design.md), reassessed at `45e3f14`.

- [x] Correct Mock query/reset semantics and validate interactions before connecting.
- [x] Unified command discovery, JSON errors/results, input validation and exit codes.
- [x] Finite run/script/record/doctor contracts, deadline/signals/JUnit output.
- [x] App diagnostics/source/snapshot/reload, offline failures/timeline/diagnosis, scenario and Flow parity.
- [x] CLI-local persistent connection/TDD lifecycle with endpoint lease phase handoff.
- [x] CLI workflows Skill, plugin sync, CI failure artifacts and smoke coverage.
- [x] Migrate capability assertions; remove MCP package/config/release/contracts.
- [x] Build/test/lint/harness/plugin/package checks, source-derived references and enhanced real Flutter smoke.

Implementation includes 64 CLI commands, project-local connection workers, per-attempt named scenarios, offline artifact queries, bounded recording, generation/TDD/Flow workflows, the bundled CLI Skill, and CI JSON/JUnit/failure artifact handling. The MCP package, plugin server declaration, editor setup command, dependencies and release entries are removed.

The existing Flutter launch abstraction was corrected against the real tool: `flutter run --machine` emits app identity/debugPort/started events; current Flutter does not provide an app.start RPC. Managed runs additionally wait for the same endpoint's Fliwright bridge with a cancellable readiness budget. First recording SIGINT stops and flushes normally; subsequent interruption cancels. Artifact-finalization errors retain the original runner result.

Validation evidence is captured in the final task result; generated implementation reference covers 10 packages. The concurrent Vitest 5 upgrade is retained. No commit or publication was performed.


## Verified acceptance

- TypeScript packages: core 971, CLI 235, TDD 129, VS Code 372, Riverpod plugin 16, Vitest 81 passed plus 3 intentional expected failures. After the last CLI change, all 49 run tests and 24 IPC/TDD/command contract tests passed.
- Dart bridge: 194 passed, 2 skipped; analyze reports no issues. The two files with import cleanup also passed their 36-test focused rerun.
- Workspace build and TypeScript lint passed. Harness passed with `--base HEAD --working-tree`; plugin checks reported 11 passed and no failures (optional official validator unavailable).
- All five npm tarballs passed package validation; clean npm and pnpm consumers loaded their public APIs with Vitest 5.
- Real generated Flutter smoke passed attach, managed launch, intentional test failure with exit 1 and canonical evidence/JUnit, and managed startup cancellation with exit 5.
- Regenerated 11 Harness capability files and 309 feature-reference pages for 10 packages / 64 CLI commands.
