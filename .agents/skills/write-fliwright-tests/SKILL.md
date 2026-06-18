---
name: write-fliwright-tests
description: Create, update, review, or debug Fliwright test scripts for Flutter apps. Use when Codex needs to write TypeScript `.test.ts` files with `@fliwright/vitest`, selectors, locators, gestures, assertions, form filling, HTTP mocks, Riverpod state setup, MCP-recorded code cleanup, or manual `FliwrightDriver` E2E scripts.
---

# 编写 Fliwright 测试（Write Fliwright Tests）

## 概述

把 Fliwright 测试当作**确定性的 Flutter app 自动化**来写，而不是浏览器测试。普通测试文件优先用 `@fliwright/vitest` fixture，使用稳定的控件选择器，对可见的用户结果做断言，并显式写清楚对活动 VM 的依赖。

## 工作流

1. 判断测试形态：新建 `.test.ts`、修复既有脚本、转换录制产物、加 mock/状态准备，或诊断一个失败。
2. 在真实探查前先检查桥接能力。优先选择暴露了当前桥接（`ext.fliwright.snap`、`ext.fliwright.action`、`ext.fliwright.extractForm`、截图与 mock 扩展）的 app。
3. 优先 `import { test, expect } from '@fliwright/vitest'`，除非该文件需要显式的 driver 生命周期、自定义插件或底层设置。
4. 针对你需要的主题读对应的参考文档。从 **[references/index.md](references/index.md)**（主题地图）开始，或直接去：[getting-started.md](references/getting-started.md), [test-harness.md](references/test-harness.md), [selectors.md](references/selectors.md), [actions.md](references/actions.md), [assertions.md](references/assertions.md), [navigation.md](references/navigation.md), [forms.md](references/forms.md), [ai.md](references/ai.md), [mocks.md](references/mocks.md), [state.md](references/state.md), [screenshots-snapshots.md](references/screenshots-snapshots.md), [driver-lifecycle.md](references/driver-lifecycle.md), [cli.md](references/cli.md), [mcp-workflow.md](references/mcp-workflow.md), [troubleshooting.md](references/troubleshooting.md), [examples.md](references/examples.md)，或一页式的 [api-quick-reference.md](references/api-quick-reference.md) 查精确签名。
5. 写选择器前先看附近的测试和源码 UI。用 `rg` 搜控件文案、key、路由名、provider 名以及既有的 Fliwright 模式。
6. 写最短的用户路径脚本：设置状态、执行动作、对可见结果断言。不要用 sleep；依靠 `waitFor()` 和 Fliwright 断言。
7. 尽可能用仓库的 TypeScript 检查来校验语法和导入。只有在能拿到 Flutter VM Service URL 且 app 稳定时才跑 Fliwright E2E 测试。

## 夹具选择（Harness Choice）

- 标准脚本用 `@fliwright/vitest` 默认的 `test`。它读 `FLIWRIGHT_VM_URL`（兼容 `FLIWRIGHT_VM_SERVICE_URL`），创建共享 driver，提供 `{ page, driver }`，并接好失败上下文。
- 当脚本必须写死/变换 VM URL、调整超时或关掉截图时，用 `createFliwrightTest(defineConfig(...))`。
- 只有在自定义插件、旧桥接兼容、或刻意做底层坐标/扩展测试时，才在 Vitest 的 `beforeAll/afterAll` 里用裸 `FliwrightDriver`。务必调用 `dispose()`。
- 常规的 mock/状态操作用 `driver` fixture，别写裸生命周期代码：`test('...', async ({ page, driver }) => { await driver.mock.route(...); })`。
- 用 MCP 工具（`fliwright_snap`、`fliwright_observe`、`fliwright_record`、`fliwright_generate_test`、`fliwright_run`、`fliwright_get_failure`）来发现或验证行为，然后提交一个正常的测试文件。

## AI 与状态能力（AI & State Capabilities）

Fliwright 自带 AI 子系统和状态注入适配器。要**显式**使用——它们默认不开。完整细节见 [references/ai.md](references/ai.md) 和 [references/state.md](references/state.md)。

- **AI runtime** —— fixture 还会产出 `aiRuntime`：`test('…', async ({ page, driver, aiRuntime }) => { … })`。用 `aiRuntime.generate()` 造结构化测试数据（带 `fallback`），用 `aiRuntime.visible()`/`inspect()` 做视觉断言，用 `aiRuntime.classify()` 按当前屏幕分支。fixture 之外的脚本，从 `@fliwright/core` import `{ ai, configureAi }`。通过 `createFliwrightTest({ ai: { provider } })` 或 `FLIWRIGHT_AI_PROVIDER`（`mock` | `claude` | `codex` | `custom-cli` | `none`）配置 provider。**默认关闭/mock——只有你显式配置才会真的调模型。**
- **自愈选择器** —— 自动：经 `@fliwright/vitest` 的 `expect()` 做的断言，通过时会记录成功快照；非否定断言失败时会先尝试重新定位控件（4 维加权打分，置信度 ≥0.85）再抛错。通过 `driver.healing.getReports()` / `setEnabled(false)` 查看或关闭。`.not` 会关闭自愈。
- **AI 辅助填表** —— `page.formHelper` 推断每个字段的语义类型并填入逼真假数据；在 `.fliwright/forms/*.json` 里写一条 `LLM_GENERATE` 规则可让特定字段去问模型。见 [forms.md](references/forms.md)。
- **状态注入** —— `driver.state`（一个 Riverpod `StateAdapter`）暴露 `read` / `write` / `override` / `watch` / `listProviders`。用 `override()` 跳过登录或直接进入某个业务态，再对可见结果断言。需要 app 接入 `fliwright_bridge_riverpod` 扩展。

