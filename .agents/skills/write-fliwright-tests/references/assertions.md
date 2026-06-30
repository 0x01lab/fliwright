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

请求不是 locator，不走 Fliwright locator `expect`。用 `mock.findCalls(...)` / `mock.getCalls(...)` 读取请求，再用 Vitest `expect` 校验：

```typescript
const calls = await mock.findCalls({ method: 'POST', path: '/api/register' });
viExpect(calls.length).toBeGreaterThanOrEqual(1);

const last = calls.at(-1)!;
const body = typeof last.body === 'string' ? JSON.parse(last.body) : last.body;
viExpect(body.phone).toMatch(/^1[3-9]\d{9}$/);
```

## 该断言什么

通过 **UI** 来断言，也就是用户实际能看到的东西，而不是内部状态。

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

通过 `fliwright run` 或 MCP 运行时，fixture 还会捕获截图、控件树、最近的 VM 诊断、源码位置和自愈建议，并写入本次运行的失败上下文文件。详见 [cli.md](./cli.md) 与 [mcp-workflow.md](./mcp-workflow.md)。
