# Composable Test Scenarios Are the Test Environment Contract

- Status: accepted
- Date: 2026-08-15
- Scope: core scenario coordination, Vitest execution, bridge startup, and target-app test bootstraps
- Evidence: `docs/superpowers/specs/2026-08-15-composable-test-scenarios-design.md`, `packages/fliwright-core/tests/Scenario.test.ts`, `packages/fliwright-vitest/tests/create-fliwright-test.driverProvider.test.ts`, `packages/fliwright-bridge/test/extension_registry_test.dart`
- Changed-Files: `packages/fliwright-core/src/Scenario.ts`, `packages/fliwright-core/src/index.ts`, `packages/fliwright-vitest/src/index.ts`, `packages/fliwright-bridge/lib/src/extensions/test_bootstrap.dart`, `packages/fliwright-bridge/lib/src/bridge.dart`, `packages/fliwright-bridge/lib/fliwright_bridge.dart`, `examples/riverpod_demo/test_driver/fliwright_app.dart`
- Supersedes: none

## Decision

Reusable automation environments are named `TestScenario` declarations. A
scenario composes typed mock, storage, auth, optional state-adapter, app
capability, and navigation layers through `ScenarioResolver` and
`ScenarioCoordinator`; test runners must not introduce a second environment or
baseline schema for the same concern.

Authenticated business tests must use the application-owned `auth.seedLoggedIn`
capability and verify `auth.getStatus`. They must not execute real login,
depend on credentials, mock a login request as a substitute for client session
state, or bypass CAPTCHA. Riverpod is an optional `state` layer for ordinary
business state and must not be the framework's authentication mechanism.

For first-frame isolation, a test-only application entrypoint registers its
capabilities, initializes `FliwrightBridge`, calls
`FliwrightTestBootstrap.awaitScenario()`, then calls `runApp`. The managed
runner applies and validates the scenario before releasing that barrier.
Attach-mode tests apply scenarios immediately before the test and must reject a
scenario that requires startup isolation.
