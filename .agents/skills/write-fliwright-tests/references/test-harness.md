# 测试框架：`@fliwright/vitest`

如何把 driver 接到你的测试里。**普通脚本优先用默认 fixture**；只有在需要自定义配置时才用
`createFliwrightTest`，只有在自定义插件 / 原始扩展 / 旧桥接兼容时才用裸 `FliwrightDriver`。

## 导入

```typescript
import { test, expect } from '@fliwright/vitest';
```

包里还重新导出了：`createFliwrightTest`、`defineConfig`、`beforeEach`、
`afterEach`、`beforeAll`、`afterAll`、`describe`。

## 默认的 `test` fixture

```typescript
test('name', async ({ page, driver, aiRuntime }) => { /* … */ });
```

它替你做的事：

| 关注点 | 行为 |
| --- | --- |
| VM URL | 读 `process.env.FLIWRIGHT_VM_URL`，兜底 `FLIWRIGHT_VM_SERVICE_URL`；HTTP→WS 转换自动完成 |
| Driver | 每进程一个**共享** `FliwrightDriver`，懒创建并连接 |
| Fixtures | 提供 `{ page, driver, aiRuntime }`。`aiRuntime` 是一个已绑定到当前 `page`/`driver`/`testName` 的 `AiRuntime`——用它来做 `generate`/`classify`/`visible`/`inspect`（见 [ai.md](./ai.md)）。用不到 AI 时省略它。 |
| 诊断信息 | 启动 `driver.listenToDiagnostics()`，把日志/stderr 收集进失败报告 |
| 失败上下文 | 当 `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH` 被设置时，写入断言详情 + 控件树 + 截图 + 诊断信息 + 源码 + 自愈建议 |
| Trace | 当 `FLIWRIGHT_TRACE_DIR` + `FLIWRIGHT_TRACE` 被设置时，按动作记录 trace（见 [driver-lifecycle.md](./driver-lifecycle.md)） |
| 截图模式 | 由 `FLIWRIGHT_SCREENSHOT_MODE` 控制 |

`driver` fixture 就是你做 mock 和状态操作时用的——优先用它，别写裸生命周期代码：

```typescript
test('submits through mocked API', async ({ page, driver }) => {
  await driver.mock.clear();
  await driver.mock.route('/api/login', { method: 'POST', status: 200, body: { token: 't' } });
  await page.getByKey('loginButton').click();
});
```

## 自定义配置：`createFliwrightTest` + `defineConfig`

当某个文件必须写死/变换 VM URL、改超时、或关掉截图时用。

```typescript
import { createFliwrightTest, defineConfig, expect } from '@fliwright/vitest';

const test = createFliwrightTest(defineConfig({
  vmServiceUrl: process.env.FLIWRIGHT_VM_URL ?? '',
  timeout: 10_000,
  screenshot: 'file',
}));
```

`FliwrightConfig` 结构：

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `vmServiceUrl` | `string` | *(必填)* | HTTP 或 WS URL；会被转成 `ws://…/ws` |
| `timeout` | `number` | `5000` | 默认断言 / 失败超时，单位 ms |
| `screenshot` | `'file' \| 'base64' \| 'off'` | `'file'` | 失败截图如何序列化 |
| `ai` | `AiRuntimeConfig` | *(未设)* | AI runtime 配置（`provider`、`cache`、`timeoutMs`、`artifactsDir`、…）。支撑 `aiRuntime` fixture 和自愈。见 [ai.md](./ai.md)。 |

```typescript
export function defineConfig(overrides: Partial<FliwrightConfig> & { vmServiceUrl: string }): FliwrightConfig
```

`defineConfig` 填入默认值（`timeout: 5000`、`screenshot: 'file'`）并应用你的覆盖。

## Hooks

本包重新导出的 hooks 都带上了 `{ page }` 上下文类型：

```typescript
import { test, beforeEach, afterEach } from '@fliwright/vitest';

beforeEach(async ({ page }) => {
  await page.navigate('/');        // reset to a known route before each test
});

afterEach(async ({ page }) => {
  // optional teardown
});
```

