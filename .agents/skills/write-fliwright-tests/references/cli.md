# CLI: `fliwright`

`fliwright` CLI 用来跑测试、生成配置脚手架、检查环境、把录制流程导出成代码，以及承载 mock 控制器。**优先用 `fliwright run` 而不是直接 `pnpm vitest`**——它会产出 AI/人类可读的报告、持久化截图，并打印复现命令。

```text
fliwright <command> [options]
  run          Run Fliwright tests
  init         Initialize Fliwright in the current project
  doctor       Check your Fliwright environment
  record       Record user interactions and generate test code
  mock:start   Start the Fliwright tool-side mock controller
```

## `fliwright run`

```text
fliwright run \
  --test <pattern>          Test file or glob pattern
  --test-name <pattern>     Run only tests matching this name
  --vm-url <url>            Dart VM Service WebSocket URL
  --reporter <format>       pretty | json | ai-json | junit   (default pretty)
  --timeout <ms>            Per-test timeout in ms            (default 30000)
  --screenshot <mode>       file | base64 | off              (default file)
  --output <file>           Write the AI run report JSON to this file
```

### 它做了什么

1. 通过 jiti 加载 `fliwright.config.ts` 取默认值——`testDir`、`vmServiceUrl`、`timeout`、`reporter`。
2. 解析 VM URL：优先级 `--vm-url` ▸ `config.vmServiceUrl` ▸ 自动发现（`vm-discovery.ts` 会扫描正在运行的 Flutter VM Service）。
3. 用 `--reporter=json` 启动 Vitest，注入 `FLIWRIGHT_VM_URL`、`FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH`、`FLIWRIGHT_SCREENSHOT_MODE`、`FLIWRIGHT_FAILURE_TIMEOUT_MS`。
4. 读取失败上下文 JSON 和测试产出的 timeline，把截图/快照持久化到 `~/.fliwright/projects/<project-slug>/runs/<runId>/`（或 `FLIWRIGHT_RUNS_ROOT` 覆盖的根目录）。
5. 把完整报告写到 `<runsRoot>/<runId>/report.json`（或 `--output` 指定的路径），并在 artifacts 中列出 timeline path。
6. 每次运行都打印 `reproduceCommand`（`fliwright run --test … --test-name …`）。

### 报告器

| 格式 | 用途 |
| --- | --- |
| `pretty`（默认） | 终端下给人看 |
| `json` / `ai-json` | 给机器/AI 消费——含失败与产物的完整结果 |
| `junit` | CI 集成（Jenkins、GitHub Actions 的 JUnit 查看器） |

`CliRunResult` 结构：

```typescript
{
  passed: boolean;
  totalTests, passedTests, failedTests, duration: number;
  results: Array<{ name: string; passed: boolean; duration: number; error?: string }>;
  failures?: CliFailureEntry[];   // assertion + widgetTree + diagnostics + source + screenshot + healingSuggestion
  agentVisibleFailures?: AgentVisibleFailure[];
  timelines?: Array<{ path: string; runId?: string; status?: string }>;
  artifacts?: { runId, outputDir, reportPath, screenshots: string[], timelines?: string[] };
  reproduceCommand: string;
}
```

### 示例

```bash
# Run a single file against a running app
fliwright run --test e2e/form-fill-e2e.test.ts \
  --vm-url "ws://127.0.0.1:54321/abc=/ws" --reporter ai-json

# Run only tests whose name matches
fliwright run --test e2e/form-mock-e2e.test.ts --test-name "submit"

# Pretty report, no screenshots
fliwright run --test "e2e/**/*.test.ts" --reporter pretty --screenshot off

# Write the report to a fixed path for CI
fliwright run --reporter json --output reports/run.json
```

## `fliwright init`

在当前项目里生成 Fliwright 脚手架：写入 `fliwright.config.ts` 和 `.fliwright/` 目录骨架（forms/、mocks/）。给应用接入 Fliwright 时跑一次即可。

```bash
fliwright init
```

## `fliwright doctor`

校验环境：Node/Flutter 版本、包解析、配置是否存在；带上 `--vm-url` 时还会做实时的桥接能力检查（`ext.fliwright.snap`、`ext.fliwright.action` 等）。

```bash
fliwright doctor
fliwright doctor --vm-url "ws://127.0.0.1:54321/abc=/ws"   # runtime bridge checks
```

