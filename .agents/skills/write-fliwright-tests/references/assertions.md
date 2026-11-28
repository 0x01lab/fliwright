# 断言（Assertions）

Fliwright 公开推荐一套 locator 断言语法：`expect(locator, title?).to*`。它贴近 Playwright，内置自动等待、自愈、timeline assertion node、失败截图/快照和 agent-visible failure。

```typescript
import { test, expect } from '@fliwright/vitest';    // Fliwright locator expect
import { expect as viExpect } from 'vitest';          // raw Vitest for non-locator checks
```

## Locator `expect`

第二个参数 `title` 会写入 timeline；也可以在 matcher options 里传 `title`。

```typescript
test('saves profile', async ({ page, flow, mock }) => {
  await flow.step('Tap save', async () => {
    await page.getByText('Save').click();
  });

  await expect(page.getByText('Saved'), 'Saved banner is visible').toBeVisible();

  const calls = await mock.findCalls({ method: 'POST', path: '/api/profile' });
  viExpect(calls.length).toBeGreaterThanOrEqual(1);
});
```

每个 matcher 都接受 `options?: { timeout?: number; title?: string; includeScreenshot?: boolean; includeSnapshot?: boolean }`。

| 匹配器 | 何时通过 |
| --- | --- |
| `toBeVisible(options?)` | locator 解析到一个可命中测试（hit-testable）的控件 |
| `toHaveText(text, options?)` | 第一个匹配项的文本恰好等于该值 |
| `toContainText(text, options?)` | 第一个匹配项的文本包含该子串 |
| `toBeEnabled(options?)` | 第一个匹配项处于启用状态（`properties.enabled !== false`） |
| `toBeDisabled(options?)` | 第一个匹配项处于禁用状态 |
| `toBeChecked(options?)` | 第一个匹配项处于 checked / toggled / selected 状态 |

```typescript
await expect(page.getByText('Welcome'), 'Welcome is shown').toBeVisible();
await expect(page.getByKey('submit'), 'Submit is enabled').toBeEnabled({ timeout: 10_000 });
await expect(page.getByText('Saved'), 'Saved text is rendered').toContainText('Saved');
await expect(page.getByText('Count: 1')).toHaveText('Count: 1', { title: 'Counter incremented' });
await expect(page.getBySemantics({ identifier: 'terms.accept' }), 'Terms accepted').toBeChecked();
```

`toBeChecked()` 读取 `properties.checked`，并兼容 `properties.toggled` / `properties.selected`。这覆盖原生 `Checkbox` / `Switch` / `Radio`，也覆盖加了 Flutter `Semantics` 的自定义表单控件。

## 否定：`.not`

```typescript
await expect(page.getByKey('passwordError'), 'Password error is hidden').not.toBeVisible();
await expect(page.getByText('Loading'), 'Loading indicator disappears').not.toBeVisible();
await expect(page.getBySemantics({ identifier: 'terms.accept' }), 'Terms not accepted').not.toBeChecked();
```

`.not` 返回一个新的否定 `Assertion`。它会关闭自愈（自愈只对正向断言生效）。

## 自动等待行为

`Assertion` 大约每 100 毫秒轮询一次 locator：

```typescript
await page.getByKey('submit').click();
await expect(page.getByText('Done'), 'Submit completed').toBeVisible();
```

如果需要更长的窗口（动画慢、网络慢），传入 `timeout`：

```typescript
await expect(page.getByText('Synced'), 'Sync completed').toBeVisible({ timeout: 15_000 });
```

对于**不是**单一控件可见性/文本声明的布尔判断，请使用 Vitest：

```typescript
viExpect(await page.getByText('Ready').count()).toBe(1);
viExpect(await page.currentRoute()).toContain('/register');
```

## 自愈（Self-healing）

当 fixture 装配了 `SelfHealingEngine`（默认 fixture 就这么做）时，正向的 `expect(...).toBeVisible()` 会参与自愈。失败时它会：

1. 在某个 `(testName, selector)` 首次通过时记录一张成功快照作为基准。
2. 在之后的失败中，通过多维自愈策略把当前快照与基准比较。
3. 若找到一个有把握的替代选择器，就用自愈后的 locator 重新跑一次断言。

自愈对否定断言、以及没有装配引擎的裸 driver 脚本是关闭的。某条测试最新的自愈建议也会出现在失败报告中（见 [troubleshooting.md](./troubleshooting.md)）。

## 请求断言

用 `assert.request(title, request)` 检查 App 是否发出匹配请求。需要检查请求体或调用详情时，从 Flutter 调用记录读取请求，再用 Vitest `expect` 校验。

