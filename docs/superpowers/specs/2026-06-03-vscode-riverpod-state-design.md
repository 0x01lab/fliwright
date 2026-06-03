# VS Code Riverpod 状态面板设计

**日期：** 2026-06-03
**状态：** 草案
**范围：** 补全 `packages/fliwright-vscode` 中的 Riverpod 状态工作流
**相关文档：**
- `docs/superpowers/specs/2026-05-31-vscode-extension-design.md`
- `docs/superpowers/specs/2026-05-28-fliwright-mvp-v1-design.md`
- `docs/superpowers/specs/2026-05-29-slice3-mock-loop-design.md`

---

## 1. 完成度评估

VS Code 插件目前已经有一个局部的 Riverpod 状态入口，但功能尚未完成。

当前已实现：

- `packages/fliwright-vscode/package.json` 中已经贡献了 `fliwright.state` 树视图。
- 已存在以下命令：
  - `fliwright.refreshStateProviders`
  - `fliwright.readStateProvider`
  - `fliwright.overrideStateProvider`
- `StateTreeProvider` 可以渲染 provider 行和空状态提示。
- `StateInjectionService` 会直接调用 VM Service 扩展：
  - `ext.fliwright.riverpod.list`
  - `ext.fliwright.riverpod.read`
  - `ext.fliwright.riverpod.override`
- 已有针对直接服务调用的单元测试。

当前未完成或不稳定的部分：

- `FliwrightSession` 使用 `new FliwrightDriver()` 创建 driver，没有注册 `@fliwright/plugin-riverpod`；VS Code 绕过了公开的 `driver.state` 适配器。
- `@fliwright/vscode` 还没有依赖 `@fliwright/plugin-riverpod`，因此无法在不改依赖的情况下使用 Riverpod 适配器。
- `StateInjectionService` 会把 bridge 返回的 `{ error: ... }` 当作成功结果处理。
- 覆盖 provider 时没有检查成功语义；当前 Dart bridge 可以返回 `overridden: false`，但 VS Code 仍会提示成功。
- VS Code 侧没有 watch/unwatch 命令，也没有实时刷新路径。
- Provider 行没有持久的最近读取、最近覆盖、错误状态或 container readiness 状态。
- Dart 侧 `RiverpodExtension` 对真实 provider 的发现、读取和覆盖仍是骨架实现：
  - `list` 在 container 存在时仍返回空 provider 列表。
  - `read` 返回 `found: false` 和 `value: null`。
  - `override` 返回 `overridden: false`。
  - `watch` 只在本地记录名称，不会发出 Riverpod 状态变化事件。
- 还没有针对 `examples/riverpod_demo` 的 VS Code 集成测试。

结论：VS Code 已经具备 UI 占位和命令接线，但面向用户的 Riverpod 端到端工作流还没有完成。

---

## 2. 产品目标

为 Flutter 开发者提供一个可靠的 VS Code 侧边栏，用于在运行中的 debug app 中检查和操作 Riverpod 状态。

完成后的工作流应允许用户：

1. 连接到运行中的 Flutter VM Service。
2. 查看 Fliwright bridge 和 Riverpod container 是否可用。
3. 列出已注册或可调试的 providers。
4. 读取选中 provider 的值。
5. 用 JSON 值覆盖支持覆盖的 providers。
6. 监听选中的 providers，并在树视图中看到值变化。
7. 当 app 侧 bridge 不支持某项操作时，能看到明确说明。

这仍然是一个本地 debug 工具。它不应替代 Riverpod DevTools，也不应要求生产环境插桩。

---

## 3. 非目标

- 不支持 release mode Flutter app。
- 不在没有显式 app 侧注册的情况下自动修改任意 provider 实现。
- 不做云同步、遥测或外部服务调用。
- 本阶段不实现通用 Bloc/Provider 支持。
- 不构建大型自定义 webview 仪表盘；MVP 应使用 VS Code 原生 tree view、Quick Pick 和 Input Box 流程。

---

## 4. 架构

### 4.1 推荐调用路径

VS Code 应使用与测试和库消费者相同的适配器 API：

```text
VS Code command
  -> StateInjectionService
  -> FliwrightDriver.state
  -> RiverpodStateAdapter
  -> VMServiceConnector
  -> ext.fliwright.riverpod.*
  -> Dart RiverpodExtension
```

必要的包改动：

- 在 `@fliwright/vscode` 中添加 `@fliwright/plugin-riverpod` workspace 依赖。
- 在 `FliwrightSession` 中导入 `riverpodPlugin`。
- 以如下方式构造 driver：

```ts
new FliwrightDriver({ plugins: [riverpodPlugin()] })
```

继续保留 `FliwrightSessionOptions.createDriver`，用于测试和自定义注入。

### 4.2 服务边界

