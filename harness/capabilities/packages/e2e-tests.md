---
package: "@fliwright/e2e-tests"
path: "e2e"
source_fingerprint: "ff41607c2a3968a317cf1859a8488913ccaf7d49e8862dc9d530fef9931c983e"
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

- `e2e/.fliwright/support/camera-scenarios.ts`
- `e2e/.fliwright/support/native-scenarios.ts`
- `e2e/.fliwright/tests/camera.test.ts`
- `e2e/.fliwright/tests/native-android-mixed.test.ts`
- `e2e/.fliwright/tests/native-input.test.ts`
- `e2e/.fliwright/tests/native-mixed.test.ts`
- `e2e/camera.vitest.config.ts`
- `e2e/design-qa-smoke-runner.test.ts`
- `e2e/design-qa-smoke.test.ts`
- `e2e/exio-app-e2e.test.ts`
- `e2e/fliwright.config.ts`
- `e2e/form-fill-e2e.test.ts`
- `e2e/form-mock-e2e.test.ts`
- `e2e/go-router-navigation-e2e.test.ts`
- `e2e/mock-api-demo.test.ts`
- `e2e/mock-api-e2e.test.ts`
- `e2e/native.android.project.ts`
- `e2e/native.project.ts`
- `e2e/smoke_test.ts`
- `e2e/vitest.config.ts`
