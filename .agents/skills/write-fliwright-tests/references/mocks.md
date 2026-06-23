# HTTP Mock

新版脚本优先使用 `mock` fixture（timeline-aware `MockRuntime`）；底层能力或旧文件再用
`driver.mock`（`MockManager`）。二者都通过运行中 app 内的 Dart `HttpOverrides` 拦截 app 的
HTTP 流量，因此 **Dio/HttpClient 的真实请求会被你的 mock 规则捕获并应答**。你既能在
UI 上断言，也能对 app 实际发出的请求做断言。

> Mock 需要桥接的 mock 扩展（`ext.fliwright.mock.*`）。当当前桥接暴露了
> Flutter mock store 时，`MockManager` 会把规则同步过去；否则回退到工具侧的
> 镜像（`ToolMockServer`）。无论哪种情况，下文 API 完全一致。

## 心智模型（The mental model）

```
App code  ──►  HttpClient  ──►  HttpOverrides proxy  ──►  MockManager rules
                   ▲                                          │
                   └────────────  mocked response ◄──────────┘
 getCalls('/api/x')  ──►  records every intercepted request (method, path, body, …)
```

## Timeline-aware `mock` fixture

```typescript
import { test, expect } from '@fliwright/vitest';
import { expect as viExpect } from 'vitest';

test('register flow', async ({ page, flow, mock }) => {
  await mock.rules('Use successful registration API', async () => {
    await mock.clearRoutes();
    await mock.clearCalls();
    await mock.route('/api/register', {
      method: 'POST',
      status: 200,
      body: { success: true, message: '注册成功' },
    });
  });

  await flow.step('Submit form', async () => {
    await page.getByText('提交').click();
  });

  await expect(page.getByText('注册成功'), 'Registration succeeded').toBeVisible();
  const calls = await mock.findCalls({ method: 'POST', path: '/api/register' });
  viExpect(calls.length).toBeGreaterThanOrEqual(1);
});
```

`mock` methods mirror `driver.mock` but create timeline nodes:

```typescript
mock.rules(title, body)
mock.loadRules(mockDir?)
mock.switchRule(endpoint, ruleName, method?)
mock.route(path, response & { method?, id? })
mock.routeFlutter(path, response & { method?, id? })
mock.removeRoute(path, method?)
mock.clearRoutes()
mock.clearCalls()
mock.setPassthrough(enabled)
mock.getCalls(path?)
mock.listRoutes()
mock.listRules()
mock.findCalls({ method?, path?, url?, headers?, body? })
```

## 注册路由：`route()`

```typescript
route(path: string, response: MockRouteResponse & { method?: string }): Promise<void>
```

`MockRouteResponse`：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `status` | `number` | HTTP 状态码 |
| `body` | `object \| string` | 响应体（object 会被 JSON 编码） |
| `headers` | `Record<string, string>`? | 响应头 |
| `delay` | `number`? | 延迟响应的毫秒数 |
| `method` | `string`? | 要匹配的 HTTP method（`'GET'`、`'POST'`、…） |

`route()` 会在工具侧服务器注册，**并**尝试同步到 Flutter store。如果
Flutter 扩展不可用，它会静默回退到镜像——这对读取/探测类流程是可接受的。

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

### `routeFlutter()` —— “必须在 app 内生效”

签名与 `route()` 相同，但**不会静默回退**。用于 UI 触发的请求——此时“mock 了”必须
意味着运行中的 app 真的能看到该规则。如果 Flutter store 拒绝该路由则抛错。

```typescript
await driver.mock.routeFlutter('/api/login', { method: 'POST', status: 200, body: { token: 't' } });
```

## 查询：`getCalls()` / `listRoutes()`

```typescript
getCalls(path?: string): Promise<MockCall[]>     // all calls, or filtered by path
listRoutes(): Promise<Array<{ id: string; method?: string; path: string }>>
```

`MockCall` 带 `{ method, path, body, headers, … }`。`body` 可能是 JSON 字符串（Dio 发的是
JSON）——断言前要先解析：

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

## 修改：`removeRoute()` / `clear()` / `clearCalls()` / `setPassthrough()`

```typescript
removeRoute(path: string, method?: string): Promise<void>
clear(): Promise<void>               // remove all routes
clearCalls(): Promise<void>          // reset the call log only
setPassthrough(enabled: boolean): Promise<void>
```

`setPassthrough(false)` 会让未匹配的路由返回 404（默认 passthrough 是开启的，即未匹配
流量会打到真实网络）。e2e 套件依赖此行为：在 `clear()` 且没有任何规则的情况下，
`/api/nonexistent` 会返回 `404`。

```typescript
// e2e — unmatched routes return 404
await driver.mock.clear();
await driver.mock.clearCalls();
const result = await driver.sendRequest('ext.fliwright.mock.testRequest',
  { url: 'http://test.local/api/nonexistent', method: 'GET' });
viExpect(result.status).toBe(404);
```

## 规则文件：`loadRules()` / `listRules()` / `switchRule()`

对于多端点、多响应场景的情况，把它们定义成 JSON，运行时再切换。

```typescript
loadRules(mockDir?: string): Promise<void>     // defaults to '.fliwright/mocks'
listRules(): Array<{ endpoint: string; method: string; rules: string[]; activeRule: string }>
switchRule(endpoint: string, ruleName: string, method?: string): Promise<void>
```

### JSON mock 文件格式（`.fliwright/mocks/api/*.json`）