`StateInjectionService` 不应了解 Riverpod VM Service 方法名。它应消费 `StateAdapter`：

```ts
export class StateInjectionService {
  async listProviders(driver: FliwrightDriver): Promise<StateProviderEntry[]>;
  async read(driver: FliwrightDriver, key: string): Promise<unknown>;
  async override(driver: FliwrightDriver, key: string, value: unknown): Promise<StateOverrideResult>;
  async watch(driver: FliwrightDriver, key: string, onChange: StateChangeCallback): Promise<() => void>;
}
```

适配器继续负责把这些调用转换为 `ext.fliwright.riverpod.*`。

### 4.3 响应归一化

Riverpod bridge 响应需要显式错误处理。任何带有 `error` 字符串的响应都应转换成 `Error`，并带有简洁的用户可读消息。

推荐结果形状：

```ts
export interface StateProviderEntry {
  kind: 'stateProvider';
  key: string;
  name?: string;
  type?: string;
  value?: unknown;
  readable: boolean;
  overridable: boolean;
  watching?: boolean;
  lastUpdatedAt?: number;
  error?: string;
}

export interface StateOverrideResult {
  provider: string;
  overridden: boolean;
  value?: unknown;
  message?: string;
}
```

VS Code 只有在 `overridden === true` 时才应显示“已覆盖 provider”的成功提示。

---

## 5. App 侧 Bridge 合约

Dart bridge 应优先使用 `ProviderObserver` 做低侵入的 provider 观察。Observer 可以被挂到 `ProviderScope` / `ProviderContainer`，被动接收 provider 的创建、更新和销毁事件，因此适合实现 provider 发现、值缓存和状态变化通知。

但 `ProviderObserver` 本身是观察机制，不是通用写入机制。它不能保证在运行时覆盖任意 provider，也不能自动知道复杂对象如何 JSON 序列化。因此设计应采用混合模式：

1. `ProviderObserver` 负责自动发现、list/read 缓存、watch 事件。
2. 可选 debug registry 只负责覆盖能力、稳定 key 和自定义 encode/decode。
3. 正式业务代码只需要在 debug/test 入口注入一个 observer；业务 provider 定义不需要被 Fliwright 包装。

### 5.1 最小侵入接入方式

推荐新增一个 Riverpod 专用 bridge 包或适配模块，例如 `fliwright_bridge_riverpod`。原因是当前 `fliwright_bridge` 没有依赖 `flutter_riverpod` / `riverpod`，直接在主 bridge 包中实现 `ProviderObserver` 会让所有用户都被迫引入 Riverpod 依赖。

推荐用法：

```dart
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge_riverpod/fliwright_bridge_riverpod.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  FliwrightBridge.ensureInitialized();

  runApp(
    ProviderScope(
      observers: kDebugMode ? [FliwrightRiverpodObserver()] : const [],
      child: const MyApp(),
    ),
  );
}
```

如果不想改正式 `main.dart`，可以把注入放在 `test_driver/fliwright_app.dart` 或 debug-only app entrypoint 中，但前提是正式 app 没有在内部再创建一个不可观察的嵌套 `ProviderScope`。如果正式 app 已经在 `main.dart` 中创建根 `ProviderScope`，最稳妥的最小改动是在这个根 `ProviderScope` 上追加 observer。

### 5.2 Observer 能力

`FliwrightRiverpodObserver` 负责维护一个运行时快照：

```dart
class ObservedRiverpodProvider {
  final String key;
  final String displayName;
  final String providerType;
  final Object provider;
  Object? previousValue;
  Object? currentValue;
  DateTime? addedAt;
  DateTime? updatedAt;
  DateTime? disposedAt;
  bool disposed;
}
```

Observer 生命周期方法映射：

| Observer event | Fliwright 行为 |
|----------------|----------------|
| `didAddProvider` | 记录 provider，缓存初始值，必要时发出 added 事件。 |
| `didUpdateProvider` | 更新缓存，若该 provider 正在 watch，则发出 `riverpod.stateChanged`。 |
| `didDisposeProvider` | 标记 provider 已释放，刷新 list 状态。 |
| `providerDidFail` | 记录错误并向 VS Code 暴露。 |

Provider key 生成规则：

1. 优先使用 Riverpod provider 的 `name`。代码生成 provider 通常会自动有 name。
2. 没有 name 时使用 `context.provider.toString()` 作为显示 key。
3. 如果用户在 registry 中为同一个 provider 注册了 alias，则使用 alias 作为稳定 key。
4. key 冲突时追加短 hash，避免 VS Code 列表覆盖。

### 5.3 List/Read/Watch 语义

Observer 模式下，`list` 和 `read` 的语义是“已被当前 container 初始化或更新过的 providers”，不是静态枚举全项目所有 provider。

