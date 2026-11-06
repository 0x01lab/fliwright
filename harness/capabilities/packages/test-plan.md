---
package: "@fliwright/test-plan"
path: "packages/test-plan"
source_fingerprint: "68216d4fe8b12421d3a91c6e0838e327bb1261321a7828ee0b1c9f01c672b3c3"
generated: true
---

# Test Plan Capabilities

## Responsibility

Provide deterministic GitLab snapshots, acceptance provenance and coverage validation, and case bindings for skill-authored portable test plans.

## Boundary

### May Depend On

- None

### Must Not Own

- `Flutter automation runtime`
- `test execution`
- `release approval`
- `Fliwright CLI command orchestration`
- `AI generation or provider orchestration`

## Owned Capabilities

- `GitLab Work Item snapshots`
- `framework-independent test planning`
- `automation case bindings`

## Package Entrypoints

- `.`

## Binary Entrypoints

- `test-plan`

## Public Exports

- `assemblePlan`
- `Automation`
- `automationSchema`
- `bindCase`
- `Execute`
- `executeProcess`
- `fetchItems`
- `generateCoverage`
- `ItemSource`
- `parseItemUrl`
- `planDraftSchema`
- `ProcessOptions`
- `readGitLabItem`
- `renderCoverage`
- `sourceSnapshotSchema`
- `TestPlan`
- `testPlanSchema`
- `updateAutomation`
- `validatePlan`

## Source Anchors

- `packages/test-plan/src/Coverage.ts`
- `packages/test-plan/src/GitLab.ts`
- `packages/test-plan/src/Plan.ts`
- `packages/test-plan/src/cli.ts`
- `packages/test-plan/src/files.ts`
- `packages/test-plan/src/index.ts`
- `packages/test-plan/src/process.ts`
- `packages/test-plan/src/schema.ts`