遇到“跑不起来”时先跑它——它能精确定位缺少的桥接扩展。

## `fliwright record`

在正在运行的应用上录制实时交互，并产出测试初稿。

```text
fliwright record \
  --vm-url <url>             Dart VM Service WebSocket URL
  --output <file>            Output file path
  --lang <ts | dart>         Output language           (default ts)
  --name <name>              Test name                 (default "recorded test")
  --home-route <route>       Navigate here before each generated TS test (default "/")
  --no-reset-home            Do NOT generate a beforeEach hook navigating to home-route
```

```bash
fliwright record --vm-url "ws://127.0.0.1:54321/abc=/ws" \
  --output e2e/recorded.test.ts --lang ts --name "checkout flow"
```

录制器会通过 `EventAggregator` 把原始的指针/文本事件聚合成语义操作，再由 `CodeGenerator`（TS）或 `DartCodeGenerator`（Dart integration_test）渲染成文件。**产出一定要再清理一遍**：精简选择器、把临时引用换成查询 locator、补上断言。`fliwright_record` 的等价流程见 [mcp-workflow.md](./mcp-workflow.md)。

当生成器启用 `timeline: true` 时，TS 输出会使用 `{ flow, mock, agent }` 或 `script` fixture，并把每个录制动作包进 `flow.step(...)`。清理这类产物时优先保留 step 边界、替换稳定 selector，再补 `expect(locator, title?).to*`。

## `fliwright mock:start`

把工具侧的 mock 控制器作为独立进程启动。

```text
fliwright mock:start \
  --host <host>        default 127.0.0.1
  --port <port>        default = random free port
  --mock-dir <dir>     default .fliwright/mocks
```

通过 `FLIWRIGHT_MOCK_CONTROLLER_URL` 让应用指向打印出来的 WebSocket URL。详见 [mocks.md](./mocks.md)。

## 配置：`fliwright.config.ts`

`loadConfig()` 通过 jiti 读取它。可识别的字段：`testDir`（默认 `e2e`）、`vmServiceUrl`、`timeout`、`reporter`。优先级：CLI 参数 > 配置值 > 默认值。

```typescript
// fliwright.config.ts
import { defineConfig } from '@fliwright/cli';   // or a plain export

export default defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  reporter: 'pretty',
  // vmServiceUrl: 'ws://127.0.0.1:54321/abc=/ws',
});
```

## 自动化：`package.json` 脚本

为每个测试套件加一条脚本，让 CI/同事跑的是同一件事。e2e 包用的就是这个模式：

```json
{
  "scripts": {
    "test:form": "fliwright run --test e2e/form-fill-e2e.test.ts",
    "test:form-mock": "fliwright run --test e2e/form-mock-e2e.test.ts",
    "test:mock-e2e": "fliwright run --test e2e/mock-api-e2e.test.ts",
    "test:go-router": "fliwright run --test e2e/go-router-navigation-e2e.test.ts",
    "test:e2e": "fliwright run --test e2e/app-e2e.test.ts",
    "test:all": "fliwright run --test \"e2e/**/*.test.ts\""
  }
}
```

导出 VM URL 后运行：

```bash
FLIWRIGHT_VM_URL="ws://127.0.0.1:54321/abc=/ws" pnpm test:form-mock
```

## 自动化：CI shell 示例

```bash
# 1. start the app detached (example: macOS)
fvm flutter run -d macos --debug &
APP_PID=$!

# 2. wait for the VM Service URL to appear (parse flutter run output, or use vm-discovery)
VM_URL="$(./scripts/wait-for-vm.sh)"

# 3. run the suite, machine-readable report for CI
fliwright run --test "e2e/**/*.test.ts" \
  --vm-url "$VM_URL" --reporter junit --output reports/junit.xml \
  --screenshot file

# 4. tear down
kill $APP_PID
```

在没有给 `--vm-url`/配置时，`vm-discovery.ts` 会自动发现正在运行的 VM Service，因此第 2 步通常可以省掉。

## 快速冒烟（不产报告）

本地想快速验证时可以直接调 Vitest——但拿不到持久化报告：

```bash
FLIWRIGHT_VM_URL="ws://127.0.0.1:54321/abc=/ws" pnpm vitest run path/to/test.ts
```