每个文件描述一个端点，含多条具名响应规则：

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

当多条规则大部分字段相同时，优先使用 `baseRule`，让 `rules[]` 只保留差异。
`MockRuleStore` 会在加载时把它展开成普通 `MockRule`，所以 `loadRules()`、
`switchRule()`、VS Code Mock APIs 树和 Flutter route 同步看到的都是最终响应。

```json
{
  "version": 1,
  "name": "User Info API",
  "method": "POST",
  "endpoint": "/api/v1/user/info",
  "baseRule": {
    "status": 200,
    "delay": 0,
    "headers": { "Content-Type": "application/json" },
    "body": {
      "username": "qa-user",
      "email": "qa@example.com",
      "phone": "+85268****85",
      "otpConfigured": true
    }
  },
  "rules": [
    {
      "name": "security-real-data"
    },
    {
      "name": "security-mobile-add",
      "removeBodyFields": ["phone"],
      "body": {
        "otpConfigured": false
      }
    },
    {
      "name": "error",
      "status": 500,
      "removeBodyFields": ["username", "email", "phone", "otpConfigured"],
      "body": {
        "error": "service unavailable"
      }
    }
  ]
}
```

Override 语义：

| 字段 | 语义 |
| --- | --- |
| `baseRule.status` / `rules[].status` | `status` 可放在 base；单条 rule 可覆盖。最终每条 rule 必须有 `status`。 |
| `baseRule.delay` / `rules[].delay` | 延迟毫秒数；rule 覆盖 base。 |
| `baseRule.headers` / `rules[].headers` | 浅合并；同名 header 由 rule 覆盖。 |
| `baseRule.body` / `rules[].body` | 两者都是 object 时浅合并；数组、字符串、数字、布尔值、null 会整体替换 base body。 |
| `rules[].removeBodyFields` | 只用于 object body；在 body 合并后删除继承字段。适合“base 有 phone，但该场景不能返回 phone”的情况。 |
| `rules[].description` | 给人看的说明；展开应用到 mock route 时不会进入最终响应。 |

写压缩 mock 文件时要注意：只有确实应当被所有规则继承的字段才放入
`baseRule.body`。如果某些规则需要“字段不存在”而不是“字段为空”，使用
`removeBodyFields`；不要把值设成 `null`，除非真实 API 就会返回 `null`。

一个索引（`.fliwright/mocks/mock-index.json`）列出默认激活的规则。如果它
缺失，`loadRules()` 会扫描 `api/*.json`。之后可在用例中途切换场景：

```typescript
await driver.mock.loadRules();                                  // loads .fliwright/mocks
await driver.mock.switchRule('/v1/public/token', 'server-error');
// trigger the request in the UI, then assert the error UI
```

`loadRules()` 会立即应用每个端点当前的激活规则，因此测试脚本可以复用
项目里的 mock 文件，而不必在代码里重复响应体：

```typescript
await mock.clearRoutes();
await mock.clearCalls();
await mock.loadRules('.fliwright/mocks');
await mock.switchRule('/api/register', 'success', 'POST');
```

VS Code 扩展会扫描 `.fliwright/mocks/api/*.json`，让你选一条规则，然后通过
`driver.mock.route(endpoint, response)` 应用。

## 独立 mock 控制器（CLI）

把工具侧 mock 控制器作为独立进程启动（在 app 的桥接无法承载 store，或想让多个 app
共用同一套规则时很有用）：

```bash
fliwright mock:start --host 127.0.0.1 --port 0 --mock-dir .fliwright/mocks
# → prints a WebSocket URL
```

通过 `FLIWRIGHT_MOCK_CONTROLLER_URL`（由 vitest fixture 读取）把 app 指向它，或把
URL 传给 `driver.mock.configureFlutterController(url)`。见 [cli.md](./cli.md)。

## 完整 mock + 表单 + UI 模式

```typescript
import { test, expect } from '@fliwright/vitest';
import { expect as viExpect } from 'vitest';

test('register flow: mock API → fill form → submit → verify request', async ({ page, mock }) => {
  await mock.rules('Use registration mock rules', async () => {
    await mock.clearRoutes();
    await mock.clearCalls();
    await mock.loadRules('.fliwright/mocks');
    await mock.switchRule('/api/register', 'success', 'POST');
  });

  await page.formHelper.fill({ skipObscureFields: false });   // fill all fields
  await page.locator({ text: '提交' }).click();

  // UI shows success from the mocked response
  const success = await page.waitFor('text=注册成功', 5000);
  await expect(success, 'Registration success is visible').toBeVisible();

  // Mock server captured the real submission
  const calls = await mock.findCalls({ method: 'POST', path: '/api/register' });
  viExpect(calls.length).toBeGreaterThanOrEqual(1);
});
```

## 常见坑（Gotchas）

- **先清后设。** 上一个用例残留的路由会顺着共享 driver 串到当前用例。
  开始 app 可见的 mock 测试时，先 `await mock.clearRoutes(); await mock.clearCalls();`。
- **body 可能是字符串。** Dio 会把请求体 JSON 编码；断言字段前先 `JSON.parse`。
- **`route()` 是尽力而为；`routeFlutter()` 是严格语义。** 当某个 UI 动作
  必须观察到该规则时用 `routeFlutter()`，否则用例可能只对镜像通过、而 app 什么也看不到。
- **passthrough 默认开启。** 如果你期望未匹配的路由返回 404，在
  `clear()` 之后调用 `setPassthrough(false)`。
