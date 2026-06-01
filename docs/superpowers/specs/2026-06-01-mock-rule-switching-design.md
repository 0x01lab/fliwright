# Mock Rule Switching Design

**Date:** 2026-06-01
**Status:** Draft
**Scope:** fliwright-core (TypeScript), fliwright-mcp

## Problem

Mock API 配置文件 (`.fliwright/mocks/api/*.json`) 支持为每个 endpoint 定义多个 named rules（如 `success`、`empty`、`server_error`），但当前系统无法在运行时切换使用哪个 rule。MockManager 只支持每个 endpoint 一个响应，无法利用已有的多 rule 配置。

## Goal

实现运行时按 endpoint 独立切换 named rule 的能力，支持两种触发方式：

1. **编程 API** — MockManager 新增 `loadRules()` / `listRules()` / `switchRule()`
2. **MCP 工具** — `fliwright_mock_list` + `fliwright_mock_switch`

VS Code UI 不在本期范围，由 VS Code 扩展任务单独实现。

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  开发机 / Node.js 侧 (TS)                                │
│                                                          │
│  .fliwright/mocks/                                       │
│    mock-index.json  (defaultRule + files[])              │
│    api/*.json       (endpoint + rules[])                 │
│         ↓                                                │
│  MockRuleStore  — 解析、存储、管理 rule 状态               │
│         ↓ switch                                         │
│  MockManager.route()  — 发送选中 rule 的 response         │
│         ↓                                                │
│  VM Service JSON-RPC (ext.fliwright.mock.addRoute)       │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Flutter / Dart 侧 (零改动)                              │
│                                                          │
│  MockServerExtension / DioMockInterceptor                │
│    → 接收 route → 存为 MockRoute                          │
│    → 请求匹配 → 返回 response                             │
└─────────────────────────────────────────────────────────┘
```

**核心原则：Dart 端零改动。** 切换逻辑完全在 TS 侧，通过现有 `route()` 机制下发到 Flutter。

## Data Model

### TypeScript 新增类型

```typescript
/** Mock 文件中的一个 rule（与 JSON 格式一一对应） */
export interface MockRule {
  name: string;
  status: number;
  delay?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Mock endpoint 配置文件（对应 .fliwright/mocks/api/*.json） */
export interface MockEndpointConfig {
  version: number;
  name: string;
  description?: string;
  method: string;
  endpoint: string;
  rules: MockRule[];
}

/** Mock 索引文件（对应 .fliwright/mocks/mock-index.json） */
export interface MockIndex {
  version: number;
  defaultRule: string;
  files: string[];
}

/** 内存中的 endpoint rule 存储 */
export interface MockRuleEntry {
  endpoint: string;
  method: string;
  rules: Map<string, MockRule>;  // ruleName → rule
  activeRule: string;             // 当前活跃 rule name
}
```

### MockRuleStore

```typescript
export class MockRuleStore {
  private entries = new Map<string, MockRuleEntry>(); // endpoint → entry

  /** 从 .fliwright/mocks/ 加载 mock-index.json + 所有 endpoint 配置文件 */
  async loadFromDirectory(mockDir: string): Promise<void>;

  /** 列出所有 endpoint 及其可用 rules 和当前活跃 rule */
  listEndpoints(): Array<{
    endpoint: string;
    method: string;
    rules: string[];
    activeRule: string;
  }>;

  /** 切换 endpoint 的活跃 rule，返回该 rule 的 response 配置 */
  switchRule(endpoint: string, ruleName: string): MockRouteResponse | null;

  /** 将单个 endpoint 的当前活跃 rule 应用到 Flutter 端 */
  async applyEndpoint(mockManager: MockManager, endpoint: string): Promise<void>;

  /** 将所有 endpoint 的当前活跃 rule 批量应用到 Flutter 端 */
  async applyAll(mockManager: MockManager): Promise<void>;
}
```

### 核心流程

**启动加载：**

```
loadFromDirectory(".fliwright/mocks")
  1. 读取 mock-index.json → 得到 defaultRule + files[]
  2. 逐个读取 files[] → 解析为 MockEndpointConfig
  3. 存入 entries Map, activeRule = defaultRule
  4. 调用 applyAll(mockManager) → 逐个 route() 下发到 Flutter
```

**Rule 切换：**

```
switchRule("/v1/public/token", "empty")
  1. 更新 entry.activeRule = "empty"
  2. applyEndpoint(mockManager, endpoint)
  3. 内部调用 mockManager.route(endpoint, response) 覆盖 Flutter 端路由
```

## API Surface

### MockManager 扩展

```typescript
class MockManager {
  private ruleStore: MockRuleStore;

  /** 加载 .fliwright/mocks/ 配置并应用到 Flutter 端 */
  async loadRules(mockDir?: string): Promise<void>;

  /** 列出所有 endpoint 和可用 rules */
  listRules(): Array<{
    endpoint: string;
    method: string;
    rules: string[];
    activeRule: string;
  }>;

  /** 切换单个 endpoint 的 rule 并应用到 Flutter */
  async switchRule(endpoint: string, ruleName: string): Promise<void>;
}
```

### MCP Tools

| Tool | 参数 | 说明 |
|------|------|------|
| `fliwright_mock_list` | 无 | 列出所有 endpoint、可用 rules 和当前活跃 rule |
| `fliwright_mock_switch` | `{ endpoint: string, ruleName: string }` | 切换指定 endpoint 的 rule |

MCP 工具内部调用 MockManager 的 `listRules()` 和 `switchRule()`。

## File Changes

### 新增文件

| 文件 | 说明 |
|------|------|
| `packages/fliwright-core/src/MockRuleStore.ts` | 规则解析、存储、切换核心逻辑 |
| `packages/fliwright-core/tests/MockRuleStore.test.ts` | MockRuleStore 单元测试 |
| `packages/fliwright-mcp/src/tools/mockTools.ts` | MCP tool 定义 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `packages/fliwright-core/src/types.ts` | 新增 MockRule, MockEndpointConfig, MockIndex, MockRuleEntry 类型 |
| `packages/fliwright-core/src/MockManager.ts` | 增加 loadRules/listRules/switchRule 方法 |
| `packages/fliwright-core/tests/MockManager.test.ts` | 补充新方法测试 |
| `packages/fliwright-mcp/src/index.ts` | 注册新 MCP tools |

### 不改动

- Dart 端 `mock_server.dart` — 零改动
- Dart 端 `dio_mock_interceptor.dart` — 零改动
- 现有 `route()` / `removeRoute()` 等基础方法 — 保持不变

## Loading Behavior

- `loadFromDirectory()` 在 Fliwright driver 初始化时自动调用
- 默认路径：项目根目录下 `.fliwright/mocks/`
- 目录不存在或为空时静默跳过（不报错）
- `mock-index.json` 不存在时同样静默跳过

## Error Handling

- JSON 解析失败：记录警告，跳过该文件，继续处理其他文件
- ruleName 不存在：`switchRule()` 抛出明确错误（列出可用 rules）
- endpoint 不存在：`switchRule()` 抛出明确错误（列出已注册 endpoints）
- 未调用 `loadRules()` 就调用 `listRules()` / `switchRule()`：返回空列表 / 抛错提示先加载

## Testing

- **MockRuleStore 单元测试**：JSON 解析、rule 切换、错误处理
- **MockManager 集成测试**：loadRules → listRules → switchRule 完整流程
- **E2E 测试**：使用 `.fliwright/mocks/` 中的示例配置验证端到端切换
