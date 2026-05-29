# Slice 3: Mock Loop — HTTP Interception & State Injection

**Date**: 2026-05-29
**Status**: Approved
**Depends on**: Slice 0 (Extensible Architecture), Slice 1 (Minimal Loop), Slice 2 (Assertion Loop)
**Milestone**: MVP Delivery

---

## Goal

Declare HTTP mocks and state injection to run tests independent of backend. After Slice 3, a developer can intercept Flutter App HTTP requests with mock responses and inject Riverpod state to skip login flows — enabling fully isolated end-to-end tests.

---

## Delivery Approach: Vertical Slice Iteration

Four iterations, each delivering a demoable end-to-end capability:

| Iteration | Scope | User Gets |
|-----------|-------|-----------|
| 3-A | Dart Mock Server + HttpOverrides + TS Mock Manager + Route Sync | "Declare route → intercept request → return mock data" end-to-end |
| 3-B | State Injection TS API | "Override provider → skip login" end-to-end |
| 3-C | Request recording + getCalls API | "Verify mock was called N times with expected body" end-to-end |
| 3-D | Demo App + integration test | Full Mock + State scenario end-to-end |

---

## 1. Dart HTTP Mock Server

### 1.1 Architecture

Start a `dart:io` HttpServer inside `FliwrightBridge.init()`, default listening on `localhost:18080`.

### 1.2 Request Flow

1. HttpServer receives request from Flutter App
2. Match against registered route rules (method + path pattern)
3. Match found → return preset mock response (status, headers, body, delay)
4. No match → return 404 or passthrough to real server (configurable)

### 1.3 Route Rule Format

```json
{
  "id": "route_001",
  "method": "POST",
  "path": "/api/login",
  "response": {
    "status": 200,
    "headers": { "Content-Type": "application/json" },
    "body": { "token": "mock-jwt-xxx", "user": { "name": "Alice" } },
    "delay": 0
  }
}
```

### 1.4 VM Service Extensions

| Extension | Purpose |
|-----------|---------|
| `ext.fliwright.mock.addRoute` | Add a route rule |
| `ext.fliwright.mock.removeRoute` | Remove a route by pattern or id |
| `ext.fliwright.mock.clearRoutes` | Clear all routes |
| `ext.fliwright.mock.listRoutes` | List current routes |
| `ext.fliwright.mock.setPassthrough` | Set unmatched request behavior (passthrough or 404) |
| `ext.fliwright.mock.getCalls` | Get recorded request history |
| `ext.fliwright.mock.clearCalls` | Clear request history |

### 1.5 Route Matching

- Exact path match: `/api/login`
- Wildcard: `/api/*` matches any sub-path
- Method filtering: optional, defaults to matching all methods
- Path pattern is matched against the original URL (before redirect)

### 1.6 Delay Simulation

When `delay > 0`, the server waits the specified milliseconds before responding. Useful for testing loading states and timeouts.

**Estimate**: 2 days

---

## 2. HttpClient Redirection

### 2.1 Mechanism

Use Dart's `HttpOverrides.global` to redirect all HTTP requests from the Flutter App to the local Mock Server.

### 2.2 Implementation

```dart
class FliwrightHttpOverrides extends HttpOverrides {
  final String mockHost;
  final int mockPort;

  @override
  HttpClient createHttpClient(SecurityContext? context) {
    final client = super.createHttpClient(context);
    return _MockHttpClient(client, mockHost, mockPort);
  }
}
```

### 2.3 Request Rewriting

When a request targets `https://api.example.com/api/login`:
1. `_MockHttpClient` replaces host/port with `localhost:18080`
2. Preserves original URL in `X-Original-Url` header
3. Mock Server uses `X-Original-Url` for route matching

### 2.4 Dio Compatibility

Dio on non-web platforms uses `dart:io` `HttpClient` under the hood, so `HttpOverrides.global` covers both `HttpClient` and Dio without additional interceptors.

### 2.5 Host Filtering (Optional)

Support a whitelist/blacklist of hosts to mock. By default, all HTTP requests are intercepted. Configurable via:
- `ext.fliwright.mock.setHostFilter({ include: ['api.example.com'] })`
- `ext.fliwright.mock.setHostFilter({ exclude: ['analytics.google.com'] })`

**Estimate**: 2 days

---

## 3. TypeScript Mock Manager & Route Sync

### 3.1 API Design

```typescript
const mock = driver.mock;

// Basic route declaration
await mock.route('/api/login', {
  status: 200,
  body: { token: 'mock-jwt', user: { name: 'Alice' } }
});

// With method restriction
await mock.route('/api/users', {
  method: 'GET',
  body: [{ id: 1, name: 'Bob' }]
});

// With delay simulation
await mock.route('/api/slow', {
  body: { ok: true },
  delay: 2000
});

// Wildcard
await mock.route('/api/*', { status: 200, body: {} });

// Remove a route
await mock.removeRoute('/api/login');

// Clear all routes
await mock.clear();

// Set passthrough behavior
await mock.setPassthrough(true);   // passthrough to real server
await mock.setPassthrough(false);  // return 404 (default)

// Query request history
const calls = await mock.getCalls('/api/login');
// [{ method: 'POST', headers: {...}, body: {...}, timestamp: '...' }]
```

