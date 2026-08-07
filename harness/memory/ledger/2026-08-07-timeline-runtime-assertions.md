# Timeline Runtime Assertions

- Status: accepted
- Date: 2026-08-07
- Scope: timeline assertions, active/passive agents, code generation, Vitest fixtures, CLI reporting, and bridge query protocol
- Evidence: `docs/superpowers/plans/2026-06-18-ai-native-timeline-agent.md`, `packages/fliwright-core/tests/assertions/AssertRuntime.test.ts`, `packages/fliwright-core/tests/agent/AgentRuntime.test.ts`, `packages/fliwright-core/tests/CodeGenerator.test.ts`, `packages/fliwright-vitest/tests/integration.test.ts`, `packages/fliwright-cli/tests/run.test.ts`, `packages/fliwright-bridge/test/query_test.dart`
- Changed-Files: `packages/fliwright-bridge/lib/src/extensions/context.dart`, `packages/fliwright-bridge/lib/src/extensions/inspect.dart`, `packages/fliwright-bridge/lib/src/extensions/query.dart`, `packages/fliwright-cli/src/commands/run.ts`, `packages/fliwright-core/src/AssertionSuggester.ts`, `packages/fliwright-core/src/CodeGenerator.ts`, `packages/fliwright-core/src/Page.ts`, `packages/fliwright-core/src/RecorderController.ts`, `packages/fliwright-core/src/agent/AgentRuntime.ts`, `packages/fliwright-core/src/ai/AiRuntime.ts`, `packages/fliwright-core/src/assertions/AssertRuntime.ts`, `packages/fliwright-core/src/assertions/types.ts`, `packages/fliwright-core/src/index.ts`, `packages/fliwright-core/src/types.ts`, `packages/fliwright-vitest/src/index.ts`
- Supersedes: none

## Decision

Timeline-native runtime assertions must create a single assertion node and turn
failures into `FliwrightAgentError` values with `assertion_failed`. When a page
and artifact store are available, the same failure path captures screenshot and
snapshot artifacts best-effort. Bridge `query` resolves live snapshot and query
references directly so callers can use the stable ref contract without
reconstructing selectors.

Active and configured passive AI calls must retain their provider-neutral
timeline metadata, including artifact locations and fallback usage, without
recording secrets. Generated timeline tests keep action and frame structure,
and only emit assertions for a known, unambiguous postcondition target; other
recording suggestions remain explicit TODOs. CLI reports preserve every
agent-visible failure from all timeline sidecars.
