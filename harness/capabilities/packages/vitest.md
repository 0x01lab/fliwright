---
package: "@fliwright/vitest"
path: "packages/fliwright-vitest"
source_fingerprint: "7c2bef406cfb8e9aa20a6968652d5411793d13b5045a3c241553a98587d62911"
generated: true
---

# Vitest Capabilities

## Responsibility

Adapt the core runtime to Vitest fixtures, hooks, configuration, reporting, and test lifecycle behavior.

## Boundary

### May Depend On

- `@fliwright/core`
- `@fliwright/native`

### Must Not Own

- `automation domain behavior`
- `VM-service protocol changes`
- `CLI or editor workflows`

## Owned Capabilities

- `Vitest fixtures`
- `test lifecycle integration`

## Package Entrypoints

- `.`
- `./preset`
- `./reporter`
- `./runner`

## Public Exports

- `afterEach`
- `beforeEach`
- `createFliwrightRunner`
- `createFliwrightScript`
- `createFliwrightTest`
- `CreateFliwrightTestOptions`
- `defineConfig`
- `expect`
- `extendFliwrightTest`
- `FliwrightConfig`
- `FliwrightFixtures`
- `FliwrightLogConfig`
- `FliwrightLogFormat`
- `FliwrightLogOutput`
- `fliwrightPreset`
- `FliwrightProjectFixtures`
- `FliwrightRecoveryReporter`
- `FliwrightRunner`
- `FliwrightRunnerConstructor`
- `FliwrightRunnerOptions`
- `FliwrightTest`
- `FliwrightVitestPresetOptions`
- `NativeDeviceProvider`
- `resolveRunsRoot`
- `ScenarioEnabledFliwrightTest`
- `ScenarioTest`
- `script`
- `test`

## Source Anchors

- `packages/fliwright-vitest/src/AttemptContext.ts`
- `packages/fliwright-vitest/src/FinalizationBudget.ts`
- `packages/fliwright-vitest/src/RecoveryReporter.ts`
- `packages/fliwright-vitest/src/TaskEndpointLease.ts`
- `packages/fliwright-vitest/src/TaskManagedApp.ts`
- `packages/fliwright-vitest/src/TaskNativeSession.ts`
- `packages/fliwright-vitest/src/TaskScenarioPreparation.ts`
- `packages/fliwright-vitest/src/TestRegistration.ts`
- `packages/fliwright-vitest/src/index.ts`
- `packages/fliwright-vitest/src/preset.ts`
- `packages/fliwright-vitest/src/reporter.ts`
- `packages/fliwright-vitest/src/runner.ts`
- `packages/fliwright-vitest/src/setup.ts`