```typescript
const calls = await mock.findFlutterCalls({ method: 'POST', path: '/api/register' });
viExpect(calls.length).toBeGreaterThanOrEqual(1);

const last = calls.at(-1)!;
const body = typeof last.body === 'string' ? JSON.parse(last.body) : last.body;
viExpect(body.phone).toMatch(/^1[3-9]\d{9}$/);
```

验证“恰好一次”或“不发请求”时，先明确调用窗口：动作前清理记录或保存基线，执行完整操作，等待能表明该操作结束的 UI 状态，再检查窗口内的全部目标请求。中途 `applyRuleSet` 会清理记录，须先保存上一阶段证据。

`expect.poll(count).toBe(1)` 只证明某个时刻为 1；等待首个请求后立即断言也是如此。`page.settle()` 只等待帧稳定，`page.waitForNetworkIdle()` 只观察 bridge Mock 调用计数的静默窗口，都不能代替提交完成。响应带延迟时，请求可能已经记录、响应尚未完成。

完成状态之后可补充有界的调用静默检查，再读取总数；这只覆盖已定义操作和观察窗口，不证明未来永远没有请求。存在排队任务、重试或后台调度时，等待它们的明确完成信号；缺少信号时报告验证边界，不增加任意固定 sleep。固定 ID 的 Mock 可能让 UI 去重掩盖重复提交，因此 UI 数量和请求次数需分别验证。

## HTTP 响应断言

触发 App 操作后调用 `assert.response(title, { request, verify }, options?)`。从 `vitest` 导入 `expect` 用于响应数据，从 `@fliwright/vitest` 导入 locator `expect` 用于界面。下面的订单端点和字段名是示例，实际断言以 App 的接口契约为准。

```typescript
import { expect, test } from '@fliwright/vitest';
import { expect as viExpect } from 'vitest';

test('creates an order', async ({ page, driver, assert }) => {
  await driver.mock.clearFlutterCalls();
  await page.getByText('提交订单').click();

  await assert.response('订单接口返回创建成功', {
    request: { method: 'POST', path: '/api/orders' },
    verify: ({ status, body }) => {
      viExpect(status).toBe(201);
      viExpect(body).toHaveProperty('data.orderId');
      viExpect(body).toMatchObject({
        code: 0,
        data: { orderId: viExpect.any(String) },
      });
    },
  });

  await expect(page.getByText('下单成功'), '页面显示下单成功').toBeVisible();
});
```

`request` 用 method、path、URL、headers 或请求体定位调用。`verify` 检查响应状态码和响应体。用 `toHaveProperty` 检查字段是否存在，用 `toMatchObject` 检查指定字段的值或类型，用 `expect.arrayContaining` 检查数组包含的元素。检查非 2xx 响应时，在回调里写出预期状态码和业务字段。

断言等待最新一条匹配调用完成，默认等待 5 秒，可通过 `options.timeout` 和 `options.interval` 调整。清理 Flutter 调用历史或使用业务字段限定请求，可以避免同一端点的旧记录影响结果。未观察到匹配调用、等待响应超时或传输错误会让断言失败。`verify` 抛出的 matcher 错误和实际响应会写入失败时间线。异步回调需要 `await` 断言，使用抛错型 matcher 才能将其失败归入该时间线节点。

Dio 的 HTTP、HTTPS 和自定义 Adapter 请求由接入对应 Dio 实例的 Fliwright interceptor 观察，支持 Mock 和透传。普通 `HttpClient` 路径可检查命中 HTTP Mock 的响应。采集方式和排查入口见 [HTTP Mock](./mocks.md#app-侧网络接入)。

## 该断言什么

根据验收目标选择断言。接口断言检查返回的业务数据，UI 断言检查用户看到的结果。同一个用例可以同时验证两项。

```typescript
await page.getByKey('loginButton').click();
await expect(page.getByText('Welcome, Alice'), 'Signed-in welcome appears').toBeVisible();

await page.getByText('Subscribe').click();
await expect(page.getByText('Subscribed'), 'Subscription state changed visibly').toBeVisible();
await expect(page.getByText('Subscribe'), 'Old subscribe action is gone').not.toBeVisible();
```

## 失败上下文

抛出 `AssertionError` 时，它带有用于报告的结构化字段：

```typescript
class AssertionError extends Error {
  matcher: string;     // 'toBeVisible' | 'toHaveText' | ...
  expected: string;
  actual: string;
  selector: string;
}
```

通过 `fliwright run` 运行时，fixture 还会捕获截图、控件树、最近的 VM 诊断、源码位置和自愈建议，并写入本次运行的失败上下文文件。详见 [cli.md](./cli.md) 与 [agent-workflow.md](./agent-workflow.md)。
