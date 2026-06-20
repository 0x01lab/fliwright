# 排错与常见修复

按“症状 → 原因 → 修复”组织。拿不准时，先跑 `fliwright doctor --vm-url …`。

## 连接 / VM URL

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| `No VM Service URL provided` | 既没设 `FLIWRIGHT_VM_URL`，也没设 `FLIWRIGHT_VM_SERVICE_URL` | export 该 URL，或 `createFliwrightTest({ vmServiceUrl })` |
| 裸 driver 脚本报连接错误 | `flutter run` 打印的是 **HTTP** URL，而 `connect()` 需要 WS | 转换：`url.replace('http://','ws://')` 再追加 `/ws`（fixture 会自动帮你做） |
| （CLI）`Could not find a running Flutter VM Service` | 没在跑应用、没传 `--vm-url`、自动发现也没找到 | 先启动应用（`flutter run`）再重跑；或传 `--vm-url` |
| 套件静默什么都没做 | 测试被包在 `describe.skipIf(!vmUrl)` / `test.skipIf(!vmUrl)` 里 | export VM URL 让这个守卫通过 |

## 桥接就绪（最常见的一类失败）

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| `Unknown method "ext.fliwright.snap"` | 应用跑的是**旧版**桥接 | 升级 `fliwright_bridge`，在 `kDebugMode` 下调用 `FliwrightBridge.init()`，重新构建/重启，确认 `ext.fliwright.snap` 可用 |
| `Unknown method "ext.fliwright.extractForm"` | 旧版桥接缺表单抽取能力 | 升级；过渡期回退到裸 driver 的 legacy 路径（标注清楚） |
| `snapshot()`/`findRef()`/`fliwright_snap` 失败 | 同样的旧版桥接问题 | 在使用 snap/ref/observe/actionability 特性之前先升级 |
| mock 规则对应用不生效 | `route()` 静默回退到了工具侧镜像 | 用 `routeFlutter()`（严格），或升级桥接让 Flutter 侧存储被用上 |

**升级方向：** 依赖当前的 `fliwright_bridge`，在 `kDebugMode` 之后初始化 `FliwrightBridge.init()`，重新构建/重启，确认 `ext.fliwright.snap` 可用后再跑套件。不要继续对着一个过时、崩溃或不稳定的应用反复跑。

## 选择器 / 不稳定

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| `tap failed` 带一个 `contextDump` 列表 | 选择器没解析到；dump 显示了屏幕上实际有什么 | 读 dump，换成 key/semantics，或用 `.and()`/`.filter()` 限定范围 |
| 匹配到错的控件（文案有歧义） | `getByText('Submit')` 命中了多个 | 限定到某个父级、加 `.and({ type })`、用 semantics role，或 `.filter({ enabled: true })` |
| 首选命中不稳定 | `.nth(0)` / 首选命中在多次运行间跳变 | 用 key/semantics 钉住；用 `.filter({ text })` 或按位置过滤 |
| ref 第一次行之后失败 | 提交了硬编码的 `e<N>` ref（每次快照都不同） | 在同一次运行里捕获快照，或提交 `findRef({...})` / `getBySemantics(...)` 查询 |
| 路由跳转后元素变旧 | 选择器在跳转过程中匹配到了上一页的控件 | 用 `waitForNew(selector)` 而不是 `waitFor`/`locator` |
| 填到了错的字段 | 太宽泛的 `getByType('TextField')` | 先 `formHelper.analyze()` 再按 `selector` 匹配，或用 `getByKey`/semantics |

### 读 `contextDump`

当一个操作找不到目标时，抛出的错误会附上最多 10 个可见控件：

```
tap failed debug=…

Visible widgets on screen:
  - ElevatedButton "Submit" [key=submit] role=button
  - TextField "Email" semantics="Email address"
```

这份列表是找到正确选择器最快的路径，好好用。

## 时机 / 稳定性

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| 点击触发跳转后偶发失败 | 在跳转过程中查询了新页面 | `click({ waitForAnimations: true })` 或 `page.settle()`，再 `waitFor`/`expect` |
| 慢网络下断言来回抖动 | 默认 5s 超时太短 | `expect(loc).toBeVisible({ timeout: 15_000 })` 或 `waitForNetworkIdle()` |
| 截图断言失败/空白屏 | 应用正处在帧中间或 PlatformView 还没绘制 | 等一帧稳定/重启；WebView 用 `screenshot({ mode: 'canvas' })` |
| 测试依赖写死的 `sleep` | 隐性的时机耦合 | 换成 `waitFor` / 自动等待的 `expect` / `settle` |

