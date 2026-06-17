# Fliwright 测试编写参考 — 索引

本目录是 **`write-fliwright-tests`** 技能的支撑知识库。
按需加载你需要的主题；写测试前不需要全部读完。

> 如果你是初次接触本框架，先看 **[getting-started.md](./getting-started.md)**。
> 想要一份把所有签名汇成一页的速查表，跳到 **[api-quick-reference.md](./api-quick-reference.md)**。

## 主题地图

| 文档 | 覆盖内容 | 何时读… |
| --- | --- | --- |
| [getting-started.md](./getting-started.md) | 桥接设置、第一个测试、环境变量、运行测试 | 你在写第一个 Fliwright 测试 |
| [test-harness.md](./test-harness.md) | `@fliwright/vitest` fixture：`test`、`expect`、`createFliwrightTest`、hooks、环境变量、失败上下文 | 你在决定如何接入 driver 生命周期 |
| [selectors.md](./selectors.md) | 选择器格式、`getByX`、作用域（`descendant`/`ancestor`/`and`/`or`/`nth`/`first`/`last`/`filter`/`containing`）、`subtype`/`tooltip`/`state` | 你需要稳定地定位某个控件 |
| [actions.md](./actions.md) | `click`/`longPress`/`drag`/`dragTo`/`slideTo`/`pinch`/`type`/`fill`/`clear`/`pressKey`/`setCheckbox`/`selectOption`/`scrollIntoView` + 底层 `clickAt`/`dragFrom` | 你要做手势 / 输入 |
| [assertions.md](./assertions.md) | `expect()` 匹配器、自动等待、`.not`、自愈 | 你在对可见结果做断言 |
| [navigation.md](./navigation.md) | `navigate` / `currentRoute` / `goBack` / `waitFor` / `waitForNew` / `settle`、go_router 设置 | 你的测试跨越多个路由 / page |
| [forms.md](./forms.md) | `page.formHelper.analyze()` / `fill()` / `fillFields()`、语义类型、作用域、表单规则 JSON | 你在填表单或冒烟测表单 |
| [ai.md](./ai.md) | AI runtime（`aiRuntime` fixture / `ai` 命名空间：`ask`/`generate`/`classify`/`visible`/`inspect`）、自愈 self-healing、provider 配置、`FakerGenerator`/`SemanticInferrer`/`AssertionSuggester` | 你要用 AI 造数/视觉断言，或想知道选择器自愈怎么工作 |
| [mocks.md](./mocks.md) | `driver.mock.*`（route / getCalls / loadRules / switchRule / …）、JSON mock 文件、`fliwright mock:start` | 你要 stub HTTP / 对请求做断言 |
| [screenshots-snapshots.md](./screenshots-snapshots.md) | `screenshot` / `screenshotFullPage` / `snapshot` / `findRef` / `ref`、桥接能力表 | 你在探查控件树、抓图、或处理 refs |
| [driver-lifecycle.md](./driver-lifecycle.md) | 手动 `FliwrightDriver`、`connect`/`dispose`、`sendRequest`、诊断信息、原始扩展 | 你需要自定义插件、原始扩展、或旧桥接兼容 |
| [state.md](./state.md) | `driver.state`（StateAdapter / Riverpod）：`read` / `write` / `override` / `watch` / `listProviders`，跳过 UI 直接进入业务态 | 你要跳过登录、覆盖 provider、或断言 UI 没展示的状态 |
| [cli.md](./cli.md) | `fliwright run` / `init` / `doctor` / `record` / `mock:start`、选项、reporter、环境变量、VM 发现、自动化脚本 | 你在运行测试或搭自动化 |
| [mcp-workflow.md](./mcp-workflow.md) | `fliwright_snap` / `observe` / `record` / `generate_test` / `run` / `get_failure` | 你在通过 MCP 发现行为了或验证 |
| [troubleshooting.md](./troubleshooting.md) | 常见修复、桥接就绪检查、抖动选择器、崩溃 | 一个测试失败了，你需要解法 |
| [examples.md](./examples.md) | 可复制、带注释的完整测试脚本 | 你想要一个能照着改的模板 |

## 如何理解 Fliwright

Fliwright 通过运行中 Flutter app 的 VM Service（Dart 调试协议）来驱动它。
它不是浏览器工具。每个 `page.*` / `locator.*` 调用都会变成一个 JSON-RPC 请求，发给由 `FliwrightBridge`（`fliwright_bridge` 包）注册的 Dart 端扩展，而该扩展必须由 app 在 debug 构建里初始化。

```
Test (.test.ts, Vitest)
   │  @fliwright/vitest fixture creates one FliwrightDriver
   ▼
FliwrightDriver  ──►  VMServiceConnector (WebSocket)
   │                       │  JSON-RPC 2.0
   ▼                       ▼
Page / Locator / Mock   Flutter VM Service
                            │
                            ▼
                        FliwrightBridge extensions
                        (ext.fliwright.snap / .action / .extractForm / .mock.* / …)
```

以下这些推论会贯穿每一个测试：

- app 必须在测试连接**之前**就跑起来（`flutter run`）。
- app 必须暴露当前桥接——旧桥接缺 `ext.fliwright.snap`、`ext.fliwright.action`、`ext.fliwright.extractForm`。见 [troubleshooting.md](./troubleshooting.md)。
- `flutter run` 打印的 VM URL 有时是 `http://…`，必须转成 `ws://…/ws`。fixture 自动转；用裸 driver 的脚本得手动转。
- 避免写死 `sleep()`。优先用 `waitFor()` / 自动等待的 `expect()` / `page.settle()`。见 [navigation.md](./navigation.md) 和 [assertions.md](./assertions.md)。

## 本文档的约定

- **以 TypeScript 为主。** 大多数示例用 `@fliwright/vitest` fixture。Dart 相关只对*被测 app*（桥接初始化）有意义，与测试代码本身无关。
- 每个签名都取自当前源码——若本文件的签名与代码不一致，以代码为准。重新读源码来重建理解，别依赖记忆。
- 标了 `// e2e` 的代码块改编自 `e2e/` 和 `.agents/skills/write-fliwright-tests/examples/` 中的真实测试。
