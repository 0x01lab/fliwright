# Composable Test Scenarios

- **Date:** 2026-08-15
- **Status:** Implemented initial slice
- **Scope:** `@fliwright/core`, `@fliwright/vitest`, `fliwright_bridge`, and target-app test bootstraps

## Problem

Most product tests require an authenticated user. Driving a login page for every
test is slow, depends on credentials and CAPTCHA, and turns an authentication
failure into a blocker for unrelated coverage. Mocking the login endpoint does
not solve the problem when the app has client-side verification or an external
human-verification flow.

The framework has low-level building blocks for mock routes, storage resets,
Riverpod state overrides, and an application-owned `auth.seedLoggedIn`
capability. They are currently applied independently and late in the TDD cycle.
There is no reusable, named declaration that combines them into a verified test
baseline, and no startup protocol that can establish that baseline before the
first application frame.

## Goal

Introduce a composable **Test Scenario**: a named, declarative baseline that
combines authentication, mocks, storage, state adapters, application-owned
fixture setup, navigation, and readiness checks.

A test chooses a scenario such as `guest`, `member`, `admin`, or
`member-checkout`. It never performs a real login, solves a CAPTCHA, or embeds a
real token. A scenario that requests an authenticated user must either establish
and verify that state or fail test setup.

## Non-goals

- Replacing tests that specifically verify the real login or CAPTCHA workflow.
- Making arbitrary app state writable without an explicit test capability.
- Enabling the bridge or test capabilities in production builds.
- Supporting every HTTP client without its application-side interception
  integration.
- Introducing a second source of truth for active Flutter mock routes.

## Terms

- **Scenario:** A resolved, ordered test baseline.
- **Layer:** One typed contribution to a scenario, such as auth or mocks.
- **Environment:** A conventional name for a reusable scenario. It is not a
  distinct runtime abstraction.
- **Prepared scenario:** A scenario whose layers have been resolved, validated,
  and applied to one running app.

## Model

`ScenarioResolver` is the Core module that turns a named scenario and its
parents into a `PreparedScenario`. Callers use its small interface; it owns
inheritance traversal, resource-conflict detection, application order, and
readiness verification.

```ts
interface TestScenario {
  name: string;
  extends?: string[];
  startupIsolation?: 'required' | 'optional';
  layers: ScenarioLayer[];
  ready?: ScenarioReadyCheck[];
}

type ScenarioLayer =
  | {
      kind: 'mocks';
      profile?: string;
      directory?: string;
      denyUnmatchedRequests?: boolean;
    }
  | {
      kind: 'storage';
      seed?: Record<string, unknown>;
      categories?: Array<'storage' | 'secureStorage' | 'authTokens' | 'localDb'>;
    }
  | {
      kind: 'auth';
      state: 'guest' | 'authenticated';
      preset?: string;
      userId?: string;
      roles?: string[];
      metadata?: Record<string, unknown>;
    }
  | {
      kind: 'state';
      adapter: string;
      key: string;
      value: unknown;
    }
  | {
      kind: 'app';
      capability: string;
      method: string;
      input?: unknown;
    }
  | {
      kind: 'navigation';
      route: string;
    };

type ScenarioReadyCheck =
  | { kind: 'auth'; state: 'guest' | 'authenticated' }
  | { kind: 'route'; equals: string }
  | { kind: 'capability'; capability: string; method: string; input?: unknown };
```

The public configuration should be authored in the target project's typed
`fliwright.config.ts`. The resolver may later gain a JSON loader, but the first
version keeps arbitrary fixture input type-checked and avoids a second
configuration format.

Example:

```ts
export default defineConfig({
  scenarios: {
    base: {
      name: 'base',
      layers: [
        { kind: 'mocks', profile: 'happy-path', denyUnmatchedRequests: true },
        { kind: 'storage', seed: { onboardingSeen: true } },
      ],
    },
    guest: {
      name: 'guest',
      extends: ['base'],
      layers: [
        { kind: 'auth', state: 'guest' },
        { kind: 'navigation', route: '/login' },
      ],
      ready: [{ kind: 'auth', state: 'guest' }],
    },
    member: {
      name: 'member',
      extends: ['base'],
      startupIsolation: 'required',
      layers: [
        { kind: 'auth', state: 'authenticated', preset: 'standard-user' },
        { kind: 'navigation', route: '/home' },
      ],
      ready: [{ kind: 'auth', state: 'authenticated' }],
    },
    memberCheckout: {
      name: 'member-checkout',
      extends: ['member'],
      layers: [
        { kind: 'mocks', profile: 'checkout-with-items' },
        { kind: 'state', adapter: 'riverpod', key: 'cartProvider', value: { items: [{ sku: 'sku-1', quantity: 2 }] } },
        { kind: 'navigation', route: '/checkout' },
      ],
      ready: [{ kind: 'route', equals: '/checkout' }],
    },
  },
});
```

## Composition Rules

The resolver performs a depth-first expansion of `extends` in declaration
order, then appends the scenario's own layers. Circular references and missing
scenario names are configuration errors.

Layers are not deep-merged. Each layer writes named resources; duplicate writes
are rejected unless the later layer explicitly declares an override in the
future schema. This makes a scenario's outcome inspectable rather than
dependent on object-merge incidental behavior.

Resource identities are:

