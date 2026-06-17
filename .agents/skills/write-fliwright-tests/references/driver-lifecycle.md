# 手动 Driver 生命周期（Manual Driver Lifecycle）

只有当 `@fliwright/vitest` 的 fixture 表达不了你的需求时，才考虑直接用原始
`FliwrightDriver`：**自定义插件**、**原始 VM Service 扩展**（`ext.fliwright.extractForm`、
`ext.fliwright.snapshot`）、**兼容旧版桥接**，或者刻意要做底层坐标测试。其余情况一律用 fixture。

## 基本生命周期

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FliwrightDriver } from '@fliwright/core';

let driver: FliwrightDriver;

describe('registration flow', () => {
  beforeAll(async () => {
    driver = new FliwrightDriver();
    await driver.connect(process.env.FLIWRIGHT_VM_URL!);
  });

  afterAll(async () => {
    await driver?.dispose();
  });

  it('does something', async () => {
    await driver.page.getByText('Submit').click();
  });
});
```

**务必**在 `afterAll` 里调用 `await driver.dispose()` 关闭 WebSocket。

## URL 转换

`flutter run` 有时会打印一个 **HTTP** 的 VM Service URL。`connect()` 需要的是以
`/ws` 结尾的 **WebSocket** URL。fixture 会自动转换；使用原始 driver 的脚本必须自己转：

```typescript
function toWsUrl(url: string): string {
  const converted = url.replace('http://', 'ws://').replace('https://', 'wss://');
  return converted.endsWith('/ws') ? converted : converted.replace(/\/?$/, '/ws');
}

await driver.connect(toWsUrl(process.env.FLIWRIGHT_VM_SERVICE_URL!));
```

## 条件跳过

当没有 URL 时，干净地跳过整组用例：

```typescript
const vmServiceUrl = process.env.EXIO_VM_SERVICE_URL ?? process.env.FLIWRIGHT_VM_SERVICE_URL;

describe.skipIf(!vmServiceUrl)('Exio app live E2E', () => {
  beforeAll(async () => { /* connect */ });
  // …
});
```

## `FliwrightDriver` 公共接口

| 成员 | 签名 | 用途 |
| --- | --- | --- |
| constructor | `new FliwrightDriver(options?: DriverOptions)` | `options.plugins` 在构造时注册插件 |
| `connect` | `connect(vmServiceUrl: string): Promise<void>` | 连接到 VM Service |
| `dispose` | `dispose(): Promise<void>` | 关闭连接 |
| `page` | `get page(): Page` | 懒加载的 `Page`（选择器/动作/导航/截图/表单） |
| `mock` | `get mock(): MockManager` | 懒加载的 `MockManager`（见 [mocks.md](./mocks.md)） |
| `healing` | `get healing(): SelfHealingEngine` | 懒加载的自愈引擎 |
| `recorder` | `get recorder(): RecorderController` | 用于代码生成的懒加载录制器 |
| `state` | `get state(): StateAdapter` | 懒加载的状态适配器（Riverpod，配置插件后可用） |
| `sdkVersion` | `get sdkVersion(): string \| null` | 解析得到的 Dart SDK 版本 |
| `sendRequest` | `sendRequest(method, params?): Promise<unknown>` | 对任意扩展的原始 JSON-RPC 调用 |
| `reloadSources` | `reloadSources(): Promise<unknown>` | 触发一次 Dart hot reload |
| `listenToDiagnostics` | `listenToDiagnostics(streamIds?): Promise<void>` | 订阅 Logging/Stdout/Stderr/Isolate |
| `getDiagnostics` | `getDiagnostics(options?): VMServiceEvent[]` | 读取已捕获的诊断事件 |
| `clearDiagnostics` | `clearDiagnostics(): void` | 重置诊断缓冲区 |
| registry getters | `getStateAdapter(name)`, `getMockAdapter(name)`, `getFinderStrategy(name)`, `getHealingStrategy(name)` | 插件查找 |
| lifecycle hooks | `notifyTestStart(name)`, `notifyTestEnd(name, result)` | 插件生命周期 |

## 原始扩展调用

用 `sendRequest` 可以直接调用任何 VM Service 扩展。这是你访问 `Page`/`Locator`
尚未封装的功能、以及支持旧版桥接的途径：

```typescript
// legacy form extraction (older bridge)
const { fields = [] } = await driver.sendRequest('ext.fliwright.extractForm') as { fields?: FormFieldMeta[] };

// legacy flat snapshot
const { widgets = [] } = await driver.sendRequest('ext.fliwright.snapshot') as { widgets?: LegacyWidget[] };

// type into a field by its extracted selector
await driver.sendRequest('ext.fliwright.type', {
  selector: field.selector,
  text: 'alice@example.com',
  replaceAll: 'true',
});

// make an HTTP request through the app's HttpClient to exercise the mock proxy
await driver.sendRequest('ext.fliwright.mock.testRequest',
  { url: 'http://test.local/api/ping', method: 'GET' });
```

`sendRequest` 返回的是扩展的原始响应；`success`/`error` 的约定因扩展而异，
所以要检查返回的形状：

```typescript
const result = await driver.sendRequest('ext.fliwright.type', { /* … */ }) as { success?: boolean; error?: string };
if (result.success === false || result.error) throw new Error(result.error);
```

## State / Riverpod

当 `fliwright-plugin-riverpod` 适配器已注册（或 app 使用 Riverpod 桥接）时，
`driver.state` 暴露出 provider 的读写：

```typescript
const adapter = driver.getStateAdapter('riverpod'); // or driver.state
await adapter.read('authProvider');
await adapter.write('authProvider', { user: { id: 1 } });
await adapter.listProviders();
```

用它来直接设置状态（已登录、预填充），而不必每个用例都走 UI 登录流程。完整操作集见
`@fliwright/plugin-riverpod` 文档。

## 自定义插件

在构造时传入插件；它们会注册状态适配器、mock 适配器、finder 策略或
自愈策略：

```typescript
import { FliwrightDriver } from '@fliwright/core';
import { riverpodPlugin } from '@fliwright/plugin-riverpod';

driver = new FliwrightDriver({ plugins: [riverpodPlugin()] });
await driver.connect(toWsUrl(process.env.FLIWRIGHT_VM_URL!));
```

## Tracing

当设置了 `FLIWRIGHT_TRACE`（`full` 或 `on-failure`）且设置了 `FLIWRIGHT_TRACE_DIR` 时，
fixture 会替换（shadow）`driver.sendRequest`，按进程级 `runId` 记录每次动作的 trace
（`TraceCollector` / `TraceStore`）。这只在 fixture 里接好了，原始 driver 脚本里
没有——如果你在原始 driver 里也需要，请自行复刻这套 `sendRequest` 的 shadow 逻辑。

## 什么时候该用 fixture（现实校验）

当你想要下面任何一项“免费”能力时，就用 fixture（`@fliwright/vitest`）：

- 共享 driver + 自动连接，
- 失败上下文（截图 + 控件树 + 诊断 + 源码 + 自愈建议），
- 带自愈的自动等待 `expect()`，
- trace 收集。

只有当这些都不重要、且你确实需要扩展级控制时，才下沉到原始 `FliwrightDriver`。
