---
module: "MockManager"
package: "@fliwright/core"
source: "src/MockManager.ts"
tests: "tests/MockManager.test.ts"
generated: "2026-06-02"
---

# MockManager

> Register HTTP mock routes, switch between predefined rule sets, and inspect calls captured by the bridge's mock server.

## Overview

`MockManager` is the TypeScript side of the bridge's `MockServerExtension`. It exposes two layers: low-level `route / removeRoute / clear` for ad-hoc mocking, and `loadRules / listRules / switchRule` for switching between rules loaded from `.fliwright/mocks/*.json`. Calls are forwarded as JSON-RPC to the running Flutter app, which intercepts HTTP requests via `dio` interceptors and `HttpOverrides`.

## Constructor

```typescript
constructor(sendRequest: SendRequest)
```

## Public Methods

### `route(path, response): Promise<void>`

Register a single mock route.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string | URL path (e.g. `/v1/login`) |
| `response.status` | number | HTTP status |
| `response.headers` | object | Response headers |
| `response.body` | unknown | Body (will be JSON-serialized) |
| `response.delay` | number | Optional delay in ms |
| `response.method` | string | HTTP method filter |

---

### `addRoute(pattern, response): Promise<void>` — alias of `route`.

### `removeRoute(path): Promise<void>` — remove a single route.

### `clear(): Promise<void>` — remove all routes.

### `setPassthrough(enabled): Promise<void>` — when `true`, unmatched requests go to the real network.

### `getCalls(path?): Promise<MockCall[]>` — return captured calls.

### `listRoutes(): Promise<{id, method?, path}[]>` — currently registered routes.

### `clearCalls(): Promise<void>` — clear the captured-call log.

### `loadRules(mockDir?): Promise<void>`

Loads `.fliwright/mocks/<mockDir>/mock-index.json` and every endpoint config referenced therein, then applies each endpoint's active rule as a route via the bridge. Silently skips if the index file is missing.

### `listRules(): { endpoint, method, rules[], activeRule }[]`

Returns a summary of loaded endpoints and their rules.

### `switchRule(endpoint, ruleName): Promise<void>`

Switch the active rule for an endpoint, then re-apply it to the bridge. Throws if endpoint or rule isn't found.

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `_ruleStore` | `MockRuleStore` | (Internal) loaded rules; shared with MCP `fliwright_mock_*` tools |

## Example

```typescript
await driver.mock.route('/v1/login', { status: 200, body: { token: 'abc' } });
await driver.mock.loadRules();  // loads .fliwright/mocks/mock-index.json
await driver.mock.switchRule('/v1/login', 'server_error');
const calls = await driver.mock.getCalls('/v1/login');
```

## Related

- **Depends on:** [MockRuleStore](./MockRuleStore.md)
- **Bridge counterpart:** `packages/fliwright-bridge/lib/src/extensions/mock_server.dart`
- **Source:** `packages/fliwright-core/src/MockManager.ts`
