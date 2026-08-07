---
package: "@fliwright/vitest"
path: "packages/fliwright-vitest"
source_fingerprint: "e6c578dd052b3a21f0506c290262ae458730081da5d132ed9c80d7432d61c9b6"
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
