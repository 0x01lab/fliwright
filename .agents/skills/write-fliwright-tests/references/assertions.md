# 断言（Assertions）

`expect(locator)` 返回一个 `Assertion`，带有 **Playwright 风格的自动等待**：它会轮询 locator，直到条件成立或超时，因此你几乎从不需要在断言前手动 `sleep`。

```typescript
import { expect } from '@fliwright/vitest';          // Fliwright expect (auto-wait + healing)
import { expect as viExpect } from 'vitest';          // raw Vitest for non-locator checks
```

## 匹配器（Matchers）

每个匹配器都接受 `options?: { timeout?: number }`（默认 `5000` 毫秒）。

| 匹配器 | 何时通过 |
| --- | --- |
| `toBeVisible(options?)` | locator 解析到一个可命中测试（hit-testable）的控件 |
| `toHaveText(text, options?)` | 第一个匹配项的文本恰好等于该值 |
| `toContainText(text, options?)` | 第一个匹配项的文本包含该子串 |
| `toBeEnabled(options?)` | 第一个匹配项处于启用状态（`properties.enabled !== false`） |
| `toBeDisabled(options?)` | 第一个匹配项处于禁用状态（`toBeEnabled` 的否定） |

```typescript
await expect(page.getByText('Welcome')).toBeVisible();
await expect(page.getByKey('submit')).toBeEnabled({ timeout: 10_000 });
await expect(page.getByText('Saved')).toContainText('Saved');
await expect(page.getByText('Count: 1')).toHaveText('Count: 1');
```

## 否定：`.not`

```typescript
await expect(page.getByKey('passwordError')).not.toBeVisible();
await expect(page.getByText('Loading')).not.toBeVisible();
```

`.not` 返回一个新的否定 `Assertion`。它会关闭自愈（自愈只对正向断言生效）。

## 自动等待行为

`Assertion` 大约每 100 毫秒轮询一次 locator：

```typescript
// Polls until "Done" is visible, up to 5s — no sleep needed.
await page.getByKey('submit').click();
await expect(page.getByText('Done')).toBeVisible();
```

如果需要更长的窗口（动画慢、网络慢），传入 `timeout`：

```typescript
await expect(page.getByText('Synced')).toBeVisible({ timeout: 15_000 });
```

对于**不是**单一控件可见性/文本声明的布尔判断，请降级到 Vitest：

```typescript
viExpect(await page.getByText('Ready').count()).toBe(1);
viExpect(await page.getByText('Ready').isVisible()).toBe(true);
```

## 自愈（Self-healing）

当 fixture 装配了 `SelfHealingEngine`（默认 fixture 就这么做）时，正向的 `expect(...).toBeVisible()` 会参与自愈。失败时它会：

1. 在某个 `(testName, selector)` 首次通过时记录一张**成功快照**，作为基准；
2. 在之后的失败中，通过多维自愈策略（跨 text/type/semantics 的 n-gram 相似度）把当前快照与已存基准做比较；
3. 若找到一个有把握的替代选择器，就用自愈后的 locator 重新跑一次断言。

这让断言对小幅 UI 变更有韧性。自愈对否定断言、以及没有装配引擎的裸 driver 脚本是**关闭**的。某条测试最新的自愈建议也会出现在失败报告中（见 [troubleshooting.md](./troubleshooting.md)）。

## 该断言什么

通过 **UI** 来断言——也就是用户实际能看到的东西——而不是内部状态。

```typescript
// ✅ visible outcome
await page.getByKey('loginButton').click();
await expect(page.getByText('Welcome, Alice')).toBeVisible();

// ✅ state changed visibly
await page.getByText('Subscribe').click();
await expect(page.getByText('Subscribed')).toBeVisible();
await expect(page.getByText('Subscribe')).not.toBeVisible();
```

## 对 mock 做断言

通过 `driver.mock` 对被拦截的 HTTP 请求做断言（见 [mocks.md](./mocks.md)）：

```typescript
const calls = await driver.mock.getCalls('/api/register');
viExpect(calls.length).toBeGreaterThanOrEqual(1);
viExpect(calls.at(-1)!.method).toBe('POST');
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
// message: `${matcher} failed for "${selector}": expected ${expected}, got ${actual}`
```

通过 `fliwright run` 或 MCP 运行时，fixture 还会捕获：一张截图、控件树、最近的 VM 诊断、源码位置，以及任何自愈建议——这些都会写入本次运行的失败上下文文件。详见 [cli.md](./cli.md) 与 [mcp-workflow.md](./mcp-workflow.md)。
