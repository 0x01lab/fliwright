# Plan: Dart 侧 MockRuleStore — 去掉 ToolMockServer，支持启动阶段 Mock

## Context

当前 mock 架构存在三个核心问题：

1. **启动阶段 API 无法 mock**：VSCode 通过 VM Service 注册 mock 规则，但 VM Service 在 App 启动后才可用。App 启动时的 API（登录、配置加载等）已经走了真实网络。
2. **不必要的 HTTP 跳板**：`FliwrightDioMockInterceptor` 拦截请求后，还要转发到 Node.js 侧的 `ToolMockServer` HTTP 服务器再返回——mock 数据完全可以放在 Dart 进程内存里。
3. **架构冗余**：请求路径 `Dio Interceptor → HTTP → Node ToolMockServer → HTTP response → Dio` 可以简化为 `Dio Interceptor → 内存查找 → 直接返回`。

**目标**：在 Dart 侧维护一个持久化的 mock 规则表，`DioMockInterceptor` 直接从内存查找并返回 mock 响应。VSCode 仅通过 VM Service 修改这个表。App 启动时即可从持久化存储加载规则，覆盖启动阶段 API。

---

## 架构变更总览

```
【之前】
VSCode → MockManager → ToolMockServer (Node HTTP) → configureFlutterController → DioMockInterceptor
                                                                    ↑ 转发到 ToolMockServer

【之后】
VSCode → MockManager → ext.fliwright.mock.addRoute (VM Service) → MockRuleStore (Dart 内存 + 持久化)
                                                                        ↑ DioMockInterceptor 直接读取
```

## 时序对比

```
【之前】
App 启动 → main() → API 调用（❌ 真实响应）
                    → FliwrightBridge.initForDioMock()
                    → VM Service 可用
                    → VSCode 连接 → startServer → configureController → addRoute
                    → API 调用（✅ mock 响应）

【之后】
App 启动 → main() → FliwrightBridge.initForDioMock()
                    → MockRuleStore.loadFromStorage() → ✅ 规则已加载
                    → API 调用（✅ mock 响应，包括启动阶段！）
                    → VM Service 可用
                    → VSCode 连接 → addRoute（可选的运行时修改）
```

---

## 具体变更

### 1. Dart 侧：新增 `MockRuleStore`

**新文件**: `packages/fliwright-bridge/lib/src/extensions/mock_rule_store.dart`

Dart 进程内的 mock 规则存储，替代 `MockServerExtension._routes` 和 `FliwrightDioMockInterceptor.routes`。

```dart
/// 可插拔的持久化存储接口
abstract class MockRuleStorage {
  Future<String?> load();       // 返回 JSON 字符串
  Future<void> save(String json);
}

/// 默认文件实现（零额外依赖，仅用 dart:io）
class FileMockRuleStorage implements MockRuleStorage {
  final String filePath;
  FileMockRuleStorage(this.filePath);
  // 用 dart:io File 读写 JSON
}

/// Mock 规则存储中心
class MockRuleStore {
  final Map<String, MockRoute> _routes = {};  // key: "METHOD path"
  final MockRuleStorage? _storage;

  MockRuleStore({MockRuleStorage? storage}) : _storage = storage;

  MockRoute? findRoute(String method, String path);
  void addRoute(MockRoute route);
  bool removeRoute({String? id, String? path, String? method});
  int clearRoutes();
  List<MockRoute> getAllRoutes();

  // 持久化
  Future<void> loadFromStorage();  // init 时调用
  Future<void> _persist();         // 每次 addRoute/removeRoute/clear 后调用
}
```

存储格式（JSON）：
```json
{
  "version": 1,
  "rules": [
    {
      "id": "1700000000000",
      "method": "GET",
      "pathPattern": "/v1/token",
      "status": 200,
      "headers": {"Content-Type": "application/json"},
      "body": {"token": "mock-123"},
      "delayMs": 0
    }
  ]
}
```

---

### 2. Dart 侧：简化 `FliwrightDioMockInterceptor`

**修改文件**: `packages/fliwright-bridge/lib/src/extensions/dio_mock_interceptor.dart`

变更：
- **删除** `controllerUrl` 字段和 `_forwardToController()` 方法
- **删除** 对 `controllerUrl` 环境变量 `FLIWRIGHT_MOCK_CONTROLLER_URL` 的读取
- `onRequest()` 直接从 `MockRuleStore` 查找规则并 resolve/reject
- 保留 `passthrough` 和 `callLog` 功能

简化后的 `onRequest` 逻辑：
```
onRequest(options, handler):
  route = mockRuleStore.findRoute(method, path)
  if route found:
    log call → resolve with mock response (with delay if set)
  else if passthrough:
    handler.next(options)  // 透传到真实服务器
  else:
    handler.reject(404)
```

---

### 3. Dart 侧：修改 `DioMockExtension` 使用 `MockRuleStore`

**修改文件**: `packages/fliwright-bridge/lib/src/extensions/dio_mock_extension.dart`

变更：
- 所有 handler（`_addRoute`, `_removeRoute`, `_clearRoutes`, `_listRoutes`, `_getCalls`, `_clearCalls`, `_debugState`）改为操作 `MockRuleStore` 实例
- `_setController` handler **删除**（不再需要 controller URL）
- `setInterceptor()` 简化为仅设置 callLog 引用
- `register()` 不再注册 `ext.fliwright.mock.setController`

