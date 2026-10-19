# 快速开始

先配置测试 runner，再接入桥接、启动 app、提供 VM URL、编写和运行测试。

## 0. 配置项目与 runner

在目标项目根目录使用项目安装的 CLI：`pnpm exec fliwright` 或 `npx --no-install fliwright`。下文简写为 `fliwright`。

新项目运行 `fliwright init --json` 生成 `fliwright.config.ts`、`vitest.config.ts` 与 `.fliwright/` 示例。已有配置的项目先检查并合并所需设置；初始化选项见 [init](../../fliwright-cli-workflows/references/commands/command-init.md)。

直接运行 Vitest 时，`vitest.config.ts` 必须安装 Fliwright runner 和 recovery reporter：

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { fliwrightPreset } from '@fliwright/vitest/preset';
import projectConfig from './fliwright.config.js';

export default defineConfig({
  ...fliwrightPreset(projectConfig),
});
```

已有 Vitest 设置通过 `fliwrightPreset({ ...projectConfig, test: { /* 项目设置 */ } })` 合并，避免在 preset 之后覆盖其 runner、reporters 或 env。缺少 runner 时 fixture 会抛出 `Fliwright fixtures require the Fliwright runner`。`fliwright run` 会自行安装 runner；保持同一份项目配置，让直接 Vitest 和 CLI 使用一致的场景与工件路径。

## 1. 在被测 app 中初始化桥接

Fliwright 通过 `fliwright_bridge` 包注册的 Dart VM Service 扩展来驱动 Flutter。**只在 debug 构建里**初始化它，放在你 app 的 `main()` 中：

```dart
import 'package:flutter/foundation.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

Future<void> main() async {
  if (kDebugMode) {
    await FliwrightBridge.init();
  }
  runApp(const MyApp());
}
```

如果你的测试用到路由导航（`page.navigate('/login')`），把你的 router 传进去：

```dart
await FliwrightBridge.init(router: myGoRouter);
```

加完后重新构建/重启 app。桥接会注册 `ext.fliwright.snap`、`ext.fliwright.action`、`ext.fliwright.extractForm` 和 `ext.fliwright.mock.*` 等扩展。

## 2. 启动 app 并复制 VM Service URL

```bash
fvm flutter run -d macos --debug     # or ios / android / windows / linux
```

控制台会打印一行类似：

```
A Dart VM Service on macOS is available at: http://127.0.0.1:54321/abc=/
```

fixture 接受 HTTP URL 并自动把它转成 `ws://…/ws`，所以两种格式都行。
保持 app 运行——测试要连接它。

## 3. 为测试进程设置 VM URL

可由项目配置提供 URL，也可以为测试进程设置环境变量：

```bash
# Option A — recommended env var
export FLIWRIGHT_VM_URL="http://127.0.0.1:54321/abc=/"

# Option B — compatibility alias (older docs)
export FLIWRIGHT_VM_SERVICE_URL="http://127.0.0.1:54321/abc=/"
```

如果配置和环境都没有提供 URL，也未通过 CLI 发现或启动 app，fixture 会抛：

```
No VM Service URL provided. Set FLIWRIGHT_VM_URL or FLIWRIGHT_VM_SERVICE_URL,
or use createFliwrightTest({ vmServiceUrl }).
```

## 4. 写测试

一个用默认 `@fliwright/vitest` fixture 的最小测试：

```typescript
// .fliwright/tests/counter.test.ts
import { test, expect } from '@fliwright/vitest';

test('counter increments when the increment button is tapped', async ({ page }) => {
  await expect(page.getByText('Count: 0')).toBeVisible();

  await page.getByText('Increment').click();

  await expect(page.getByText('Count: 1')).toBeVisible({ timeout: 3_000 });
});
```

这样就行了。fixture 会：

- 读取 `FLIWRIGHT_VM_URL`（兜底用 `FLIWRIGHT_VM_SERVICE_URL`），
- 创建**一个共享的 `FliwrightDriver`** 并连接，
- 给每个测试注入 `{ page, driver }`，
- 由 Fliwright runner 为每次 attempt 保存 timeline、日志与失败证据（截图、控件树、诊断信息等，取决于配置和 app 支持）。

自定义配置与生命周期控制见 [test-harness.md](./test-harness.md)。已登录业务测试先定义 [命名组合场景](./scenarios.md)，通过 app-owned `auth.seedLoggedIn` 准备认证状态。

## 5. 运行测试

通过 CLI（推荐——会产出 AI/人类可读报告、持久化截图、打印复现命令）：

```bash
fliwright run \
  --test .fliwright/tests/counter.test.ts \
  --vm-url "ws://127.0.0.1:54321/abc=/ws" \
  --json
```

配置上述 preset 后，也可以直接运行 Vitest；runner 仍会保存 canonical attempt 工件，CLI 则另外提供统一 JSON envelope、汇总报告与复现命令：

```bash
FLIWRIGHT_VM_URL="ws://127.0.0.1:54321/abc=/ws" pnpm vitest run .fliwright/tests/counter.test.ts
```

一项临时自动化任务使用 `.fliwright/scripts/*.script.ts` 和 `fliwright script FILE --json`。命令、参数及工件查询见 [CLI 索引](../../fliwright-cli-workflows/references/commands/index.md)。

## 前置检查清单

| 要求 | 如何校验 |
| --- | --- |
| app 跑的是**当前**桥接 | `ext.fliwright.snap` 能响应（见 [screenshots-snapshots.md](./screenshots-snapshots.md)）。`fliwright doctor` 会检查能力。 |
| 已导出 VM Service URL | `echo $FLIWRIGHT_VM_URL` 非空。 |
| 能解析 `@fliwright/vitest` + `@fliwright/core` | 你的 `package.json` 依赖了它们；`fliwright init` 可以脚手架出一份配置。 |
| 直接 Vitest 使用 Fliwright runner | `vitest.config.ts` 合并了 `fliwrightPreset(projectConfig)`。 |
| app 稳定（没有崩溃循环） | 运行中的 app 屏幕可交互。 |

如果 `ext.fliwright.snap` 返回 `Unknown method …`，说明 app 用的是旧桥接。**别**在抖动的屏幕上继续点——先重启/重建 app。细节见
[troubleshooting.md](./troubleshooting.md)。

## 下一步去哪

- 了解 fixture 和 hooks → [test-harness.md](./test-harness.md)
- 定义可复用环境与已登录状态 → [scenarios.md](./scenarios.md)
- 稳定地定位控件 → [selectors.md](./selectors.md)
- 对可见结果做断言 → [assertions.md](./assertions.md)
- 复制完整模板 → [examples.md](./examples.md)
