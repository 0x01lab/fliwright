---
package: "@fliwright/vitest"
path: "packages/fliwright-vitest"
source_fingerprint: "2c4c034c53bc492e452fc44f866d71e2bcdbac34515440f245a0af76f5add8d6"
generated: true
---

# Vitest Capabilities

## Responsibility

Adapt the core runtime to Vitest fixtures, hooks, configuration, reporting, and test lifecycle behavior.

## Boundary

### May Depend On

- `@fliwright/core`

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
- `packages/fliwright-vitest/src/TestRegistration.ts`
- `packages/fliwright-vitest/src/index.ts`
- `packages/fliwright-vitest/src/preset.ts`
- `packages/fliwright-vitest/src/reporter.ts`
- `packages/fliwright-vitest/src/runner.ts`
- `packages/fliwright-vitest/src/setup.ts`
