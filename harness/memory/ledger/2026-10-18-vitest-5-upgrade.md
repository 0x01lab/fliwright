# Align Vitest 5 dependencies, runtime adapters and consumers

- Status: accepted
- Date: 2026-10-18
- Scope: Vitest integration, CLI initialization, TDD and editor runners
- Evidence: `scripts/verify-package-tarballs.mjs` (clean npm and pnpm consumers passed), `packages/fliwright-vitest/tests/scenario-composition.test.ts`, `packages/fliwright-vitest/tests/runner-composition.test.ts`, `packages/fliwright-vitest/tests/runner-fixture-outcomes.test.ts`, `packages/fliwright-cli/tests/init.test.ts`, `packages/fliwright-vscode/tests/VitestRunner.test.ts`, `packages/fliwright-tdd/tests/runtime/TddRuntime.test.ts`
- Changed-Files: `packages/fliwright-cli/src/commands/run.ts`, `packages/fliwright-cli/src/commands/doctor.ts`, `package.json`, `e2e/package.json`, `packages/fliwright-core/package.json`, `packages/fliwright-vitest/package.json`, `packages/fliwright-plugin-riverpod/package.json`, `packages/fliwright-tdd/package.json`, `packages/fliwright-cli/package.json`, `packages/fliwright-vscode/package.json`, `packages/fliwright-vitest/src/runner.ts`, `packages/fliwright-vitest/src/RecoveryReporter.ts`, `packages/fliwright-vitest/src/index.ts`, `packages/fliwright-vitest/src/TestRegistration.ts`, `packages/fliwright-cli/src/commands/init.ts`, `packages/fliwright-tdd/src/runtime/TddRuntime.ts`, `packages/fliwright-vscode/src/runner/VitestRunner.ts`
- Supersedes: none

## Decision

Pin the workspace, CLI peer dependency, generated projects and clean-package
consumer checks to Vitest 5.0.5 together. Runtime packages that depend on Vitest
require Node `^22.12.0 || ^24.0.0 || >=26.0.0`; CI uses Node 24.

Vitest 5 exposes its concrete runner as `TestRunner` from `vitest`, and reporter
types from `vitest/node`. Keep real subprocess checks for composed runners,
assertion/snapshot semantics, retries, cleanup, cancellation and recovery.
The old `vitest/runners`, `vitest/reporters` and `test.sequential` surfaces are
replaced rather than wrapped in compatibility shims.

Vitest resets assertion counts in its before-attempt hook, after aroundEach
fixtures may already have resolved. Assertion validation must inspect the
current attempt's reset counts, not subtract counts captured during fixture
setup that can belong to the preceding retry. Existing subprocess regressions
cover both retry assertions and rejecting assertion-free test bodies.

Mocks are cleared before each test by default. Test provider injection and its
call count within one test, and wait for asynchronous conditions instead of
assuming a fixed number of microtasks.

The JSON reporter writes to disk by default. The editor sets an explicit
per-run `vitest.json` output path and reads it before canonical finalization.
A real subprocess regression verifies both the raw report and the canonical
successful outcome; successful process exit without a report still fails.

The CLI reporter uses an explicit temporary JSON output file and enriches it
inside `onTestRunEnd`; Vitest 5 no longer calls the former `writeReport` hook.
Preserve runner errors and recovery attempts in that file before the parent
reads it. `resolveConfig` returns a Vite config whose `test` field holds the
resolved Vitest settings. Doctor must inspect that field without collecting
or executing tests. CLI subprocess tests cover successful runs, suite and
collection errors, unhandled errors, fault recovery and recording replay.

The tarball consumer smoke must generate a `fliwrightPreset` configuration
before executing the published fixture. Import-only checks do not verify
fixture lifecycle wiring; the standalone npm and pnpm consumers now run the
fixture with the public preset and recording disabled, without a Flutter VM.
