---
package: "@fliwright/e2e-tests"
path: "e2e"
source_fingerprint: "59b532f07ac6a5e9685e54e1abdbcef22c5689dae2a2d2b4f0d20d3384dc7e31"
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
