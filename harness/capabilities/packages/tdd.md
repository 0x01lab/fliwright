---
package: "@fliwright/tdd"
path: "packages/fliwright-tdd"
source_fingerprint: "43c106c7310284e8dcd0ca729bfbc3bf8172cb1fc1eff311e3359be745a826b4"
generated: true
---

# Tdd Capabilities

## Responsibility

Own persistent focused test execution, Flutter synchronization, baseline reset and execution evidence. TDD decisions and test authoring belong to agent skills.

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
- `Flutter app synchronization`

## Package Entrypoints

- `.`

## Public Exports

- `AppCapabilityResetAdapters`
- `AppHandle`
- `AppStartParams`
- `AuthTokensResetAdapter`
- `BaselineConfig`
- `BaselineManager`
- `BootOptions`
- `buildTddFailureContext`
- `BuildTddFailureContextInput`
- `classifyFailure`
- `CollectedResult`
- `collectResultsFromModules`
- `CycleOpts`
- `DaemonMessage`
- `DaemonTransport`
- `decideSync`
- `defaultArtifactsRoot`
- `defaultStatusFilePath`
- `FlutterDaemonController`
- `FlutterDaemonEndpointSource`
- `FlutterDaemonEndpointSourceOptions`
- `focusAndRerun`
- `IsolatesResetAdapter`
- `isStructuralFileChange`
- `LocalDbResetAdapter`
- `looksStructuralAfterReload`
- `parseDaemonLines`
- `PermissionsResetAdapter`
- `PersistentTestExecutor`
- `ResetAdapter`
- `ResetAdapterResult`
- `ResetCategory`
- `ResetContext`
- `ResetReport`
- `RuntimeSnapshot`
- `SecureStorageResetAdapter`
- `StartOpts`
- `StorageBackedResetAdapters`
- `StorageResetAdapter`
- `StorageResetOutcome`
- `SubprocessDaemonTransport`
- `SubprocessDaemonTransportOptions`
- `SyncDecision`
- `TddCycleResult`
- `TddFailureArtifacts`
- `TddFailureAssertion`
- `TddFailureContext`
- `TddFailureKind`
- `TddFailureSource`
- `TddRecoveryHint`
- `TddRecoveryHintKind`
- `TddRuntime`
- `TddRuntimeDeps`
- `TddSyncResult`
- `TestRunOutcome`
- `TimersResetAdapter`
- `WebviewResetAdapter`

## Source Anchors

- `packages/fliwright-tdd/src/baseline/AppCapabilityResetAdapter.ts`
- `packages/fliwright-tdd/src/baseline/BaselineManager.ts`
- `packages/fliwright-tdd/src/baseline/StorageResetAdapter.ts`
- `packages/fliwright-tdd/src/daemon/DaemonTransport.ts`
- `packages/fliwright-tdd/src/daemon/FlutterDaemonController.ts`
- `packages/fliwright-tdd/src/daemon/FlutterDaemonEndpointSource.ts`
- `packages/fliwright-tdd/src/daemon/ReloadStrategy.ts`
- `packages/fliwright-tdd/src/daemon/SubprocessDaemonTransport.ts`
- `packages/fliwright-tdd/src/diagnostics/TddFailureContext.ts`
- `packages/fliwright-tdd/src/executor/FocusedRerunRecipe.ts`
- `packages/fliwright-tdd/src/executor/PersistentTestExecutor.ts`
- `packages/fliwright-tdd/src/executor/TestRunResults.ts`
- `packages/fliwright-tdd/src/index.ts`
- `packages/fliwright-tdd/src/runtime/TddRuntime.ts`
- `packages/fliwright-tdd/src/types.ts`
