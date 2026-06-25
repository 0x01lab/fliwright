# P0.2 Spike Verdict — 2026-06-22 (revised 2026-06-25)

1. **Focused rerun on Vitest 2.1.9: PASS** — recipe is
   `changeNamePattern(testName, [file])`, which reruns internally. Encoded in
   `src/executor/FocusedRerunRecipe.ts`.
2. **Single-driver ownership: REVISED — in-process object sharing is NOT reachable on 2.1.9.**
   The opt-in fixture extension (`createFliwrightTest(config, { driverProvider })`) is implemented in
   `@fliwright/vitest` and bypasses `sharedDriver` for driver consumers — that part passed. But
   **Vitest 2.1.9 runs test files in worker processes**, and a live `FliwrightDriver` (holding a
   WebSocket) cannot be passed across a worker boundary. So the injected provider is not actually
   reachable from the test process. `PersistentTestExecutor.boot()` therefore ignores the injected
   provider (`void opts.driverProvider`) and instead exports `FLIWRIGHT_VM_SERVICE_URL`, which
   ordinary `@fliwright/vitest` fixtures consume to connect to the same app VM service.
3. **Failure-result collection: PASS** — `PersistentTestExecutor` collects pass/fail + structured
   failure details from a custom `ResultReporter`'s `onFinished(files)` task tree, and enriches red
   results with source/assertion/artifacts read from the MCP failure-context + timeline files.

## Decision

**The fallback is the production path.** We adopt the `vm-service-url` driver-sharing model as the
formal architecture, not as a temporary fallback. Consequences (now explicit, no longer hidden):

- The TDD runtime owns **one** `FliwrightDriver` for baseline reset / app interaction, and the
  in-process Vitest fixtures create their **own** connection to the same app VM service via
  `FLIWRIGHT_VM_SERVICE_URL`. That is **two** WebSocket connections to one app — acceptable for the
  loop, but it is *not* the single-connection model the original spec §6.0 promised.
- The "executor rerun is sub-second" claim holds only for the part P0 controls (reset + sync +
  run-one-test, excluding the `flutter`-tooling-bound reload/restart). It does **not** depend on
  in-process driver sharing.
- `RuntimeSnapshot.fixtureDriverSharing` reports `'vm-service-url'` (not `'in-process-provider'`),
  and `notes` explains the worker-boundary limit, so agents do not mistake this for true
  single-object sharing.

## What would re-open the in-process path

Re-evaluate only if a later Vitest/Node version lets the test file run in the MCP server's own
process (e.g. `pool: 'forks'` with a worker-thread-less / in-thread execution mode where the
injected singleton is reachable). Until then, the spec's §6.0 single-driver claim is treated as a
deferred goal, and the §6.0/§6.6/§10/§11 references below describe what shipped.

## References

- Spec revisions: `docs/superpowers/specs/2026-06-22-fliwright-tdd-design.md` §6.0 / §6.6 / §10 / §11.
- Production wiring: `src/executor/PersistentTestExecutor.ts` (env injection),
  `src/runtime/TddRuntime.ts` (`snapshot().fixtureDriverSharing`), `packages/fliwright-vitest`
  (`createFliwrightTest` `driverProvider` option).
