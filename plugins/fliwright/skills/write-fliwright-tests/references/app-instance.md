# App 身份与能力（App Instance & Capabilities）

> 签名取自 `packages/fliwright-core/src/AppInstance.ts`、`packages/fliwright-core/src/Driver.ts` 与 Dart 端 `packages/fliwright-bridge/lib/src/extensions/app_instance.dart`；与源码不一致处以源码为准。

`driver.app`（一个 `AppInstance`）让脚本向运行中的 app 询问**身份**（id / name / environment）和显式注册的**能力**。已登录业务测试通过 [场景的 auth layer](./scenarios.md) 调用 app-owned `auth.seedLoggedIn`；普通业务 provider 的检查见 [state.md](./state.md)。

## 前置条件

- app 必须依赖当前 `fliwright_bridge`，并在 `kDebugMode` 下调用 `FliwrightBridge.init()`；`app_instance` 扩展由 `init()` 自动注册。
- handshake 里以 `appInstance: true` / `appCapabilities: true` 上报（`fliwright doctor` 或 `ext.fliwright.handshake` 能看到）。
- Dart 侧用 `FliwrightAppInstance.configure({...})` 声明身份、`FliwrightAppInstance.registerCapability(...)` 注册能力。不配置也能调 `info()`，只是拿到的字段会比较空。
- TS 侧通过 `driver.app` 访问（fixture 里直接解构 `driver`）。它**不**参与 VM Service URL 发现，只是连上之后的查询通道。

## TS API（`driver.app` — `AppInstance`）

```ts
class AppInstance {
  info(): Promise<AppInfo>;                                    // ext.fliwright.app.info
  getSnapshot<T>(): Promise<AppSnapshot & { snapshot: T }>;    // ext.fliwright.app.snapshot
  listCapabilities(): Promise<AppCapabilityDescriptor[]>;      // ext.fliwright.app.capabilities
  hasCapability(name: string): Promise<boolean>;
  getCapability<T>(name: string): Promise<AppCapabilityProxy<T> | undefined>;
  invoke<TIn, TOut>(capability: string, method: string, input?: TIn): Promise<TOut>;  // ext.fliwright.app.invoke
  capability<T>(name: string): AppCapabilityProxy<T>;          // 类型化 Proxy，任意方法调用 → invoke
}

interface AppInfo { id: string; name?: string; environment?: string; capabilities: string[]; }
interface AppSnapshot extends AppInfo { snapshot: Record<string, unknown>; }
interface AppCapabilityDescriptor { name: string; description?: string; methods: string[]; }
type AppCapabilityProxy<T> = T & { invoke(method: string, input?: unknown): Promise<unknown> };
```

| 方法 | 用途 |
| --- | --- |
| `info()` | 拿 app 身份（id / name / environment / 能力名列表） |
| `getSnapshot<T>()` | 身份 + app 自提供的 snapshot 负载（类型由调用方定） |
| `listCapabilities()` | 列出每个能力的名字、描述、可用方法 |
| `hasCapability(name)` | 快速判断某能力是否注册 |
| `getCapability<T>(name)` | 取一个类型化代理；不存在返回 `undefined` |
| `invoke(cap, method, input?)` | 直接调用某能力的某方法 |
| `capability<T>(name)` | 同 `getCapability`，但返回非空代理（假定存在） |

`capability<T>(name)` 返回一个类型化 Proxy，方法调用会转成 `invoke(name, method, input)`；类型参数不会在运行时注册或验证能力。框架自带 `AuthCapability` / `AuthStatus` 类型，场景认证契约为 `seedLoggedIn`、`clearSession` 和 `getStatus`。能力缺失或结果不符合认证状态时，应修复 app 测试入口。

## Dart 侧注册（被测 app）

```dart
import 'package:flutter/foundation.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

// 从 app 的 debug/test 入口调用，传入 app-owned 会话处理函数。
Future<void> configureFliwright({
  required FliwrightCapabilityMethod seedLoggedIn,
  required FliwrightCapabilityMethod clearSession,
  required FliwrightCapabilityMethod getStatus,
}) async {
  if (!kDebugMode) return;

  FliwrightAppInstance.configure(
    id: 'my-app',
    name: 'MyApp',
    environment: 'test',
  );

  FliwrightAppInstance.registerCapability(
    FliwrightAuthCapability(
      seedLoggedIn: seedLoggedIn,
      clearSession: clearSession,
      getStatus: getStatus,
    ),
  );

  await FliwrightBridge.init();
}
```

`seedLoggedIn` 必须通过 app 自己的会话机制创建测试身份，`getStatus` 返回真实的 `{isAuthenticated, userId?, roles?, metadata?}`；不要返回伪造成功或直接改 Riverpod auth provider。注册方法会出现在 `listCapabilities()` 中；其他 app 能力可用 `FliwrightAppCapability` 注册。`FliwrightBridge.reset()` 会清除已注册能力。首帧隔离还需要 [waiting bootstrap](./scenarios.md#首帧隔离)。

## 用法示例

**断言连的是对的 app / 环境**

```ts
import { expect as viExpect } from 'vitest';

test('connected to staging app', async ({ driver }) => {
  const info = await driver.app.info();
  viExpect(info.id).toBe('my-app');
  viExpect(info.environment).toBe('staging');
});
```

**读取场景准备后的认证状态**

```ts
import { test, expect } from '@fliwright/vitest';
import type { AuthStatus } from '@fliwright/core';
import { expect as viExpect } from 'vitest';

test.scenario('home.logged-in')('会话与账户入口就绪', async ({ driver, page }) => {
  const status = await driver.app.invoke<undefined, AuthStatus>('auth', 'getStatus');
  viExpect(status.isAuthenticated).toBe(true);
  await expect(page.getByKey('home.accountButton')).toBeVisible();
});
```

**读 app 自提供的 snapshot（特性开关等）**

```ts
const snap = await driver.app.getSnapshot<{ features: string[] }>();
viExpect(snap.snapshot.features).toContain('new-billing');
```

## 与 `driver.state` / mock 的分工

- `driver.app`：查询身份、能力与 app-owned 业务契约；认证前置状态交给场景协调器调用 `auth.seedLoggedIn`。
- `driver.state`：读写 Riverpod provider 的**值**（见 [state.md](./state.md)）。
- `driver.mock`：拦截 **HTTP** 请求并断言（见 [mocks.md](./mocks.md)）。

环境准备优先使用命名场景；测试正文通过 UI 验证用户行为，必要时读取 app 状态或检查 HTTP 请求。

## 排错

| 症状 | 原因 / 修复 |
| --- | --- |
| `driver.app.info()` 报 `Unknown method "ext.fliwright.app.info"` | app 跑的是旧桥接，没注册 `app_instance` 扩展；升级 `fliwright_bridge`、在 `init()` 前配置/注册，重建 app。 |
| `listCapabilities()` 返回空 | Dart 侧没调 `registerCapability(...)`，或调晚了（要在 `FliwrightBridge.init()` 之前）。 |
| `invoke(...)` 报能力/方法不存在 | 名字拼错；先 `listCapabilities()` 核对 `methods`。 |
| handshake 里没有 `appInstance`/`appCapabilities` | 桥接版本旧或没初始化；见 [troubleshooting.md](./troubleshooting.md)。 |

## 相关文档

- 桥接初始化 → [getting-started.md](./getting-started.md)
- 读写 provider 值 → [state.md](./state.md)
- 手动驱动与扩展 → [driver-lifecycle.md](./driver-lifecycle.md)
- mock 接口 → [mocks.md](./mocks.md)
