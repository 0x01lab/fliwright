# 状态注入（State / Riverpod）

> 签名取自 `packages/fliwright-core/src/interfaces/StateAdapter.ts` 与 `Driver.ts`；与源码不一致处以源码为准。

很多测试失败是因为“前置状态太难造”：要登录、要把某个 provider 设成特定值、要等待一个异步状态。用 UI 点一遍又慢又脆。Fliwright 通过 `driver.state` 暴露一个 **StateAdapter**，直接读写/覆盖应用内的状态（当前对接 Riverpod），跳过 UI 直接进入测试场景。

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
| `override(key, value)` | 为测试**覆盖** provider（隔离用，推荐） |
| `watch(key, cb)` | 订阅变化，返回一个 `unsubscribe` 函数 |
| `listProviders()` | 列出全部可用 provider 及其元信息 |

`ProviderInfo` 字段：`name`、`key?`、`type?`、`value`、`readable?`、`overridable?`、`watching?`、`error?`。先 `listProviders()` 看哪些 provider 可读/可覆盖，再决定用 `read` 还是 `override`。

## 用法示例

**覆盖登录态，跳过登录直接进入首页**

```ts
test('已登录用户看到首页', async ({ page, driver }) => {
  await driver.state.override('authProvider', {
    token: 'test-token',
    user: { id: 'u1', name: 'alice' },
  });

  await page.navigate('/');
  await expect(page.getByText('欢迎，alice')).toBeVisible();
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

- **`override`**：本意是为测试“盖一层”，适合做隔离——理论上用例间互不污染。
- **`write`**：直接改值，更接近真实写入，但可能触发 provider 内部的副作用逻辑。

不确定时优先 `override`；需要触发真实副作用时再用 `write`。

## 与 mock / formHelper 的搭配

- 想验证“点击后正确发起了请求”，用 `driver.mock.route(...)` 拦截 + `driver.mock.getCalls(...)` 断言（见 [mocks.md](./mocks.md)）。
- 想快速把表单造满，用 `page.formHelper.fill(...)`（见 [forms.md](./forms.md)）。
- 想跳过登录/进入特定业务态，用本文件的 `driver.state.override(...)`。

三者经常组合：`override` 登录态 → `mock.route` 拦截提交接口 → `formHelper` 填表 → 断言可见结果。

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