| Method | 行为 |
|--------|------|
| `ext.fliwright.riverpod.status` | 返回 observer 是否已安装、container 是否可见、已观察 provider 数量。 |
| `ext.fliwright.riverpod.list` | 返回 observer 缓存中的 providers。 |
| `ext.fliwright.riverpod.read` | 从 observer 缓存读取指定 provider 的最近值；若缓存没有则返回 `found: false`。 |
| `ext.fliwright.riverpod.watch` | 将 key 加入 active watch 集合；后续 `didUpdateProvider` 发出事件。 |
| `ext.fliwright.riverpod.unwatch` | 从 active watch 集合移除 key。 |

这意味着未被 UI 或业务逻辑触发过的 lazy provider 不会出现在 list 中。VS Code 应把这类情况说明为“尚未初始化/尚未观察到”，而不是 bridge 错误。

### 5.4 Override/Write 补充 Registry

运行时覆盖仍建议使用显式 debug registry，因为 Observer 无法通用地写入所有 provider。

可选 registry：

```dart
class FliwrightRiverpodProvider<T> {
  final String key;
  final String? type;
  final ProviderListenable<T> provider;
  final T Function(Object? json)? decode;
  final Object? Function(T value)? encode;
}
```

Registry 用法：

```dart
FliwrightBridge.ensureInitialized();
RiverpodExtension.registerProvider(
  key: 'counterProvider',
  provider: counterProvider,
  decode: (json) => json as int,
);
```

当 provider 在 registry 中声明了写入方式时，`override` 才可用。对于 `StateProvider`，registry 可以提供一个 setter；对于 `NotifierProvider` / `StateNotifierProvider`，registry 可以提供自定义 write 函数；对于只读 `Provider`，应返回不支持。

`override` 语义：

| Provider 类型 | 默认策略 |
|---------------|----------|
| Observer-only provider | 不支持写入，返回 `overridden: false`。 |
| Registry provider + write 函数 | 调用 write 函数。 |
| Registry provider + decode/encode | 使用 decode 解析 JSON 输入，更新后使用 encode/list 缓存展示。 |
| 只读 Provider | 不支持写入，返回明确 message。 |

对于不支持操作的 provider，bridge 必须返回明确消息：

```json
{
  "provider": "authProvider",
  "overridden": false,
  "message": "Provider is not registered as overridable."
}
```

---

## 6. VS Code UX

### 6.1 State 视图

树视图状态：

| 状态 | 树内容 |
|------|--------|
| 未连接 | `Connect to a Flutter app and refresh providers` |
| Bridge 缺失 | `Fliwright bridge extension not available` |
| Container 缺失 | `ProviderContainer not found` |
| 尚未观察到 providers | `No Riverpod providers observed yet` |
| 就绪 | 带有类型、值和状态的 provider 行 |

Provider 行：

- Label：provider key。
- Description：type 或 value preview。
- Tooltip：完整 JSON 值、最近更新时间、支持能力标记。
- Icon：
  - 普通行使用 `symbol-variable`。
  - 正在 watch 的行使用 `eye` 或上下文标记。
  - 有错误的行使用 `warning`。

### 6.2 命令

保留已有命令：

- `fliwright.refreshStateProviders`
- `fliwright.readStateProvider`
- `fliwright.overrideStateProvider`

新增命令：

- `fliwright.watchStateProvider`
- `fliwright.unwatchStateProvider`
- `fliwright.copyStateProviderValue`
- `fliwright.openRiverpodSetupHelp`

命令行为：

- Refresh 应调用 status/list，并在 readiness 错误时更新 state 消息。
- Read 应只更新选中的 provider 行。
- Override 应先校验 JSON 输入，再调用 adapter。
- Watch 应让该行保持实时更新，直到 unwatch 或 disconnect。
- Disconnect 应释放所有活跃的 provider watchers。

### 6.3 消息

通知保持简短：

- `Loaded 4 provider(s).`
- `counterProvider = 2`
- `Overrode counterProvider.`
- `Provider is not registered as overridable.`

完整响应细节写入 `Fliwright` OutputChannel。

---

## 7. 实施计划

### RS-1：通过 Riverpod Plugin 接入 VS Code

- 给 `packages/fliwright-vscode/package.json` 添加 `@fliwright/plugin-riverpod` 依赖。
- 更新 `FliwrightSession` 默认 driver factory，注册 `riverpodPlugin()`。
- 重构 `StateInjectionService`，改为使用 `driver.state`。
- 保持测试可以注入 fake `FliwrightDriver`。

验收标准：

- VS Code state 命令通过 `StateAdapter` 工作。
- 单元测试证明 `FliwrightSession` 默认创建带 plugin 的 driver，或暴露可注入 factory。

### RS-2：增强 State Service 和 Tree