---

### 4. Dart 侧：修改 `FliwrightBridge.initForDioMock()`

**修改文件**: `packages/fliwright-bridge/lib/src/bridge.dart`

变更：
- 创建 `MockRuleStore` 单例（接受可选的 `MockRuleStorage` 参数）
- 调用 `mockRuleStore.loadFromStorage()` 加载持久化规则
- 将 `MockRuleStore` 注入到 `DioMockExtension`
- 新增 `initForDioMock` 参数：

```dart
static Future<void> initForDioMock({
  dynamic router,
  MockRuleStorage? mockStorage,  // 🆕 可选持久化存储
}) async {
  // ... existing code ...
  final store = MockRuleStore(storage: mockStorage);
  await store.loadFromStorage();  // 从持久化加载规则
  DioMockExtension.register(_registry, store);  // 注入 store
  // 不再启动 HTTP server，不再设置 HttpOverrides
}
```

---

### 5. Dart 侧：统一 `MockServerExtension` 也使用 `MockRuleStore`

**修改文件**: `packages/fliwright-bridge/lib/src/extensions/mock_server.dart`

变更：
- `_routes` 列表替换为共享的 `MockRuleStore` 实例
- `_handleRequest()` 从 `MockRuleStore` 查找规则
- `startServer()` 后调用 `mockRuleStore.loadFromStorage()`
- 同样支持持久化，这样 HTTP 模式也能在启动时拦截

---

### 6. TypeScript Core 侧：简化 `MockManager`

**修改文件**: `packages/fliwright-core/src/MockManager.ts`

变更：
- `route()` 方法：直接通过 VM Service 发送完整规则数据（status, headers, body, delay）
- **删除** `remoteControllerUrl` 分支——不再需要 HTTP 跳板
- `configureFlutterController()` **标记为 deprecated**，空操作或抛 warning
- `startServer()` 仅在非 Dio 模式下需要

简化后的 `route()`:
```typescript
async route(path: string, response: MockRouteResponse & { method?: string }): Promise<void> {
  // 直接发送完整 mock 数据到 Dart 侧
  await this.sendRequest('ext.fliwright.mock.addRoute', {
    route: JSON.stringify({
      path,
      method: response.method,
      response: {
        status: response.status,
        headers: response.headers,
        body: response.body,
        delay: response.delay,
      },
    }),
  });
}
```

---

### 7. VSCode 侧：简化 `SandboxService`

**修改文件**: `packages/fliwright-vscode/src/sandbox/SandboxService.ts`

变更：
- `ensureController()`：不再需要启动 `ToolMockServer` 和配置 controller URL
- `applyRule()` 简化为：直接调用 `driver.mock.route()` 发送完整规则数据
- `resetController()` 简化（不再管理 controller URL 状态）
- 保留 `getAppliedRules()` 的内存追踪（用于 UI 显示）

---

### 8. 公共导出更新

**修改文件**: `packages/fliwright-bridge/lib/fliwright_bridge.dart`

新增导出：
- `MockRuleStore`
- `MockRuleStorage` (抽象接口)
- `FileMockRuleStorage` (默认实现)

---

## 关键文件清单

| 文件 | 变更类型 |
|------|---------|
| `packages/fliwright-bridge/lib/src/extensions/mock_rule_store.dart` | **新增** |
| `packages/fliwright-bridge/lib/src/extensions/dio_mock_interceptor.dart` | 重构 |
| `packages/fliwright-bridge/lib/src/extensions/dio_mock_extension.dart` | 重构 |
| `packages/fliwright-bridge/lib/src/extensions/mock_server.dart` | 重构 |
| `packages/fliwright-bridge/lib/src/bridge.dart` | 修改 init |
| `packages/fliwright-bridge/lib/fliwright_bridge.dart` | 更新导出 |
| `packages/fliwright-core/src/MockManager.ts` | 简化 |
| `packages/fliwright-vscode/src/sandbox/SandboxService.ts` | 简化 |
| `packages/fliwright-vscode/src/extension.ts` | 小改（移除 controller 相关逻辑） |

---

## 用户侧使用方式

```dart
// 方式 1: 使用默认文件持久化（推荐，零额外依赖）
await FliwrightBridge.initForDioMock(
  mockStorage: FileMockRuleStorage('.fliwright/mocks/.active-rules.json'),
);

// 方式 2: 使用 Hive（用户自定义实现 MockRuleStorage）
await FliwrightBridge.initForDioMock(
  mockStorage: HiveMockRuleStorage('fliwright_mock_rules'),
);

// 方式 3: 不持久化（纯内存，行为与当前一致）
await FliwrightBridge.initForDioMock();
```

---

## 验证方式

### 单元测试

- `MockRuleStore` 的 add/remove/clear/find/persist/load
- `FileMockRuleStorage` 的读写
- `FliwrightDioMockInterceptor` 不再转发到 controller

### 集成测试

- 使用 `exio_app` 验证：启动时 mock 规则自动生效
- VSCode 连接后修改规则，验证运行时切换仍正常

### VSCode 测试

- `SandboxService.test.ts` 验证不再启动 ToolMockServer
- `MockRuleSelectionStore.test.ts` 保持不变（VSCode 侧的选择记忆仍然有用）
