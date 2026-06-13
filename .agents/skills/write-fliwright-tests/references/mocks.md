# HTTP Mocks

`driver.mock` (a `MockManager`) intercepts the app's HTTP traffic via Dart `HttpOverrides` inside the
running app, so **real Dio/HttpClient requests are captured and answered by your mock rules**. You
assert on the UI *and* on what the app actually sent.

> Mocks require the bridge mock extensions (`ext.fliwright.mock.*`). When the current bridge exposes
> the Flutter mock store, `MockManager` syncs rules there; otherwise it falls back to a tool-side
> mirror (`ToolMockServer`). Either way the API below is identical.

## The mental model

```
App code  ──►  HttpClient  ──►  HttpOverrides proxy  ──►  MockManager rules
                   ▲                                          │
                   └────────────  mocked response ◄──────────┘
 getCalls('/api/x')  ──►  records every intercepted request (method, path, body, …)
```

## Registering a route: `route()`

```typescript
route(path: string, response: MockRouteResponse & { method?: string }): Promise<void>
```

`MockRouteResponse`:

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | `number` | HTTP status code |
| `body` | `object \| string` | response body (object is JSON-encoded) |
| `headers` | `Record<string, string>`? | response headers |
| `delay` | `number`? | ms to delay the response |
| `method` | `string`? | HTTP method to match (`'GET'`, `'POST'`, …) |

`route()` registers in the tool-side server **and** tries to sync to the Flutter store. If the
Flutter extension is unavailable it silently falls back to the mirror — acceptable for read/probe
flows.

```typescript
// e2e
await driver.mock.clear();
await driver.mock.clearCalls();
await driver.mock.route('/api/register', {
  method: 'POST',
  status: 200,
  body: { success: true, message: '注册成功', userId: 42 },
});
```

### `routeFlutter()` — "must be live in the app"

Same signature as `route()`, but **does not silently fall back**. Use it for UI-triggered requests
where "mocked" must mean the running app can actually see the rule. Throws if the Flutter store
rejects the route.

```typescript
await driver.mock.routeFlutter('/api/login', { method: 'POST', status: 200, body: { token: 't' } });
```

## Inspecting: `getCalls()` / `listRoutes()`

```typescript
getCalls(path?: string): Promise<MockCall[]>     // all calls, or filtered by path
listRoutes(): Promise<Array<{ id: string; method?: string; path: string }>>
```

`MockCall` carries `{ method, path, body, headers, … }`. `body` may be a JSON string (Dio sends JSON)
— parse it before asserting:

```typescript
// e2e — assert the app POSTed the right form data
const calls = await driver.mock.getCalls('/api/register');
viExpect(calls.length).toBeGreaterThanOrEqual(1);

const last = calls[calls.length - 1];
viExpect(last.method).toBe('POST');
viExpect(last.path).toBe('/api/register');

const body = typeof last.body === 'string' ? JSON.parse(last.body) : last.body;
viExpect(body.phone).toMatch(/^1[3-9]\d{9}$/);
viExpect(body.email).toContain('@');
```

## Mutating: `removeRoute()` / `clear()` / `clearCalls()` / `setPassthrough()`

```typescript
removeRoute(path: string, method?: string): Promise<void>
clear(): Promise<void>               // remove all routes
clearCalls(): Promise<void>          // reset the call log only
setPassthrough(enabled: boolean): Promise<void>
```

`setPassthrough(false)` makes unmatched routes return 404 (default is passthrough-on, which lets
unmatched traffic hit the real network). The e2e suite relies on this: with `clear()` and no rule,
`/api/nonexistent` returns `404`.

```typescript
// e2e — unmatched routes return 404
await driver.mock.clear();
await driver.mock.clearCalls();
const result = await driver.sendRequest('ext.fliwright.mock.testRequest',
  { url: 'http://test.local/api/nonexistent', method: 'GET' });
viExpect(result.status).toBe(404);
```

## Rule files: `loadRules()` / `listRules()` / `switchRule()`

For many endpoints with multiple response scenarios, define them as JSON and switch at runtime.

```typescript
loadRules(mockDir?: string): Promise<void>     // defaults to '.fliwright/mocks'
listRules(): Array<{ endpoint: string; method: string; rules: string[]; activeRule: string }>
switchRule(endpoint: string, ruleName: string, method?: string): Promise<void>
```

### JSON mock file format (`.fliwright/mocks/api/*.json`)

Each file describes one endpoint with multiple named response rules:

```json
{
  "version": 1,
  "name": "Get Token List",
  "method": "GET",
  "endpoint": "/v1/public/token",
  "rules": [
    {
      "name": "success",
      "status": 200,
      "delay": 0,
      "headers": { "Content-Type": "application/json" },
      "body": { "success": true, "data": { "rows": [] } }
    },
    {
      "name": "empty",
      "status": 200,
      "body": { "success": true, "data": { "rows": [] } }
    },
    {
      "name": "server-error",
      "status": 500,
      "body": { "error": "服务器内部错误" }
    }
  ]
}
```

An index (`.fliwright/mocks/mock-index.json`) lists which rules are active by default. If it's
missing, `loadRules()` scans `api/*.json`. Then switch scenarios mid-test:

```typescript
await driver.mock.loadRules();                                  // loads .fliwright/mocks
await driver.mock.switchRule('/v1/public/token', 'server-error');
// trigger the request in the UI, then assert the error UI
```

The VS Code extension scans `.fliwright/mocks/api/*.json`, lets you pick a rule, and applies it via
`driver.mock.route(endpoint, response)`.

## Standalone mock controller (CLI)

Start the tool-side mock controller as its own process (useful when the app's bridge can't host the
store, or for running multiple apps against shared rules):

```bash
fliwright mock:start --host 127.0.0.1 --port 0 --mock-dir .fliwright/mocks
# → prints a WebSocket URL
```

Point the app at it via `FLIWRIGHT_MOCK_CONTROLLER_URL` (read by the vitest fixture) or by passing
the URL to `driver.mock.configureFlutterController(url)`. See [cli.md](./cli.md).

## Complete mock + form + UI pattern

```typescript
test('register flow: mock API → fill form → submit → assert request', async ({ page, driver }) => {
  await driver.mock.clear();
  await driver.mock.clearCalls();
  await driver.mock.route('/api/register', {
    method: 'POST', status: 200,
    body: { success: true, message: '注册成功', userId: 42 },
  });

  await page.formHelper.fill({ skipObscureFields: false });   // fill all fields
  await page.locator({ text: '提交' }).click();

  // UI shows success from the mocked response
  await expect(page.waitFor('text=注册成功', 5000)).toBeVisible();

  // Mock server captured the real submission
  const calls = await driver.mock.getCalls('/api/register');
  viExpect(calls.length).toBeGreaterThanOrEqual(1);
});
```

## Gotchas

- **Clear before you set.** Leftover routes from a previous test bleed across the shared driver.
  Start each mock test with `await driver.mock.clear(); await driver.mock.clearCalls();`.
- **Body may be a string.** Dio JSON-encodes request bodies; `JSON.parse` before asserting fields.
- **`route()` is best-effort; `routeFlutter()` is strict.** Use `routeFlutter()` when a UI action
  must observe the rule, or the test can pass against the mirror while the app sees nothing.
- **Passthrough default is on.** If you expect 404s for unmatched routes, call
  `setPassthrough(false)` after `clear()`.
