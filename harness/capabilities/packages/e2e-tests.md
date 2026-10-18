---
package: "@fliwright/e2e-tests"
path: "e2e"
source_fingerprint: "e4af59e1df2390676413cc1ca23ea4f372954fb89c4e00a06595c484e27a9153"
generated: true
---

# E2e Tests Capabilities

## Responsibility

Verify public Fliwright behavior against running Flutter applications through smoke and integration tests.

## Boundary

### May Depend On

- `@fliwright/core`
- `@fliwright/vitest`

### Must Not Own

- `public runtime APIs`
- `product capabilities`
- `shared test fixtures for package consumers`

## Owned Capabilities

- `Flutter VM smoke tests`

## Source Anchors

- `e2e/design-qa-smoke-runner.test.ts`
- `e2e/design-qa-smoke.test.ts`
- `e2e/exio-app-e2e.test.ts`
- `e2e/form-fill-e2e.test.ts`
- `e2e/form-mock-e2e.test.ts`
- `e2e/go-router-navigation-e2e.test.ts`
- `e2e/mock-api-demo.test.ts`
- `e2e/mock-api-e2e.test.ts`
- `e2e/smoke_test.ts`
- `e2e/vitest.config.ts`