### 3.2 Route Sync Mechanism

1. TS `mock.route()` sends route rule to Dart via `ext.fliwright.mock.addRoute`
2. Dart registers rule in HttpServer route table
3. `await` confirms successful registration
4. `mock.removeRoute()` / `mock.clear()` sync the same way

### 3.3 Class Structure

```
MockManager
  ├── _driver: FliwrightDriver
  ├── route(pattern, response)         // Register route
  ├── removeRoute(pattern)             // Remove route
  ├── clear()                          // Clear all routes
  ├── setPassthrough(enabled)          // Set default unmatched behavior
  ├── getCalls(pattern?)               // Get request records
  └── _syncToDart(method, params)      // Internal: VM Service call
```

### 3.4 Request Recording

- Dart Mock Server records each handled request as a `MockCall` (method, path, headers, body, timestamp)
- TS retrieves via `getCalls()` for mock-related assertions
- Useful for verifying "login API was called exactly once with correct credentials"

**Estimate**: 3 days (Mock Manager 2d + getCalls 1d)

---

## 4. State Injection TS API

### 4.1 Approach

Slice 0 already implements `ext.fliwright.riverpod.*` and `@fliwright/plugin-riverpod`. Slice 3 adds a convenient `driver.state` entry point — zero new Dart code.

### 4.2 API Design

```typescript
const state = driver.state;

// List all providers
const providers = await state.listProviders();

// Read current value
const user = await state.read('userProvider');

// Override value (skip login)
await state.override('userProvider', { name: 'Alice', role: 'admin' });

// Watch state changes
const unsub = await state.watch('cartProvider', (oldVal, newVal) => {
  console.log('Cart changed:', oldVal, '→', newVal);
});
unsub(); // stop watching
```

### 4.3 Driver Extension

```typescript
class FliwrightDriver {
  get page(): Page;      // existing
  get mock(): MockManager;   // new
  get state(): StateAdapter; // new — convenience alias for registered adapter
}
```

`driver.state` returns the registered RiverpodStateAdapter via `PluginRegistry.resolve()`. Future Bloc/Provider support just requires registering additional adapters.

**Estimate**: 1 day

---

## 5. Integration Test Demo

### 5.1 Demo Flutter App

A simple app using Riverpod + Dio:
- Login page: username + password fields, login button
- Home page: welcome message from API response or state

### 5.2 Test Scenarios

```typescript
import { test, expect } from '@fliwright/vitest';

test('mock API and inject auth state', async ({ driver }) => {
  const mock = driver.mock;
  const state = driver.state;

  // Scenario 1: HTTP Mock — intercept login API
  await mock.route('/api/login', {
    status: 200,
    body: { token: 'mock-jwt', user: { name: 'Alice' } }
  });

  await driver.page.locator({ text: '用户名' }).type('alice@test.com');
  await driver.page.locator({ text: '密码' }).type('secret');
  await driver.page.locator({ text: '登录' }).click();
  await expect(driver.page.locator({ text: '欢迎, Alice' })).toBeVisible();

  // Verify mock was called
  const calls = await mock.getCalls('/api/login');
  expect(calls.length).toBe(1);

  // Scenario 2: State Injection — skip login entirely
  await state.override('userProvider', { name: 'Bob', role: 'admin' });
  await driver.page.reload();
  await expect(driver.page.locator({ text: '欢迎, Bob' })).toBeVisible();
});
```

**Estimate**: 2 days

---

## 6. Estimates Summary

| Task | Description | Days | Iteration |
|------|-------------|------|-----------|
| 3.1 | Dart: HTTP Mock Server + route handling | 2d | 3-A |
| 3.2 | Dart: HttpOverrides + request redirection | 2d | 3-A |
| 3.3 | TS: Mock Manager + Route Sync | 2d | 3-A |
| 3.4 | TS: State Injection convenience API | 1d | 3-B |
| 3.5 | TS: Request recording + getCalls | 1d | 3-C |
| 3.6 | Demo App + integration test | 2d | 3-D |
| **Total** | | **10d** | |

---

## 7. Dependencies

- Slice 0: PluginRegistry, Protocol, MockAdapter/StateAdapter interfaces, RiverpodExtension
- Slice 1: FliwrightDriver, VM Service communication
- Slice 2: Locator, click/type, expect assertion engine

---

## 8. Out of Scope

- WebSocket mock support (future addition)
- Bloc / Provider state management (Riverpod only)
- Native hardware layer mock (future slice)
- Mock rule persistence (dynamic per test run)
- Host filtering (optional, can add later)
