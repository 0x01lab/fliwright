---
package: "@fliwright/tdd"
path: "packages/fliwright-tdd"
source_fingerprint: "2b20cad303ead331884344789a6565e57c2a5301463782f708435a4401850230"
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