- 归一化 bridge/adapter 错误。
- 在 `StateTreeProvider` 中跟踪每个 provider 的状态。
- 在发起 VM 调用前拒绝无效 override JSON。
- 把 `overridden: false` 显示为 warning，而不是成功。

验收标准：

- `{ error: "ProviderContainer not found" }` 会作为用户可见错误展示。
- Override 失败时不显示成功通知。
- 读取一个 row 时不会丢掉其他 providers。

### RS-3：添加 Watch/Unwatch

- 添加 watch/unwatch 命令和菜单项。
- 在 extension activation scope 中保存 unsubscribe callbacks。
- 在 disconnect/deactivate 时释放 watchers。
- 根据 `riverpod.stateChanged` 事件更新 provider 行。

验收标准：

- Watch 一个 provider 后，状态变化事件会更新对应行。
- Unwatch 会移除活跃订阅。
- Disconnect 会清理所有 active watches。

### RS-4：补全 Dart Riverpod Observer Bridge

- 新增 `FliwrightRiverpodObserver`，基于 `ProviderObserver` 捕获 provider 生命周期。
- 在 observer 中维护 provider 快照缓存：key、displayName、type、currentValue、previousValue、timestamps、error、disposed。
- 用 observer 缓存实现 `status`、`list`、`read`。
- 用 observer 的 `didUpdateProvider` 实现 watched provider 的事件发出。
- 增加可选 debug registry，仅用于稳定 alias、自定义序列化和明确可写 provider。
- 更新 `examples/riverpod_demo`，在 debug/test 入口把 observer 注入到根 `ProviderScope`。
- 为 `counterProvider` 增加可选 registry write 示例，用于验证 override；普通 observer-only providers 仍应可 list/read/watch。

验收标准：

- `examples/riverpod_demo` 的 `list` 能返回已初始化/已更新过的 providers。
- `read(counterProvider)` 能返回 observer 缓存的当前 counter。
- `watch(counterProvider)` 能在点击 increment 后发出状态变化事件。
- `override(counterProvider, 2)` 对 registry 声明可写的 provider 生效；对 observer-only provider 返回明确的不支持消息。
- 正式业务 provider 定义不需要被 Fliwright 包装或改写。

### RS-5：测试和人工验证

- 扩展 `StateInjectionService.test.ts`，覆盖错误和 `override false`。
- 扩展 `TreeProviders.test.ts`，覆盖 state row 状态渲染。
- 在 `FliwrightSession.test.ts` 中添加 plugin wiring 覆盖。
- 为 Dart observer bridge 和可选 registry 行为添加测试。
- 增加基于 `examples/riverpod_demo` 的 VS Code 人工 smoke checklist。

人工 smoke：

1. 通过 `test_driver/fliwright_app.dart` 运行 `examples/riverpod_demo`。
2. 从 VS Code 连接。
3. Refresh State。
4. Read `counterProvider`。
5. 用 `2` Override `counterProvider`。
6. Watch `counterProvider`，在 app 中点击 increment，确认树行更新。
7. Unwatch 并断开连接。

---

## 8. 风险和待决策项

| 主题 | 需要决定 |
|------|----------|
| Provider 发现语义 | 使用 `ProviderObserver` 被动发现已初始化/已更新 providers，不承诺静态列出全项目 provider。 |
| Provider override 语义 | Observer 只负责观察；写入仍需可选 debug registry 或用户提供 write 函数。 |
| 值序列化 | 非基本类型要求提供 JSON-safe encode/decode 函数。 |
| Provider families | 优先使用 observer 生成的实际实例 key；需要稳定 key 时使用 registry alias，例如 `userProvider(42)`。 |
| 自动刷新 | MVP 不做 polling；使用 watch events。 |
| 多根 workspace | State 命令绑定当前连接的 VM session，而不是 workspace folder。 |
| Bridge 版本化 | 在依赖更丰富行为前先添加 status 方法。 |
| 包依赖侵入性 | 优先新增 Riverpod 专用 bridge 适配包，避免主 `fliwright_bridge` 强制依赖 Riverpod。 |

---

## 9. 完成定义

VS Code Riverpod 功能在满足以下条件后才算完成：

- VS Code 使用 `@fliwright/plugin-riverpod` 和 `driver.state`。
- State tree 能准确展示 readiness、providers、values、errors 和 watch 状态。
- Read/watch/unwatch 可以对 `examples/riverpod_demo` 中通过 observer 发现的 provider 工作。
- Override 可以对 registry 明确声明可写的 provider 工作。
- 不支持的 provider 操作返回明确 warning，而不是错误的成功提示。
- 单元测试覆盖 service 行为、tree 渲染和 session plugin wiring。
- Dart bridge 测试覆盖 observer 的 list/read/watch 行为，以及可选 registry 的 override 行为。
- 人工 smoke 测试记录在扩展 README 或 release checklist 中。