**如果正在跑的应用崩溃或进入不稳定状态，立刻停掉 E2E。** 不要继续在一个坏掉的界面上点来点去。先重启/重新构建应用。

## 人工步骤 / Human-in-the-loop

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| 人工拖完 captcha 后脚本仍卡住 | 脚本只“提示人操作”，没有定义运行时可观察的完成条件 | 用 `flow.manual(..., { resumeWhen })` 轮询完成后的 app 状态 |
| 在 VS Code、Claude Code、terminal 中无法继续 | 依赖 stdin、按钮、或外部 continue 文件来通知运行时 | 对 app 内人工操作不要依赖外部通知；让 runtime 观察页面标题、表单、路由或成功态 |
| 人工步骤过早继续 | 完成条件太宽，例如只判断 captcha 文案消失或原表单不可见 | 改成业务上明确的下一状态，例如 two-factor 页面上的 `Verification required` |

推荐模式：

```typescript
await flow.manual('Complete Aliyun captcha', {
  message: 'Please manually complete the slider captcha in the running app.',
  timeoutMs: 180_000,
  pollIntervalMs: 700,
  resumeWhen: async () => page.getByText('Verification required', { exact: true }).isVisible(),
});

await expect(
  page.getByText('Verification required', { exact: true }),
  'Two-factor verification page is visible',
).toBeVisible({ timeout: 10_000 });

await flow.step('Fill two-factor verification code', async () => {
  await page.getByType('EditableText').first({ visible: true }).fill('000000');
});
```

原则：人工动作发生在 app 里，完成信号也应来自 app。优先选择“下一业务页面的稳定文本/key/semantics”，不要把“按回车”“点插件按钮”“touch 文件”作为主要继续机制。

## Mock

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| 路由在测试间串味 | 共享 driver 保留了上一次的路由 | 每个用例开头 `await driver.mock.clear(); await driver.mock.clearCalls();` |
| 没命中的路由打到真实网络 | passthrough 默认开着 | `clear()` 后 `setPassthrough(false)`（之后未命中 → 404） |
| `getCalls()` 的 body 断言失败 | Dio 把 JSON 当字符串发 | 断言字段前先 `JSON.parse(call.body)` |
| `routeFlutter()` 抛错 | Flutter 侧存储拒绝了路由/缺扩展 | 升级桥接，或对非 UI 探测接受 `route()` 回退 |

## 表单

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| `formHelper.analyze()` 返回 `[]` | 旧版桥接缺 `ext.fliwright.extractForm` | 升级桥接；legacy 脚本直接用裸 `ext.fliwright.extractForm` |
| `fill()` 漏掉了你以为该填的字段 | `skipObscureFields: true`，或该字段语义类型被推断成 `password` | 传 `skipObscureFields: false`，或按 key 显式填该字段 |
| 语义类型推断错 | hintText 子串撞车（例如 "邮箱地址".includes("地址")） | 按 `selector` 而不是按 hintText 子串匹配；加一条 `.fliwright/forms/*.json` 规则 |
| `fillFields(['手机号'])` 一个都没匹配到 | hint 没命中任何字段的 hintText/label/name/semanticsId | 先 `analyze()`，拷贝精确的 `hintText`/`selector` |

## 环境检查

- `fliwright doctor --vm-url …` 校验版本、包解析、配置以及**实时的桥接能力**。出问题时先跑它。
- `echo $FLIWRIGHT_VM_URL` 非空，且指向正在运行的应用。
- 应用暴露的是**当前**桥接（`ext.fliwright.snap` 能响应）。
- `.fliwright/` 存在且有 `forms/` 和 `mocks/`（`fliwright init` 会创建）。

## 升级排查顺序

1. 读该次失败的 `contextDump` / `widgetTree` / `source`。
2. `fliwright doctor --vm-url …` 做能力/版本检查。
3. `fliwright_snap` / `page.snapshot()` 看当前控件树。
4. 加固选择器（key/semantics/限定范围）或等待原语。
5. 如果应用本身不稳定/崩溃 → 先重启/重新构建，再继续 E2E。