`beforeEach` / `afterEach` 收到的是 `{ page }`；`beforeAll` / `afterAll` 直接从 Vitest 原样重新导出（没有 Fliwright 上下文）。`describe` 也被重新导出。

## `expect`（Fliwright 断言）

`expect(locator)` 返回一个 `Assertion`（Playwright 风格的自动等待）。它从测试上下文里取出活动的 driver，
所以自愈和失败捕获自动挂上：

```typescript
await expect(page.getByText('Welcome')).toBeVisible();
await expect(page.getByKey('submit')).toBeEnabled({ timeout: 10_000 });
await expect(page.getByText('Saved')).toContainText('Saved');
await expect(page.getByKey('passwordError')).not.toBeVisible();
```

如果想在 Fliwright 封装之外做原始布尔判断，导入 Vitest 的 `expect`：

```typescript
import { expect as viExpect } from 'vitest';
viExpect(await page.getByText('Ready').count()).toBe(1);
```

完整匹配器列表和行为 → [assertions.md](./assertions.md)。

## 环境变量参考

| 变量 | 用途 |
| --- | --- |
| `FLIWRIGHT_VM_URL` | Flutter VM Service URL（HTTP 或 WS）。主用。 |
| `FLIWRIGHT_VM_SERVICE_URL` | 上面 URL 的兼容别名。 |
| `FLIWRIGHT_SCREENSHOT_MODE` | `file` \| `base64` \| `off`。供默认 `test` 使用。 |
| `FLIWRIGHT_FAILURE_TIMEOUT_MS` | 默认 `test` 的单测试失败/断言超时。 |
| `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH` | 追加失败上下文 JSON 的文件路径（由 `fliwright run` 设置）。 |
| `FLIWRIGHT_MOCK_CONTROLLER_URL` | 工具侧 mock 控制器的 WebSocket URL。 |
| `FLIWRIGHT_TRACE` | Trace 模式：`full` \| `on-failure` \| `off`。 |
| `FLIWRIGHT_TRACE_DIR` | 写单测试 trace 产物的目录。 |
| `FLIWRIGHT_AI_PROVIDER` | AI provider：`mock` \| `claude` \| `codex` \| `custom-cli` \| `none`（默认 `none`）。见 [ai.md](./ai.md)。 |
| `FLIWRIGHT_AI_ENABLED` | `true` \| `false`（默认：`provider !== 'none'`）。 |
| `FLIWRIGHT_AI_TIMEOUT_MS` | 单次 AI 调用超时（默认 `60000`）。 |
| `FLIWRIGHT_AI_CACHE` | `off` \| `read` \| `write` \| `read-write`（默认 `off`）。 |
| `FLIWRIGHT_AI_ARTIFACTS_DIR` | AI prompt/响应产物写入位置（默认 `.fliwright/ai`）。 |
| `FLIWRIGHT_AI_COMMAND` / `FLIWRIGHT_AI_ARGS` | `claude`/`codex`/`custom-cli` provider 的命令 + 逗号分隔参数。 |

## 没有就自动跳过

需要活动 app 的测试应当在没配 URL 时干净地跳过，这样套件在 CI 里仍然能跑：

```typescript
// e2e — skips the whole suite unless a VM URL is present
const hasVmUrl = Boolean(process.env.FLIWRIGHT_VM_URL ?? process.env.FLIWRIGHT_VM_SERVICE_URL);
const liveTest = test.skipIf(!hasVmUrl);

liveTest('fills the form', async ({ page }) => { /* … */ });
```

或者包一层 `describe`：

```typescript
describe.skipIf(!vmServiceUrl)('Exio app live E2E', () => { /* … */ });
```

## 何时绕过 fixture

只有当你需要以下场景时，才用裸 `FliwrightDriver`（见 [driver-lifecycle.md](./driver-lifecycle.md)）：

- **自定义插件**，传给 `new FliwrightDriver({ plugins: [...] })`，
- **原始 VM Service 扩展**（`ext.fliwright.extractForm`、`ext.fliwright.snapshot`）——通常是旧桥接，
- **刻意要更底层**的坐标/扩展测试。

务必在 `afterAll` 里调 `await driver.dispose()`。