AI 编写建议：保持 CI 确定性（`provider: 'mock'` 或 `'none'`）；捕获 `AiDisabledError` 并降级为普通的 `getByText` 断言，别让测试仅仅因为没配 AI 而挂。把自愈当成一张“报告修复建议”的安全网——事后仍要把更稳的 `suggestedSelector` 落地进去。

## 桥接就绪（Bridge Readiness）

- 写基于 ref 或 agent 生成的测试前，先确认 app 跑的是当前桥接。出现 `Unknown method "ext.fliwright.snap"` 这类失败，说明 app 用的是旧桥接；要用 `snapshot()`、`findRef()`、MCP observe/find 或可操作性诊断，就得先升级。
- 当前桥接的流程在探查时应当用 `page.snapshot()`、`page.findRef()`、`fliwright_snap`、`fliwright_observe`。不要跨测试运行写死 `e<N>` ref。
- 旧桥接流程只有在目标 app 暂时无法升级时，才可用 `ext.fliwright.extractForm`、`ext.fliwright.snapshot` 和显式的裸 driver 脚本。把这些脚本标为 legacy 并隔离开。
- 如果活动 app 崩溃或进入不稳定状态，立即停止跑 E2E。不要继续盲点坐标探查；请重启 app，并优先升级内置桥接。
- Flutter app 推荐的升级方向：依赖当前的 `fliwright_bridge`，在 `kDebugMode` 后初始化 `FliwrightBridge.init()`，重新构建/重启 app，确认 `ext.fliwright.snap` 能用后再跑全套测试。

## 编写规则（Authoring Rules）

- 选择器按这个优先级来：稳定的 `Key` > semantics identifier/label/role > 精确可见文案 > 限定范围的文案/类型 > 控件类型（仅作兜底）。
- 对当前桥接目标，探查时优先用 ref 发现（`page.snapshot()` -> `page.findRef({ role, text, key, type })`），然后落地成有弹性的、基于查询的 locator，而不是快照那一刻的 `e<N>` ref。
- 新测试里优先用对象或辅助选择器（`page.getByKey('submit')`、`page.getByText('Submit')`、`page.locator({ text: 'Submit' })`），而不是含义模糊的纯字符串。
- 用 descendant/ancestor locator、`.and(...)`、`.nth(...)` 或路由/表单上下文来限定含义模糊的控件，别依赖“取第一个”的行为。
- 替换字段值用 `fill()`，追加/键入行为用 `type()`。除非被测行为本身基于坐标，否则在 locator 上用 `click()`、`longPress()`、`drag()`、`pinch()`，而不是坐标。
- 尽可能通过 UI 来断言状态：`await expect(page.getByText('Done')).toBeVisible()`、`toHaveText`、`toContainText`、`toBeEnabled` 或 `not`。
- 不要加固定 sleep。用 `await page.waitFor(selector, timeout)` 或断言超时。
- E2E 专用脚本把 VM Service URL 的要求写在注释或文档里，但别把本机 URL 写进提交的测试。

## 示例（Examples）

下面这些可作为可复制的起点：

- [examples/basic-counter.test.ts](examples/basic-counter.test.ts) —— 标准的 `@fliwright/vitest` fixture。
- [examples/custom-config-login.test.ts](examples/custom-config-login.test.ts) —— 自定义 fixture 配置和登录流程。
- [examples/manual-driver-form-mock.test.ts](examples/manual-driver-form-mock.test.ts) —— 裸 driver 生命周期，带 mock 和表单助手。

更长的、带完整注释的脚本（mock+表单+提交、go_router 导航、旧裸 driver 流程），见 [references/examples.md](references/examples.md)。

## 校验（Validation）

- 静态检查：跑 `pnpm lint`，或如果改动的包有自己的话，跑按包过滤的 TypeScript 检查。
- 单元级包检查：改框架代码时跑 `pnpm --filter @fliwright/vitest test`、`pnpm --filter @fliwright/core test` 或相关包测试。
- 活动 app 测试：优先 `fliwright run --test path/to/test.ts --vm-url ws://127.0.0.1:<port>/<token>/ws --reporter ai-json` 或 MCP `fliwright_run`，这样 AI agent 能拿到完整报告、截图、诊断信息和复现命令。
- 做快速冒烟检查时直接 `pnpm vitest run path/to/test.ts` 可以，但除非经 CLI runner 启动，否则不会产出同样的、持久化的 AI 运行报告。
- 如果唯一缺的前置条件是一个运行中的 Flutter app 或 VM URL，请明确说明，并仍尽可能校验 TypeScript。

## 常见修复（Common Repairs）

- `No VM Service URL provided`：设置 `FLIWRIGHT_VM_URL` 或用 `createFliwrightTest({ vmServiceUrl })`。
- `Unknown method "ext.fliwright.snap"`：app 跑的是旧桥接。要用 snap/ref/observe/可操作性功能前先升级/重建 app，或把脚本明确走 legacy 裸 driver 路径。
- Flutter 绘制断言的截图失败：等一个稳定的 app 帧或重启 app；别在不稳定屏幕上一直点。
- 用 `FLIWRIGHT_VM_SERVICE_URL` 的既有示例通常用裸 `FliwrightDriver`；在 `driver.connect()` 前把 HTTP VM URL 转成 WebSocket URL。
- 抖动选择器：把宽泛的文案/类型换成 key、semantics、限定范围的 locator，或探查时由 `snapshot()`/`findRef()` 返回的断言目标。
- 字段填错了想要的输入：用 `page.formHelper.analyze()` 检查字段，再 `fillFields([...])` 或用更精确的 locator。

完整的“症状 → 原因 → 修复”表（VM URL、桥接就绪、抖动选择器、时序、mock、表单），见 [references/troubleshooting.md](references/troubleshooting.md)。
