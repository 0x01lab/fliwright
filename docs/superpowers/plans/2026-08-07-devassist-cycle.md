# DevAssist V1 Implementation Plan

## Goal

Ship a local `fliwright_devassist_cycle` MCP workflow that turns a natural-language development-test request into a temporary Fliwright test, runs it through the persistent TDD loop, traces the repair session, and verifies the same behavior after an external agent edits source.

## Phase 1: Shared Contracts

- Add DevAssist types and schemas in `@fliwright/core`: request, change-set snapshot, inference evidence, candidate metadata, session trace, status/result union.
- Add deterministic serialization, hashing, redaction, and persistence tests.
- Keep the session-level manifest separate from the existing versioned `TimelineData` contract.

## Phase 2: TDD Coordinator

- Add a `DevAssistCoordinator` in `@fliwright/tdd` that owns session creation, persistence, continuation, regeneration, and outcome mapping.
- Reuse `TddRuntime` for baseline reset, focused cycle execution, automatic synchronization, and transient recovery.
- Reuse `AiRuntime.generate()` with a strict structured schema to produce test intent, selectors, and SupportedAssertions.
- Render candidates only under `.fliwright/generated/`; validate before execution.
- Implement `green`, `red`, `needs_review`, `needs_regeneration`, and `blocked` outcomes.
- On red, invoke one passive diagnosis and append its reference to the session trace.

## Phase 3: MCP And CLI Adapters

- Add `fliwright_devassist_cycle` in `@fliwright/mcp` as a thin Zod-validated adapter over the coordinator.
- Return session, trace, timeline, candidate, sync, diagnosis, and next-call fields consistently.
- Add an optional `fliwright devassist` CLI adapter over the same coordinator after the MCP contract is stable.
- Do not duplicate orchestration in either adapter.

## Phase 4: Candidate Test Execution

- Confirm that `PersistentTestExecutor` can focus and execute an explicit generated test path without broadening ordinary project test discovery.
- Add the smallest additive Vitest configuration hook only if required.
- Ensure generated-test cleanup is session-aware and never removes promoted project tests.

## Phase 5: Exio Acceptance

- Use the existing Exio navigation flow and its active Fliwright VM-service configuration.
- Introduce a controlled, reversible navigation defect in the Exio working tree.
- Execute the natural-language DevAssist start cycle, inspect the red DevAssistTrace and timeline, repair the source through an external coding agent, and continue the same session to green.
- Restore the intentional defect after recording the acceptance evidence.

## Test Order

1. Core contract tests.
2. TDD coordinator lifecycle tests with mock AI and mock runtime.
3. MCP handler contract tests.
4. CLI adapter tests, if included.
5. Package builds and focused test suites.
6. Live Exio smoke acceptance with a VM Service.

## Package Verification

```text
pnpm --filter @fliwright/core test
pnpm --filter @fliwright/tdd test
pnpm --filter @fliwright/mcp test
pnpm --filter @fliwright/cli test
pnpm build
pnpm lint
node scripts/verify-harness.mjs
```

The live Exio acceptance is required in addition to these tests and must use a current VM Service URL, never a committed runtime configuration.
