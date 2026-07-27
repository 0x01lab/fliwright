---
package: "@fliwright/vitest"
path: "packages/fliwright-vitest"
source_fingerprint: "d3488901e00dfd92f6c056a57b01d4f68a4cc4047caada3fabbcaca4117ed44e"
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
- `FliwrightLogConfig`
- `FliwrightLogFormat`
- `FliwrightLogOutput`
- `FliwrightProjectFixtures`
- `FliwrightTest`
- `resolveRunsRoot`
- `script`
- `test`

## Source Anchors

- `packages/fliwright-vitest/src/index.ts`
- `packages/fliwright-vitest/src/reporter.ts`
- `packages/fliwright-vitest/src/setup.ts`
