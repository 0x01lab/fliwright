---
name: fliwright-bridge-integration
description: Integrate, configure, or debug the Fliwright Dart bridge inside a Flutter app. Use for `FliwrightBridge.init`, `fliwright_bridge`, app capabilities, VM-service extensions, Riverpod bridge setup, storage reset handlers, router wiring, mock interception, or bridge capability diagnostics.
---

# Fliwright Bridge Integration

Use this skill for the Flutter-side contract that lets Fliwright control and
inspect a running app through the Dart VM Service. Keep generic bridge setup in
the app bootstrap and keep product-specific routes, providers, auth, and test
data in the application.

## Integration Workflow

1. Inspect the app entry point, debug bootstrap, router, and existing test
   configuration before editing.
2. Initialize `FliwrightBridge` in the debug/test execution path before the
   app starts. Do not expose test-only instrumentation in a release build.
3. Add only the extensions the test workflow needs: router navigation, mocks,
   Riverpod observation, app capabilities, or storage reset.
4. Rebuild and restart the Flutter debug app after Dart bridge changes.
   Re-running TypeScript alone cannot load new Dart service extensions.
5. Run `fliwright doctor --vm-url ...` or an MCP connection check to confirm
   the live app exposes the expected capabilities.

## Capability Boundaries

- `snap`, `action`, screenshot, and mock extensions support normal
  locator-based automation.
- App capabilities expose explicit test-only application contracts such as
  controlled sign-in or seeded state. Register them before bridge
  initialization and keep their inputs narrow.
- Use the Riverpod bridge or plugin for provider inspection and overrides.
  Do not use state overrides to bypass third-party captcha or security tokens.
- Storage reset requires an app-supplied handler. Treat unsupported reset as a
  reported capability gap, not a reason to erase arbitrary app storage.
- Raw VM extensions are an escape hatch for bridge work and legacy
  compatibility; prefer the public `Page`, `Locator`, mock, state, and app
  APIs in ordinary tests.

## Router And Mocks

- Inject the router when tests need `navigate`, `currentRoute`, route-stack
  reset, or deterministic return-to-home behavior.
- Configure mock interception at the app boundary. Keep endpoint-specific mock
  data in the target project's `.fliwright/mocks/` files and use
  `write-fliwright-mock-rules` for their schema.
- Prefer mock-backed deterministic tests to live-network tests. Explicitly
  decide whether unmatched traffic may pass through.

## Verification

- Run focused Dart tests and `dart format` for bridge changes.
- Run the target app, discover its VM Service URL, and check the actual bridge
  capabilities.
- Use `write-fliwright-tests` for TypeScript E2E coverage of the new contract.
- When a bridge capability is public or cross-package, add regression coverage
  on both its Dart registration and TypeScript caller where feasible.
