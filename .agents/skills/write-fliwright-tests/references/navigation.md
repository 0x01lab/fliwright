# 导航与等待（Navigation & Waiting）

当应用把它的 router 暴露给桥接时，Fliwright 可以驱动路由导航；它还提供了一系列等待原语，让测试摆脱固定的 `sleep()` 调用。

## 应用侧准备

路由导航要求应用把一个 router（例如 GoRouter）注入到桥接：

```dart
await FliwrightBridge.init(router: myGoRouter);   // enables ext.fliwright.navigate / currentRoute / goBack
```

没有 router 时，`page.navigate()` 会抛出桥接侧错误。控件级的导航（点击一个 push 新路由的按钮）则始终可用，与是否有 router 无关。

## `navigate(path)`

```typescript
navigate(path: string, options?: { extra?: Record<string, unknown> }): Promise<void>
```

push 一条路由。`extra` 会作为附加数据转发给 router。

```typescript
await page.navigate('/login');
await page.navigate('/users/42', { extra: { referrer: 'search' } });
```

## `currentRoute()`

```typescript
currentRoute(): Promise<string>   // current route path, or '' if unknown
```

```typescript
const route = await page.currentRoute();
viExpect(route).toContain('login');
```

## `goBack()`

```typescript
goBack(): Promise<void>   // pop the current route
```

```typescript
await page.navigate('/register');
// …
await page.goBack();
```

## 等待原语

### `waitFor(selector, timeout)`

轮询直到某个选择器解析到至少一个控件。

```typescript
waitFor(selector: SelectorInput, timeoutMs = 5000): Promise<Locator>
```

```typescript
const success = await page.waitFor('text=注册成功', 5000);
viExpect(await success.isVisible()).toBe(true);
```

超时会抛错。它接受与选择器相同的字符串格式（`text=`、`key=`、…）。

### `waitForNew(selector, options?)`

等待一个**新**的、匹配该选择器且在调用开始时**尚不存在**的元素。这在导航/点击替换了整个页面之后尤为关键——它能避免误匹配到转场动画期间仍留在屏幕上的陈旧控件。

```typescript
waitForNew(selector: SelectorInput, options?: { timeout?: number }): Promise<Locator>
```

```typescript
await page.getByKey('openDetails').click();
const details = await page.waitForNew('text=Details', { timeout: 5000 });
await expect(details).toBeVisible();
```

它会在调用时把当前匹配到的 ID 集合做快照，然后轮询查找 ID 不在该集合内的匹配项。

### `settle(options?)`

等待 Flutter 的渲染管线安定下来——即连续 N 帧都没有待调度的工作。适用于点击触发了路由转场、随后要查询新页面的场景。

```typescript
settle(options?: { timeout?: number }): Promise<void>   // default timeout 2000 ms
```

```typescript
await page.getByKey('submit').click();
await page.settle();                 // let the transition finish
await expect(page.getByText('Welcome')).toBeVisible();
```

`Locator.click({ waitForAnimations: true })` 会自动执行一次 settle——在点击之后优先用它，而不是手动调用 `settle()`。

### `waitForNetworkIdle(options?)`

等到应用在一个静默窗口内没有任何网络活动。适用于某次操作触发了后台拉取之后。

```typescript
waitForNetworkIdle(options?: { quietMs?: number; timeout?: number }): Promise<void>
```

```typescript
await page.getByText('Refresh').click();
await page.waitForNetworkIdle({ quietMs: 300, timeout: 8000 });
```

### `dismissModal()`

通过 action 扩展关闭一个模态对话框/底部弹层。

```typescript
dismissModal(): Promise<void>
```

## 模式：导航、等待、断言

```typescript
test('navigates between routes', async ({ page }) => {
  await page.navigate('/register');
  await page.waitFor('text=请输入手机号', 5000);          // wait for page to render

  await page.navigate('/profile/edit');
  await page.waitFor('text=输入昵称', 5000);

  await page.goBack();
});
```

## 模式：按测试隔离导航

在每个测试之前重置到一条已知路由，这样用例之间就不会相互依赖顺序：

```typescript
import { test, beforeEach } from '@fliwright/vitest';

beforeEach(async ({ page }) => {
  await page.navigate('/');
});
```

## 什么时候用什么

| 场景 | 用什么 |
| --- | --- |
| 点击触发了页面切换之后 | `click({ waitForAnimations: true })` 或 `settle()` |
| 等待某个具体控件出现 | `waitFor(selector)` 或自动等待的 `expect(...).toBeVisible()` |
| 等待一个**替换**了上一页同类型控件的控件 | `waitForNew(selector)` |
| 等待后台拉取完成 | `waitForNetworkIdle()` |
| 读取当前路由 | `currentRoute()` |

请避免使用 `setTimeout`/`sleep`。唯一合理的例外是在 `clickAt` 这类遗留流程内部——那里没有任何控件事件可用作就绪信号（见 `e2e/exio-app-e2e.test.ts`）。
