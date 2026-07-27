---
package: "@fliwright/tdd"
path: "packages/fliwright-tdd"
source_fingerprint: "7c608b3c2e9b0a082184824231301f047c001f7c867d125648f1c47affb1d5bb"
generated: true
---

# Tdd Capabilities

## Responsibility

Own persistent TDD execution, baseline reset, focused reruns, red-first generation, and repair planning.

## Boundary

### May Depend On

- `@fliwright/core`
- `@fliwright/vitest`

### Must Not Own

- `general-purpose CLI commands`
- `MCP transport contracts`
- `Flutter bridge protocol`

## Owned Capabilities

- `TDD execution`
- `test repair workflow`

## Package Entrypoints

- `.`

## Public Exports

- `analyzeInteractionSpecCoverage`
- `AppCapabilityResetAdapters`
- `AppHandle`
- `AppStartParams`
- `AuthTokensResetAdapter`
- `BaselineManager`
- `bestLocatorHint`
- `BootOptions`
- `buildTddFailureContext`
- `BuildTddFailureContextInput`
- `classifyFailure`
- `CollectedResult`
- `collectResultsFromFiles`
- `CycleOpts`
- `DaemonMessage`
- `DaemonTransport`
- `decideSync`
- `defaultArtifactsRoot`
- `defaultStatusFilePath`
- `FlutterDaemonController`
- `focusAndRerun`
- `generateRedFirstTest`
- `GenerateRedFirstTestResult`
- `generateRedFirstTestSuite`
- `GenerateRedFirstTestSuiteResult`
- `InteractionSpec`
- `InteractionSpecCoverageGap`
- `InteractionSpecCoverageGapKind`
- `InteractionSpecCoverageReport`
- `InteractionSpecValidationError`
- `InteractionSpecValidationIssue`
- `InteractionSpecValidationResult`
- `IsolatesResetAdapter`
- `isStructuralFileChange`
- `LocalDbResetAdapter`
- `LocatorHint`
- `looksStructuralAfterReload`
- `parseDaemonLines`
- `parseInteractionSpec`
- `PermissionsResetAdapter`
- `PersistentTestExecutor`
- `prepareRedFirstWorkflow`
- `PrepareRedFirstWorkflowResult`
- `RedFirstTestGeneratorOptions`
- `RedFirstTestSuiteGeneratorOptions`
- `RedFirstWorkflowContext`
- `RedFirstWorkflowOptions`
- `RedFirstWorkflowPlan`
- `RedFirstWorkflowStatus`
- `ResetAdapter`
- `ResetAdapterResult`
- `ResetCategory`
- `ResetContext`
- `ResetReport`
- `ResultReporter`
- `RuntimeSnapshot`
- `Scenario`
- `SecureStorageResetAdapter`
- `SelectorCandidate`
- `SelectorSynthesisResult`
- `SelectorSynthesisStatus`
- `SelectorTraceStep`
- `SpecAssertion`
- `SpecElement`
- `SpecElementRole`
- `SpecFlow`
- `SpecStep`
- `StartOpts`
- `StorageBackedResetAdapters`
- `StorageResetAdapter`
- `StorageResetOutcome`
- `SubprocessDaemonTransport`
- `SubprocessDaemonTransportOptions`
- `SyncDecision`
- `synthesizeSelector`
- `synthesizeSelectorsForElements`
- `TddCycleResult`
- `TddFailureArtifacts`
- `TddFailureAssertion`
- `TddFailureContext`
- `TddFailureKind`
- `TddFailureSource`
- `TddRecoveryHint`
- `TddRecoveryHintKind`
- `TddRepairCycleResult`
- `TddRepairOpts`
- `TddRepairPlan`
- `TddRepairPlanner`
- `TddRepairPlannerLike`
- `TddRepairPlannerOptions`
- `TddRepairProposalEntry`
- `TddRepairStep`
- `TddRepairTrace`
- `TddRuntime`
- `TddRuntimeDeps`
- `TddSyncResult`
- `TestRunOutcome`
- `TimersResetAdapter`
- `validateInteractionSpec`
- `WebviewResetAdapter`
- `WidgetCandidate`

## Source Anchors

- `packages/fliwright-tdd/src/baseline/AppCapabilityResetAdapter.ts`
- `packages/fliwright-tdd/src/baseline/BaselineManager.ts`
- `packages/fliwright-tdd/src/baseline/StorageResetAdapter.ts`
- `packages/fliwright-tdd/src/daemon/DaemonTransport.ts`
- `packages/fliwright-tdd/src/daemon/FlutterDaemonController.ts`
- `packages/fliwright-tdd/src/daemon/ReloadStrategy.ts`
- `packages/fliwright-tdd/src/daemon/SubprocessDaemonTransport.ts`
- `packages/fliwright-tdd/src/diagnostics/TddFailureContext.ts`
- `packages/fliwright-tdd/src/executor/FocusedRerunRecipe.ts`
- `packages/fliwright-tdd/src/executor/PersistentTestExecutor.ts`
- `packages/fliwright-tdd/src/executor/ResultReporter.ts`
- `packages/fliwright-tdd/src/generator/RedFirstTestGenerator.ts`
- `packages/fliwright-tdd/src/index.ts`
- `packages/fliwright-tdd/src/repair/TddRepairPlanner.ts`
- `packages/fliwright-tdd/src/runtime/TddRuntime.ts`
- `packages/fliwright-tdd/src/selectors/SelectorSynthesizer.ts`
- `packages/fliwright-tdd/src/spec/InteractionSpec.ts`
- `packages/fliwright-tdd/src/spec/InteractionSpecCoverage.ts`
- `packages/fliwright-tdd/src/types.ts`
- `packages/fliwright-tdd/src/workflow/RedFirstWorkflow.ts`
