# Preserve visual review evidence across comparison sources

- Status: accepted
- Date: 2026-11-06
- Scope: core flow review and CLI capture orchestration
- Evidence: `packages/fliwright-core/tests/flow/FlowReviewReport.test.ts`, `packages/fliwright-core/tests/flow/FlowReviewBundle.test.ts`, `packages/fliwright-core/tests/flow/FlowVisualDiff.test.ts`, `packages/fliwright-core/tests/flow/FigmaRestScreenshotProvider.test.ts`, `packages/fliwright-cli/tests/flow.test.ts`, `packages/fliwright-cli/tests/flow-runtime.test.ts`
- Changed-Files: `packages/fliwright-cli/src/commands/flow-runtime.ts`, `packages/fliwright-cli/src/commands/flow.ts`, `packages/fliwright-cli/src/registry/flow-schemas.ts`, `packages/fliwright-core/src/flow/FigmaRestScreenshotProvider.ts`, `packages/fliwright-core/src/flow/FlowReviewBundle.ts`, `packages/fliwright-core/src/flow/FlowReviewReport.ts`, `packages/fliwright-core/src/flow/FlowVisualDiff.ts`

- Supersedes: none

## Decision

Comparison sources supplement each other: combine per-node metrics without
discarding larger deltas, mismatches or errors. Incomplete design bindings and
runtime entry points remain visible as missing coverage; an empty comparison
does not prove a pass. Generated report commands carry their custom tolerances.

Each default one-shot review has a unique artifact directory so later runs do
not replace earlier evidence. Figma capture cancellation reaches metadata and
image requests and stops subsequent targets. PNG grayscale/RGB transparency
keys must participate in comparison rather than silently becoming opaque.

During UI development with a supplied Figma reference, the agent can use the
existing screenshot command directly, inspect the runtime image against the
matching design state and recapture after fixes. Pixel metrics support this
review; they do not establish typography, token or component fidelity. Reusable
instructions live in the shipped CLI workflow Skill, not a mandatory Flow setup.
