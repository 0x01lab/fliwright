---
package: "@fliwright/vitest"
path: "packages/fliwright-vitest"
source_fingerprint: "1463ac7a6f0ad482016e578cc3731d9bc2d9c877a1e28a0119f94f66ce65c608"
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
