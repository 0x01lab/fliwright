# App 身份与能力（App Instance & Capabilities）

> 签名取自 `packages/fliwright-core/src/AppInstance.ts`、`packages/fliwright-core/src/Driver.ts` 与 Dart 端 `packages/fliwright-bridge/lib/src/extensions/app_instance.dart`；与源码不一致处以源码为准。

`driver.app`（一个 `AppInstance`）让脚本越过 widget 树，直接向运行中的 app 询问**身份**（id / name / environment）和**能力**（app 自行注册的命名 RPC，如 `auth.signIn`）。它解决的是「这个 app 是谁、它能干什么」这类靠 UI 推断很脆的问题——和 `driver.state`（读写 provider 值）互补：`state` 动的是数据，`app` 问的是身份与能力。

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

`capability<T>('auth')` 返回一个 Proxy：你在 TS 里定义 `interface Auth { signIn(i: { email: string }): Promise<{ userId: string }> }`，就能写 `await driver.app.capability<Auth>('auth').signIn({ email })`，Proxy 会把它翻译成 `invoke('auth', 'signIn', { email })`。框架自带 `AuthCapability` / `AuthStatus` 类型（`getStatus()` / `signIn?` / `signOut?`）可作为 auth 能力的约定形状。

## Dart 侧注册（被测 app）

```dart
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  // 1. 声明 app 身份 + 自定义 snapshot
  FliwrightAppInstance.configure(
    id: 'exio',
    name: 'Exio',
    environment: const String.fromEnvironment('ENV', defaultValue: 'dev'),
    snapshot: () async => {'buildNumber': buildNumber, 'features': enabledFeatures},
  );

  // 2. 注册测试专用能力（要在 init() 之前）
  FliwrightAppInstance.registerCapability(
    FliwrightAppCapability(
      name: 'auth',
      description: 'Test-only auth shortcuts',
      methods: {
        'signIn': (input) async {
          final email = (input as Map?)?['email'] as String?;
          // ... 建立会话 ...
          return {'userId': 'u1'};
        },
        'signOut': (_) async => true,
      },
    ),
  );

  // 3. 照常初始化桥接（debug 构建里）
  if (kDebugMode) {
    await FliwrightBridge.init();
  }
}
```

注册的方法会出现在 `listCapabilities()` 的 `methods` 里，并能被 `invoke('auth', 'signIn', {...})` 调到。`FliwrightBridge.reset()` 会清掉已注册的能力（等价于 `FliwrightAppInstance.reset()`）。也可以用 `FliwrightAppCapability(...).registerMethod(name, handler)` 逐个挂方法。

## 用法示例

**断言连的是对的 app / 环境**

```ts
import { expect as viExpect } from 'vitest';

test('connected to staging exio', async ({ driver }) => {
  const info = await driver.app.info();
  viExpect(info.id).toBe('exio');
  viExpect(info.environment).toBe('staging');
});
```

**用能力跳过登录，直接进入受保护页面**

```ts
interface Auth { signIn(i: { email: string }): Promise<{ userId: string }> }

test('signed-in user sees dashboard', async ({ driver, page, expect }) => {
  const auth = await driver.app.getCapability<Auth>('auth');
  await auth?.signIn({ email: 'tester@example.com' });

  await page.navigate('/dashboard');
  await expect(page.getByText('Dashboard')).toBeVisible();
});
```

**读 app 自提供的 snapshot（特性开关等）**

```ts
const snap = await driver.app.getSnapshot<{ features: string[] }>();
viExpect(snap.snapshot.features).toContain('new-billing');
```

## 与 `driver.state` / mock 的分工

- `driver.app`：问「这个 app 是谁、能做什么」；调 app 暴露的测试专用 RPC（如 `auth.signIn`）。
- `driver.state`：读写 Riverpod provider 的**值**（见 [state.md](./state.md)）。
- `driver.mock`：拦截 **HTTP** 请求并断言（见 [mocks.md](./mocks.md)）。

优先级：能用 `driver.app` 的能力入口就别用坐标/UI 硬点；要造数据用 `state`；要 stub 网络用 `mock`。

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
