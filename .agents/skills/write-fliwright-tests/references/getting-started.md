# 快速开始

五步写一个 Fliwright 测试：接入桥接、启动 app、设置 VM URL、写 `.test.ts`、运行它。

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

任选一种方式（fixture 按以下优先级读取）：

```bash
# Option A — recommended env var
export FLIWRIGHT_VM_URL="http://127.0.0.1:54321/abc=/"

# Option B — compatibility alias (older docs)
export FLIWRIGHT_VM_SERVICE_URL="http://127.0.0.1:54321/abc=/"
```

如果两个都没设，测试会抛：

```
No VM Service URL provided. Set FLIWRIGHT_VM_URL or FLIWRIGHT_VM_SERVICE_URL,
or use createFliwrightTest({ vmServiceUrl }).
```

## 4. 写测试

一个用默认 `@fliwright/vitest` fixture 的最小测试：

```typescript
// counter.test.ts
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
- 在通过 CLI/MCP 运行时挂上失败上下文（截图 + 控件树 + 诊断信息 + 源码）。

自定义配置与生命周期控制见 [test-harness.md](./test-harness.md)。

## 5. 运行测试

通过 CLI（推荐——会产出 AI/人类可读报告、持久化截图、打印复现命令）：

```bash
fliwright run \
  --test path/to/counter.test.ts \
  --vm-url "ws://127.0.0.1:54321/abc=/ws" \
  --reporter ai-json
```

想做快速冒烟可以直接调 Vitest，但**拿不到持久化报告**，除非走 `fliwright run`：

```bash
FLIWRIGHT_VM_URL="ws://127.0.0.1:54321/abc=/ws" pnpm vitest run path/to/counter.test.ts
```

所有 flag 和 reporter 见 [cli.md](./cli.md)。

## 前置检查清单

| 要求 | 如何校验 |
| --- | --- |
| app 跑的是**当前**桥接 | `ext.fliwright.snap` 能响应（见 [screenshots-snapshots.md](./screenshots-snapshots.md)）。`fliwright doctor` 会检查能力。 |
| 已导出 VM Service URL | `echo $FLIWRIGHT_VM_URL` 非空。 |
| 能解析 `@fliwright/vitest` + `@fliwright/core` | 你的 `package.json` 依赖了它们；`fliwright init` 可以脚手架出一份配置。 |
| app 稳定（没有崩溃循环） | 运行中的 app 屏幕可交互。 |

如果 `ext.fliwright.snap` 返回 `Unknown method …`，说明 app 用的是旧桥接。**别**在抖动的屏幕上继续点——先重启/重建 app。细节见
[troubleshooting.md](./troubleshooting.md)。

## 下一步去哪

- 了解 fixture 和 hooks → [test-harness.md](./test-harness.md)
- 稳定地定位控件 → [selectors.md](./selectors.md)
- 对可见结果做断言 → [assertions.md](./assertions.md)
- 复制完整模板 → [examples.md](./examples.md)
