# Timeline Runtime Assertions

- Status: accepted
- Date: 2026-08-07
- Scope: core assertion facade, Vitest fixtures, and bridge query protocol
- Evidence: `docs/superpowers/plans/2026-06-18-ai-native-timeline-agent.md`, `packages/fliwright-core/tests/assertions/AssertRuntime.test.ts`, `packages/fliwright-vitest/tests/integration.test.ts`, `packages/fliwright-bridge/test/query_test.dart`
- Changed-Files: `packages/fliwright-bridge/lib/src/extensions/context.dart`, `packages/fliwright-bridge/lib/src/extensions/inspect.dart`, `packages/fliwright-bridge/lib/src/extensions/query.dart`, `packages/fliwright-core/src/Page.ts`, `packages/fliwright-core/src/assertions/AssertRuntime.ts`, `packages/fliwright-core/src/assertions/types.ts`, `packages/fliwright-core/src/index.ts`, `packages/fliwright-vitest/src/index.ts`
- Supersedes: none

## Decision

Timeline-native runtime assertions must create a single assertion node and turn
failures into `FliwrightAgentError` values with `assertion_failed`. When a page
and artifact store are available, the same failure path captures screenshot and
snapshot artifacts best-effort. Bridge `query` resolves live snapshot and query
references directly so callers can use the stable ref contract without
reconstructing selectors.
