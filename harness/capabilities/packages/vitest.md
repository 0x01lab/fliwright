---
package: "@fliwright/vitest"
path: "packages/fliwright-vitest"
source_fingerprint: "da93e1ec7aa99f89bbf6710863ff86ffc611889cd36b83808aa4f5df3c80973b"
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

## Public Exports

- `afterEach`
- `beforeEach`
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
- `FliwrightProjectFixtures`
- `FliwrightTest`
- `resolveRunsRoot`
- `ScenarioEnabledFliwrightTest`
- `ScenarioTest`
- `script`
- `test`

## Source Anchors

- `packages/fliwright-vitest/src/index.ts`
- `packages/fliwright-vitest/src/reporter.ts`
- `packages/fliwright-vitest/src/setup.ts`
