# 状态注入（State / Riverpod）

> 签名取自 `packages/fliwright-core/src/interfaces/StateAdapter.ts` 与 `Driver.ts`；与源码不一致处以源码为准。

Fliwright 通过 `driver.state` 暴露 **StateAdapter**，用于读取、订阅或修改普通业务 provider。可复用的前置环境声明为 [命名组合场景](./scenarios.md)，业务 provider 使用可选的 `kind: 'state'` layer。

认证状态由 app-owned `auth.seedLoggedIn` 和 `auth.getStatus` 负责；不要覆盖 auth provider、真实登录或绕过 CAPTCHA 来准备已登录业务测试。

## 前置条件

- 应用必须接入 **`fliwright_bridge_riverpod`** 桥接扩展并初始化（类似 `FliwrightBridge.init()`，详见 [getting-started.md](./getting-started.md)）。
- `driver.state` 实际取的是 `registry.getStateAdapter('riverpod')`。没有该扩展时调用会报找不到适配器。
- 这类操作只做“快速进入场景 + 校验结果”，**不应**用它绕过本该由 UI 验证的关键路径。

## `driver.state` API（StateAdapter）

```ts
interface StateAdapter {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  watch(key: string, callback: (oldValue: unknown, newValue: unknown) => void): Promise<() => void>;
  listProviders(): Promise<ProviderInfo[]>;
  override(key: string, value: unknown): Promise<void>;
}
```

| 方法 | 用途 |
| --- | --- |
| `read(key)` | 读某个 provider 的当前值 |
| `write(key, value)` | 直接写入值 |
| `override(key, value)` | 覆盖支持该操作的业务 provider；不用于认证，且不保证自动恢复 |
| `watch(key, cb)` | 订阅变化，返回一个 `unsubscribe` 函数 |
| `listProviders()` | 列出全部可用 provider 及其元信息 |

`ProviderInfo` 字段：`name`、`key?`、`type?`、`value`、`readable?`、`overridable?`、`watching?`、`error?`。先 `listProviders()` 看哪些 provider 可读/可覆盖，再决定用 `read` 还是 `override`。

## 用法示例

**读取普通业务状态，断言可见结果**

```ts
import { test, expect } from '@fliwright/vitest';
import { expect as viExpect } from 'vitest';

test('购物车状态与徽标一致', async ({ page, driver }) => {
  await page.getByKey('addToCart').click();
  await expect(page.getByKey('cartBadge')).toHaveText('1');
  viExpect(await driver.state.read('cartItemCountProvider')).toBe(1);
});
```

**读状态做断言（UI 没直接展示的值）**

```ts
const counter = await driver.state.read('counterProvider');
viExpect(counter).toBe(5);
```

**订阅变化，验证副作用**

```ts
const seen: unknown[] = [];
const unsubscribe = await driver.state.watch('cartProvider', (oldV, newV) => {
  seen.push(newV);
});

await page.getByKey('addToCart').click();
// ... 等待/断言 seen 里出现了预期的新值 ...

unsubscribe();   // 用完一定要取消订阅，避免泄漏
```

## 选择 `override` 还是 `write`

- **`override`**：使用适配器支持的测试覆盖语义；是否能恢复及如何恢复取决于 app/适配器，不能假定用例间自动隔离。
- **`write`**：直接改值，更接近真实写入，但可能触发 provider 内部的副作用逻辑。

先检查目标 provider 的契约。可复用的业务状态准备放进场景；直接修改时显式安排恢复，避免污染后续用例。

## 与 mock / formHelper 的搭配

- 想验证“点击后正确发起了请求”，用 `driver.mock.route(...)` 拦截 + `driver.mock.getCalls(...)` 断言（见 [mocks.md](./mocks.md)）。
- 想快速把表单造满，用 `page.formHelper.fill(...)`（见 [forms.md](./forms.md)）。
- 想进入已登录业务态，使用 [场景的 auth layer](./scenarios.md)，由 app 创建并校验会话。

常见组合：场景准备 auth/mock/业务状态 → `formHelper` 填表 → 断言 UI 与请求结果。

## 排错

| 症状 | 原因 / 修复 |
| --- | --- |
| 调用 `driver.state.*` 报“找不到 state adapter” | 应用没接入 `fliwright_bridge_riverpod` 或未初始化；接入并重启应用。 |
| `override` 后 UI 没变化 | provider 名字写错；先 `listProviders()` 核对 `name`/`overridable`。 |
| `watch` 回调不触发 | 该 provider 不是可观察的，或 UI 改的是另一个 key。 |

## 相关文档

- 桥接初始化 → [getting-started.md](./getting-started.md)
- 手动驱动与插件注册 → [driver-lifecycle.md](./driver-lifecycle.md)
- mock 接口 → [mocks.md](./mocks.md)