| Layer | Resource identity |
| --- | --- |
| `mocks` | HTTP method plus path |
| `storage` | storage category plus key |
| `auth` | singleton auth session |
| `state` | adapter plus state key |
| `app` | capability plus method |
| `navigation` | singleton route stack |

The initial supported apply order is fixed:

1. clear and load Flutter-side mock routes; set unmatched requests to fail;
2. reset and seed storage/local state;
3. establish or clear the application auth session;
4. apply state-adapter overrides;
5. invoke application fixture capabilities;
6. reset navigation to the scenario route;
7. run all readiness checks.

The order intentionally puts storage before auth, so a storage reset cannot
erase an already-seeded session. The application-owned auth layer owns all
implementation details such as token caches, Riverpod state, route guards, and
current-user data.

## Authentication Contract

Authentication is an application capability, not a mocked endpoint and not a
framework-owned token format. A target app registers the existing
`FliwrightAuthCapability` only in its debug/test bootstrap:

```dart
FliwrightAppInstance.registerCapability(
  FliwrightAuthCapability(
    getStatus: (_) => authRepository.testStatus(),
    seedLoggedIn: (input) => authRepository.seedTestSession(input as Map),
    clearSession: (_) => authRepository.clearTestSession(),
  ),
);
```

`seedTestSession` must update the exact sources used by the app in production:
in-memory authentication state, local or secure storage, current-user data, and
route-guard dependencies. Inputs identify a synthetic fixture (`preset`, role,
or user id); they must not contain production credentials or reusable access
tokens.

For `auth: authenticated`, absence of `auth.seedLoggedIn`, an invocation error,
or a postcondition where `auth.getStatus().isAuthenticated` is false is a hard
setup failure. It must never produce a green test with an `unsupported` reset
report.

## Startup And Attach Paths

### Managed Startup

Tests that require full isolation use a test-only bootstrap barrier:

```dart
await FliwrightBridge.init();
await FliwrightTestBootstrap.awaitScenario();
runApp(app);
```

The managed runner starts this target, connects to the VM Service, waits for the
bridge to report bootstrap readiness, applies the prepared scenario, validates
it, and releases the barrier. Therefore the app's first frame already has the
requested authentication state and mock rules. A full restart re-enters this
protocol before the next test runs.

`FliwrightTestBootstrap` is a bridge module with a narrow interface: report
ready, receive one prepared scenario, and release or fail startup. It does not
know business auth, storage, or mock schemas.

### Attach

For an already-running debug app, the runner applies the scenario immediately
before the test, then navigates and checks readiness. This path supports
interactive development but cannot guarantee that cold-start requests did not
already occur. A scenario can mark startup isolation as required; in that case
the attach path fails early with a clear diagnostic.

## Runner Interfaces

Vitest exposes a scenario-bound test factory:

```ts
const member = test.scenario('member');

member('shows order history', async ({ page }) => {
  // The scenario has already been verified.
});
```

CLI, MCP, and the persistent TDD runtime must select these same named
declarations when they gain scenario selection. They must not grow another
baseline schema; their current legacy reset options are not a substitute for a
`TestScenario`.

## Package Ownership

| Package | Responsibility |
| --- | --- |
| `@fliwright/core` | Scenario model, resolver, prepared-scenario report, strict application to Driver facades |
| `@fliwright/vitest` | Scenario-bound test factory and per-test lifecycle hook |
| `@fliwright/tdd` | Future managed-start orchestration and cycle re-preparation through Core scenarios |
| `@fliwright/cli` | Future config loading and `--scenario` selection through Core scenarios |
| `@fliwright/mcp` | Future typed scenario selection and prepared-scenario diagnostics |
| `fliwright_bridge` | Test bootstrap barrier and existing app capability transport |
| `fliwright_bridge_riverpod` | Optional `state` layer adapter only |
| target app | Test-only auth and domain fixture capability implementations |

## Failure Policy

- A missing required capability, failed readiness check, duplicate scenario
  resource, unknown scenario, or unavailable strict mock interceptor fails
  setup before test actions begin.
- The run artifact records the resolved layers, their application outcomes, and
  the failed prerequisite. Values classified as secrets remain redacted.
- A scenario never silently falls back from Flutter-side route application to a
  tool-side-only mock server.

## Verification

Unit tests cover resolver inheritance, ordering, duplicate-resource detection,
and failure reporting. Package integration tests cover Vitest per-test
selection and the bridge bootstrap protocol.

A real Flutter fixture app provides the test-only entrypoint and app-owned auth
capability needed for the critical flows. The bridge protocol is unit-tested;
end-to-end execution still requires a live Flutter VM Service.

1. `member` starts directly on an authenticated home screen without calling the
   login endpoint or displaying a login page.
2. an unmatched HTTP request fails in strict mock mode.
3. `guest` clears the session and permits a focused login-flow test.
4. `member-checkout` composes auth, a mock profile, state, and navigation.
5. a missing `auth.seedLoggedIn` capability prevents test execution with a
   setup error.

## Delivery Sequence

1. Add this scenario model and resolver tests in Core.
2. Wire the existing auth capability into strict Core scenario application.
3. Add scenario selection to Vitest.
4. Implement the bridge startup barrier and a target-app fixture capability.
5. Migrate CLI, MCP, and TDD to the Core scenario interface before adding
   further baseline features.
6. Regenerate feature documentation after the public interfaces stabilize.
