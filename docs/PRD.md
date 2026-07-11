# Fliwright 产品需求文档 (PRD)

**版本**：v1.1  
**日期**：2026年6月1日  
**作者**：项目团队  
**状态**：已更新（同步代码实现状态）

---

## 1. 引言

### 1.1 背景与机遇
在 2026 年，AI 辅助编码（Cursor、GitHub Copilot、Claude Code 等）使代码生成门槛大幅降低。程序员的角色已从"写代码"转变为"把控 AI 生成代码的质量"。传统的 Flutter 端到端测试工具（如已废弃的 `flutter_driver`、官方的 `integration_test` 和社区的 Patrol）在 AI 时代暴露出严重短板：编写繁琐、对 AI Agent 亲和度低、缺乏智能自愈能力、难以无缝融入 AI 研发闭环。

Fliwright 是一款针对 Flutter 生态的下一代自动化测试框架，定位为"AI 时代质量把控工作站"。它提供类 Playwright 的声明式 API、零侵入架构、智能自愈引擎、可复用的表单助手，并原生集成 MCP 协议，让 AI Agent 能够直接调用测试、理解失败并自动修复问题。

### 1.2 产品愿景
成为 Flutter 领域 AI 驱动的端到端测试基础设施，让 AI 生成的代码在秒级内得到可靠验证，实现"代码生成 → 自动化测试 → 失败反馈 → 自动修复"的完整闭环。

### 1.3 文档范围
本文档详细描述 Fliwright 的核心功能、技术架构、模块设计、可行性分析及商业价值，并标注各功能的实际实现状态。为后续开发提供蓝图。

---

## 2. 产品概述

### 2.1 产品定义
Fliwright 是一个面向 Flutter 应用的跨语言（TypeScript/JavaScript + Dart）测试框架，通过远程控制 Dart VM Service 实现对 Flutter 应用的零侵入操作，提供录制、AI 生成用例、智能断言、内置 Mock 环境、失败自愈等能力，并可作为 MCP Server 与 AI 编码工具深度集成。

### 2.2 核心差异化优势
- **AI 原生架构**：所有功能封装在 SDK (`@fliwright/core`) 中，CLI、VS Code 插件、Electron 壳仅作为轻量封装，AI Agent 可通过编程接口直接调用。
- **零侵入**：通过编译期条件注入测试入口，不污染业务代码。
- **智能自愈引擎**：测试因 UI 微调失败时，自动通过多维特征匹配找到目标组件并继续执行，同时生成修复建议。
- **声明式沙箱**：支持网络 Mock、状态注入，无需修改业务逻辑。
- **表单助手**：可复用模块，自动识别表单语义并生成合规假数据，支持自定义 Skill 和 AI 生成的 JSON 规则。
- **Vitest 原生集成**：通过 `@fliwright/vitest` 提供开箱即用的 Vitest 测试集成，自动管理 Driver 生命周期与失败上下文。
- **可扩展插件系统**：通过 Plugin 注册表支持 StateAdapter、MockAdapter、FinderStrategy、HealingStrategy 等多种扩展点。

### 2.3 目标用户
- 使用 AI 生成 Flutter 代码的独立开发者和团队。
- 需要维护大规模 Flutter 应用、频繁回归测试的 QA 与开发团队。
- 希望将自动化测试集成到 AI 编码工作流（Cursor/Claude Code）的开发者。

---

## 3. 功能需求

> **状态标记说明**：✅ 已实现 | 🔄 部分实现 | ❌ 未实现 | 📋 规划中

### 3.1 测试用例录制 (Codegen) — ✅ 已实现
- **描述**：开发者在模拟器/真机上操作 App 时，工具自动生成可维护的声明式测试脚本（TS/Dart）。
- **技术实现**：通过 Dart VM Service 监听指针事件，逆向解析点击坐标对应的 Widget 树，提取语义特征（文本、Key、类型）生成选择器代码。
- **输出**：纯净的 TypeScript/Dart 测试脚本，支持一键插入编辑器。
- **已实现能力**：
  - `RecorderController`：录制生命周期管理（start/stop）
  - `EventAggregator`：原始事件流聚合为语义化操作序列
  - `SelectorResolver`：智能选择器解析与生成
  - 双语言代码生成：`CodeGenerator`（TypeScript）+ `DartCodeGenerator`（Dart）
  - `AssertionSuggester`：基于操作模式识别，自动推荐断言插入点

### 3.2 AI 生成测试用例 — ✅ 已实现
- **描述**：基于 Flutter 源码，AI 自动生成覆盖边界条件的测试用例。
- **输入**：Flutter Dart 源码文件。
- **技术实现**：通过 MCP 工具 `fliwright_generate_test` 解析 Flutter 源码，提取 Widget 语义（按钮、输入框、AppBar 等），自动生成符合 Fliwright API 规范的测试脚本。
- **已实现能力**：
  - Dart 源码解析与 Widget 提取
  - 语义类型推断（从 `keyboardType`、`hintText` 等属性推断字段类型）
  - 自动选择器生成
  - MCP 工具集成

### 3.3 测试失败上下文传递给 AI Agent — ✅ 已实现
- **描述**：测试失败时，结构化打包错误信息并通过 MCP 协议反馈给 AI 编码工具。
- **反馈内容**：
  - 失败时的屏幕截图（支持自定义像素比）
  - Widget 树 JSON 快照（优先使用 `ext.fliwright.snapshot`，回退到 `ext.fliwright.inspect`）
  - 关联的 Flutter 源代码文件和行号（从错误堆栈提取）
  - 自愈引擎的修复建议（原始选择器 → 建议选择器、置信度、各维度评分）
- **已实现组件**：
  - `FailureCollector`：结构化失败上下文收集器，并行采集截图/Widget树/源码
  - `@fliwright/vitest`：自动在测试失败时写入 MCP 失败上下文 JSON 文件
  - MCP 工具 `fliwright_get_failure`：供 AI Agent 查询失败详情

### 3.4 Mock 环境搭建 (Fliwright Sandbox) — 🔄 部分实现
- **描述**：为 Flutter 应用提供多层 Mock 能力。
- **已实现（网络层）** ✅：
  - 内置 HTTP Mock 服务器，支持路由规则声明
  - `MockManager`：路由添加/删除/清空、透传模式、调用记录查询
  - Dart 端 `mock_server` 扩展：拦截应用内 HTTP 请求
  - 支持响应延迟模拟、自定义状态码和响应头
  - 本地 Mock 配置统一存放在项目根目录 `.fliwright/mocks/`，支持按 API endpoint 拆分 JSON 文件
  - 每个 API Mock JSON 文件描述一个接口和多组命名响应规则，便于 VS Code 插件、CLI 和测试用例选择不同场景
  - Mock 数据统一采用 JSON，不兼容旧项目中的 YAML mock 文件，降低解析和 schema 校验复杂度
- **已实现（状态层）** ✅（基础实现）：
  - Riverpod 插件 (`@fliwright/plugin-riverpod`)：Provider 读取/写入/覆盖、Provider 列举、事件监听/取消
  - 通过 VM Service 扩展 `ext.fliwright.riverpod.*` 实现状态交互
- **未实现（原生硬件层）** ❌：
  - GPS、相机等传感器数据 Mock
  - Patrol 内核集成处理权限弹窗

### 3.5 表单助手 (Form Helper) — ✅ 已实现
- **描述**：自动识别表单字段语义，一键填充合规的随机数据。支持自动化测试和手动调试两种场景。
- **已实现能力**：
  - **语义识别**：根据 `hintText`、`label`、`keyboardType` 推断字段类型（手机号、邮箱、身份证等）
  - **数据生成**：内置 Faker 引擎，按国家/地区生成合规数据
  - **配置化**：通过 AI 生成的 JSON 配置文件搭配 Skill 实现高度定制
  - **三种策略**：
    - `PRESET_SKILL`：调用预置算法（如生成台湾手机号）
    - `REGEXP_MOCK`：正则逆向生成
    - `LLM_GENERATE`：调用大模型生成复杂内容
  - **规则加载**：`JsonRuleLoader` 支持文件加载、目录加载、自动发现（`.fliwright/` 目录）
  - **Dart 端集成**：`form_extract` 扩展提取表单元数据
  - **作用域过滤**：支持按页面范围过滤表单字段
- **本地规则目录**：
  - 表单模拟数据规则统一存放在项目根目录 `.fliwright/forms/`
  - 规则文件使用 JSON，兼容 `FormRulesFile` schema
  - VS Code 插件可扫描 `.fliwright/forms/*.json`，在手动调试时触发 `FormHelper` 填充当前页面表单

### 3.6 智能断言与自动等待 — ✅ 已实现（核心断言）
- **描述**：提供类 Playwright 的链式断言 API，内置自动重试与异步等待。
- **已实现断言**：
  - UI 可见性 (`toBeVisible()`) ✅
  - 文本内容精确匹配 (`toHaveText()`) ✅
  - 文本内容包含匹配 (`toContainText()`) ✅
  - 组件启用状态 (`toBeEnabled()`) ✅
  - 组件禁用状态 (`toBeDisabled()`) ✅
  - 链式否定 (`expect(locator).not.toBeVisible()`) ✅
- **核心特性**：
  - 轮询重试机制：默认 5000ms 超时，100ms 间隔，可配置
  - 自愈集成：断言失败时自动尝试自愈引擎重定位
  - 成功快照缓存：首次通过时自动存储组件快照，避免重复 RPC
- **未实现断言** ❌：
  - 路由断言 (`toContainRoute()`)
  - 异常捕获 (`hasNoUncaughtExceptions()`)
  - 性能帧率 (`performanceJankRateLessThan()`)

### 3.7 自愈引擎 (Self-Healing) — ✅ 已实现
- **描述**：UI 因 AI 修改而微变时，自动匹配原目标组件，避免测试中断。
- **已实现机制**：
  1. 首次成功运行或录制时，通过 `SnapshotStore` 存储组件多维元数据快照
  2. 运行失败时，拉取当前屏幕所有可交互组件，进行模糊匹配打分
  3. 使用 `MultiDimensionalHealingStrategy` 多维评分：位置相似度、上下文相似度、文本相似度
  4. 得分超过阈值则重定向操作，生成 `HealingReport`
  5. 通过 MCP 通知 AI 更新测试选择器
- **可扩展架构**：
  - `HealingStrategy` 接口：可注册自定义匹配策略
  - `FinderStrategy` 接口：可注册自定义查找策略
  - 支持启用/禁用控制
  - 按测试名称存储和检索自愈报告

### 3.8 跨语言远程控制 (TypeScript → Dart VM Service) — ✅ 已实现
- **描述**：测试逻辑运行在 Node.js 端，通过 WebSocket 发送指令到 Flutter 设备的 Dart VM Service。
- **已实现操作**：
  - 点击、长按、拖拽等手势（通过 `gesture` 扩展）
  - 表单输入（通过 `type` 扩展）
  - 滚动至指定组件（`scroll_extension`）
  - 截图捕获（`screenshot` 扩展，RenderRepaintBoundary 实现，支持像素比配置）
  - Widget 树查询与快照（`inspect` + `snapshot` 扩展）
  - 路由导航（`router_navigate` 扩展，支持 GoRouter + NavigatorState 回退）

### 3.9 路由导航集成 — ✅ 已实现（PRD 新增章节）
- **描述**：深度集成 Flutter 路由框架，支持测试中的页面导航验证。
- **已实现能力**：
  - **GoRouter 支持**：注入式 Router 集成，获取当前路由路径/名称
  - **NavigatorState 回退**：非 GoRouter 应用的标准 Navigator 支持
  - **ShellRoute 支持**：嵌套路由场景
  - **导航操作**：前进导航（支持 extra 数据传递）、返回导航
  - **自动发现**：自动在 Widget 树中查找 NavigatorState
- **示例应用**：`examples/go_router_demo/` 展示完整路由导航 + 表单填充

### 3.10 多模式客户端

| 客户端 | 状态 | 说明 |
|--------|------|------|
| **CLI** | ✅ 已实现 | `fliwright run/init/doctor/record` 四个命令 |
| **MCP Server** | ✅ 已实现 | 6 个工具 + 1 个资源端点 |
| **Vitest 集成** | ✅ 已实现 | `@fliwright/vitest` 开箱即用 |
| **VS Code 插件** | 🔄 部分实现 | 6 个侧栏视图 + 27 个命令 + CodeLens 已实现，待发布验证 |
| **Electron 桌面应用** | 📋 规划中 | V2.0 范围 |

**VS Code 插件已实现能力**：
- 6 个侧栏视图：设备连接管理、Mock API 管理、表单规则管理、测试发现、运行结果、状态注入
- 27 个命令：VM Service 连接/发现、MCP 配置说明、Mock 配置加载/应用/停止、表单规则分析/填充、测试运行、失败上下文查看、录制/插入、状态 Provider 读取/覆盖
- 自动扫描 `.fliwright/mocks/api/*.json` 和 `.fliwright/forms/*.json`
- 14 个可配置项（路径、URL、Runner、失败上下文、表单行为、CodeLens 开关等）
- TypeScript 测试文件 CodeLens：运行当前 Fliwright 测试、带失败上下文运行、录制后续交互
- 剩余工作：VSIX 发布包验证、Marketplace 上架、真实 VS Code Extension Host 用户测试与反馈

**VS Code 插件本地资产约定**：
- 插件读取项目根目录 `.fliwright/` 作为本地测试资产目录
- `.fliwright/forms/`：保存表单模拟数据 JSON 规则
- `.fliwright/mocks/`：保存 API Mock JSON 配置和索引文件
- `.fliwright/snapshots/`：保存自愈快照、选择器元数据等运行产物
- 插件负责扫描、预览、选择和应用这些文件，但不重新实现 `FormHelper`、`MockManager` 或 `SnapshotStore` 逻辑

**CLI 详细命令**：
- `fliwright run`：执行测试，支持 `--test`/`--vm-url`/`--reporter`/`--timeout`/`--screenshot` 参数
- `fliwright init`：在当前 Flutter 项目中初始化 Fliwright
- `fliwright doctor`：检查环境配置
- `fliwright record`：录制交互并生成测试代码，支持 `--lang ts|dart` 双语言输出

**MCP Server 工具列表**：
- `fliwright_run`：执行测试文件，返回详细结果
- `fliwright_get_failure`：获取失败上下文（Widget 树 + 截图 + 源码定位）
- `fliwright_generate_test`：从 Flutter 源码自动生成测试
- `fliwright_record`：录制用户交互并生成测试代码
- `fliwright_mock_list`：列出已加载的 Mock endpoint、规则和当前激活规则
- `fliwright_mock_switch`：切换指定 endpoint 的激活 Mock 规则
- 资源端点：`test_report` (`fliwright://test-report/latest`) 测试执行报告

VS Code 插件的详细设计见：`docs/superpowers/specs/2026-05-31-vscode-extension-design.md`。

---

## 4. 非功能需求

- **性能** ✅：断言轮询间隔默认 100ms，超时默认 5000ms，均可配置。
- **可靠性** ✅：自愈引擎多维评分机制，支持可配置的置信度阈值。
- **可扩展性** ✅：插件注册系统支持 StateAdapter、MockAdapter、FinderStrategy、HealingStrategy 等扩展点；Skill 注册表支持自定义表单策略。
- **兼容性** 🔄：支持 Flutter 3.x+，Dart VM Service 依赖 Debug/Profile 模式。已验证 iOS/Android，Web/Desktop 平台待验证。
- **安全性** ✅：测试入口和 Mock 服务器在 Release 模式下完全移除，不引入生产风险。

---

## 5. 测试策略

### 5.1 测试分层

| 层级 | 工具 | 规模 | 说明 |
|------|------|------|------|
| 单元测试 | Vitest | 58 个测试文件 | 覆盖所有 TS 包核心逻辑 |
| 集成测试 | Vitest | 含 8 个 `*-integration.test.ts` | Mock Manager、Form Helper、Self-Healing、Failure Context 等端到端流水线 |
| E2E 测试 | Vitest + Flutter | 5 个测试文件 | 需要运行中的 Flutter VM Service，验证真实设备交互 |

### 5.2 各包测试覆盖

| 包 | 测试文件数 | 关键测试 |
|----|-----------|---------|
| `fliwright-core` | 31 | Driver、Page、Locator、Assertion、SelfHealing、FormHelper、MockManager、Recorder |
| `fliwright-cli` | 7 | run、init、doctor、record、config、vm-discovery |
| `fliwright-mcp` | 9 | 所有 4 个 MCP 工具 + server + multi-tool workflow |
| `fliwright-vscode` | 6 | TreeProviders、SandboxService、MockConfigService、FormHelperService、VmServiceDiscovery |
| `fliwright-vitest` | 1 | 集成测试 |
| `fliwright-plugin-riverpod` | 3 | Adapter + Plugin + Driver 集成 |

### 5.3 AI 可消费文档

`docs/features/` 提供完整的生成式 API 文档体系，供 AI Agent 按需查阅：
- 已知包、类或跨包流程时，直接打开对应的包概览、API 页或 pipeline 页。
- 仅在不知道行为归属时使用 `docs/features/index.md` 进行检索；不要将其作为
  常规上下文加载。
- 文档状态、权威顺序和完整的渐进式披露规则见
  [Documentation Guide](./README.md) 与
  [Feature Documentation Memory](../harness/memory/feature-documentation.md)。

---

## 6. 技术方案

### 6.1 总体架构
```
+-----------------------------------------------------------------------+
|                        用户 / AI Agent / CI                            |
+-----------------------------------------------------------------------+
                                    |
            +-----------+-----------+-----------+
            |           |           |           |
      @fliwright/vitest  CLI    MCP Server   (VS Code)
            |           |           |           |
            +-----------+-----------+-----------+
                                    |
                        (调用 @fliwright/core SDK 编程式API)
                                    |
+-----------------------------------------------------------------------+
|  @fliwright/core (NPM)                                                 |
|  +--------------------+  +--------------------+  +------------------+  |
|  | FliwrightDriver    |  | SelfHealingEngine  |  | MockManager      |  |
|  | Page / Locator     |  | SnapshotStore      |  | FailureCollector |  |
|  | Assertion          |  | AssertionSuggester |  | Recorder         |  |
|  | FormHelper         |  | SkillRegistry      |  | EventAggregator  |  |
|  | JsonRuleLoader     |  | SelectorResolver   |  | CodeGenerator    |  |
|  | PluginRegistry     |  |                    |  |                  |  |
|  +--------------------+  +--------------------+  +------------------+  |
|  +--------------------+                                                |
|  | @fliwright/plugin-riverpod                                          |
|  | RiverpodStateAdapter | Event-driven monitoring                      |
|  +--------------------+                                                |
+-----------------------------------------------------------------------+
                          | WebSocket (VM Service) / HTTP (Mock)
+-----------------------------------------------------------------------+
|                    Flutter 设备 (Debug/Profile)                        |
|  +------------------------------------------------------------------+ |
|  | test_driver/fliwright_app.dart (编译期注入，零侵入)                 | |
|  |   - FliwrightBridge.init()                                       | |
|  |     - ext.fliwright.gesture / click / type                       | |
|  |     - ext.fliwright.scroll* / screenshot                         | |
|  |     - ext.fliwright.snapshot / inspect                           | |
|  |     - ext.fliwright.mock.* (addRoute/removeRoute/...)            | |
|  |     - ext.fliwright.form.* (extract/scope)                       | |
|  |     - ext.fliwright.router.* (navigate/current/back)             | |
|  |     - ext.fliwright.startRecording / stopRecording               | |
|  |   - 调用业务 main.dart                                            | |
|  +------------------------------------------------------------------+ |
|  Flutter App (业务代码无污染)                                          |
+-----------------------------------------------------------------------+
```

### 6.2 关键模块设计

#### 6.2.1 Dart 端桥接器 (`fliwright_bridge`) — ✅ 已实现
- **零侵入启动**：通过 `test_driver/fliwright_app.dart` 包装原始 `main.dart`，编译时条件注入。
- **VM Service 扩展注册**：利用 `dart:developer` 的 `registerExtension` 注册自定义方法：
  - `ext.fliwright.gesture`：在指定坐标仿真手势（点击、长按、拖拽）
  - `ext.fliwright.scrollIntoView`：滚动到目标组件
  - `ext.fliwright.type`：通过系统通道输入文本
  - `ext.fliwright.screenshot`：截图（RenderRepaintBoundary + 可配置像素比）
  - `ext.fliwright.snapshot` / `ext.fliwright.inspect`：Widget 树快照与查询
  - `ext.fliwright.mock.*`：Mock 路由管理（添加/删除/清空/透通/调用记录）
  - `ext.fliwright.form.*`：表单元数据提取与作用域过滤
  - `ext.fliwright.router.*`：路由导航（GoRouter + NavigatorState 回退）
  - `ext.fliwright.startRecording` / `stopRecording`：录制控制
- **内置 HTTP Mock 服务器**：拦截应用内 `HttpClient` / `Dio` 请求。

#### 6.2.2 TypeScript SDK (`@fliwright/core`) — ✅ 已实现
- **FliwrightDriver**：管理设备连接、Mock 规则、测试运行、插件生命周期。
- **Page**：提供 `goto()`, `locator()`, `waitForSelector()` 等高层 API。
- **Locator**：支持文本、语义角色、Key、组合选择器，以及自动滚动。
- **Assertion**：自研异步断言机，内置轮询重试，失败时自动尝试自愈，通过后自动快照。
- **SelfHealingEngine**：多维评分匹配、`SnapshotStore` 元数据存储、可插拔 `HealingStrategy`。
- **FormHelper**：独立模块，输入 Widget 树 JSON，输出填充方案。集成 `SkillRegistry` 和 `JsonRuleLoader`。
- **FailureCollector**：结构化失败上下文收集器，并行采集截图/Widget 树/源码定位。
- **AssertionSuggester**：基于录制操作模式识别，自动推荐断言插入点（导航检测、表单提交检测、列表选择检测）。
- **RecorderController**：录制交互事件，通过 `EventAggregator` 聚合，生成双语言测试代码。
- **MockManager**：HTTP Mock 管理，支持路由增删、透传、调用记录。
- **PluginRegistry**：插件生命周期管理（init/testStart/testEnd/dispose），支持多种 Adapter 注册。

#### 6.2.3 Vitest 集成 (`@fliwright/vitest`) — ✅ 已实现（PRD 新增章节）
- **描述**：为 Vitest 测试框架提供开箱即用的 Fliwright 集成。
- **核心能力**：
  - `createFliwrightTest(config)`：创建 Vitest test fixture，自动管理 Driver 连接和断开
  - 共享 Driver 实例，多个测试用例复用同一连接
  - 自动在测试失败时写入 MCP 失败上下文 JSON
  - `defineConfig()` 辅助函数配置 vmServiceUrl、timeout、screenshot 模式
  - 环境变量支持：`FLIWRIGHT_VM_URL`、`FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH`
  - 自定义 `expect()` 函数集成自愈引擎

#### 6.2.4 插件系统 — ✅ 已实现（PRD 新增章节）
- **PluginRegistry**：管理插件生命周期，支持 init/testStart/testEnd/dispose 事件。
- **可扩展接口**：
  - `StateAdapter`：状态管理适配器（已实现 Riverpod）
  - `MockAdapter`：Mock 策略适配器
  - `FinderStrategy`：Widget 查找策略
  - `HealingStrategy`：自愈匹配策略
  - `FliwrightPlugin`：插件生命周期接口
- **已实现插件**：
  - `@fliwright/plugin-riverpod`：Riverpod 状态管理集成，支持 Provider 读取/写入/覆盖、事件驱动监听（基础实现，3 个源文件）

#### 6.2.5 表单助手的可复用设计 — ✅ 已实现
- **Form Engine Core**：纯数据处理，接收 Widget 元数据数组，返回 `{id: value}` 映射。规则由 AI 生成的 JSON 文件定义，策略包括：
  - `PRESET_SKILL`：调用预置算法（如生成台湾手机号）
  - `REGEXP_MOCK`：正则逆向生成
  - `LLM_GENERATE`：调用大模型生成复杂内容
- **规则加载**：`JsonRuleLoader` 支持文件加载、目录扫描、`.fliwright/` 自动发现。
- **适配器层**（当前仅实现 TS E2E）：
  - ✅ `TsE2EAdapter`：通过 VM Service 注入
  - ❌ `DartIntegrationAdapter`：通过 `WidgetTester` 注入（规划中）
  - ❌ `DeveloperToolAdapter`：通过 VS Code 命令触发（规划中）

#### 6.2.6 `.fliwright` 本地测试资产目录 — ✅ 已实现（VS Code 插件已消费）
- **目录定位**：项目根目录下的 `.fliwright/` 是 Fliwright 的本地测试资产目录，用于保存可被 CLI、VS Code 插件、测试代码和 AI Agent 共同消费的 Mock、表单规则和运行快照。
- **目录结构**：
```text
.fliwright/
├── forms/
│   └── form-rules.example.json
├── mocks/
│   ├── mock-index.example.json
│   ├── README.md
│   └── api/
│       └── get-token.example.json
└── snapshots/
    └── <test-name>/<selector>.json
```
- **表单模拟数据规则**：`.fliwright/forms/*.json` 使用 `FormRulesFile` schema：
```json
{
  "version": 1,
  "locale": "zh-CN",
  "rules": [
    {
      "match": { "label": "手机号" },
      "type": "REGEXP_MOCK",
      "pattern": "1[3-9][0-9]{9}"
    },
    {
      "match": { "label": "邮箱" },
      "type": "PRESET_SKILL",
      "data": ["test.user@example.com", "qa.user@example.com"]
    }
  ]
}
```
- **API Mock 配置**：`.fliwright/mocks/api/*.json` 按 endpoint 拆分，一个文件描述一个接口和多组响应场景：
```json
{
  "version": 1,
  "name": "Get Token List",
  "description": "获取支持的所有代币列表，包含链详情、提现费率、抵押品权重等信息",
  "method": "GET",
  "endpoint": "/v1/public/token",
  "rules": [
    {
      "name": "success",
      "status": 200,
      "delay": 0,
      "headers": {
        "Content-Type": "application/json"
      },
      "body": {
        "success": true,
        "data": {
          "rows": []
        }
      }
    },
    {
      "name": "server_error",
      "status": 500,
      "delay": 0,
      "headers": {
        "Content-Type": "application/json"
      },
      "body": {
        "success": false,
        "error": {
          "code": "TOKEN_SERVICE_UNAVAILABLE",
          "message": "Token service unavailable"
        }
      }
    }
  ]
}
```
- **Mock 索引文件**：`.fliwright/mocks/mock-index.example.json` 可声明默认规则和参与加载的 Mock 文件：
```json
{
  "version": 1,
  "defaultRule": "success",
  "files": [
    "api/get-token.example.json"
  ]
}
```
- **VS Code 插件消费方式**：
  1. Sandbox 视图扫描 `.fliwright/mocks/api/*.json` 和 mock index。
  2. 用户选择 endpoint 和 rule。
  3. 插件将 JSON rule 转换为 `driver.mock.route(endpoint, { method, status, headers, body, delay })`。
  4. Form Helper 命令扫描 `.fliwright/forms/*.json`，将选中的文件或目录传入 `FormHelper`。
  5. 自愈相关快照继续由 `SnapshotStore` 写入 `.fliwright/snapshots/`，插件只负责展示和清理。
- **安全约束**：
  - `.fliwright/` 中不得保存生产密钥、真实用户 token 或设备私有配置。
  - Mock 文件应使用脱敏数据或合成数据。
  - 插件应用 Mock 或表单规则前应展示待应用规则名称，避免隐式改变调试环境。

### 6.3 交互流程示例：失败自愈与 AI 闭环
1. AI Agent 生成代码 → 触发 `fliwright run`。
2. `expect(page.locator('text=确认支付')).toBeVisible()` 失败（按钮文案改为"去结算"）。
3. 自愈引擎启动，多维评分匹配到新按钮（位置 + 上下文 + 文本相似度），得分超过阈值，测试通过。
4. `FailureCollector` 在失败时已并行采集截图、Widget 树快照、源码定位。
5. 自愈引擎生成 `HealingReport`（原始选择器 → 建议选择器、置信度、各维度评分）。
6. `@fliwright/vitest` 将结构化失败上下文写入 MCP JSON 文件。
7. MCP Server 通过 `fliwright_get_failure` 工具将反馈发送给 AI Agent。
8. AI Agent 自动更新测试脚本中的选择器。

### 6.4 与 Patrol 的对比
| 特性 | Patrol | Fliwright | 实现状态 |
|------|--------|-----------|----------|
| 测试语言 | Dart | TypeScript + Dart 双语言 | ✅ |
| 侵入性 | 需引入库和配置 | 零侵入（编译期包装） | ✅ |
| AI 亲和度 | 低（Finder 难写） | 高（MCP 协议、结构化反馈） | ✅ |
| 自愈能力 | 无 | 多维模糊匹配自愈 | ✅ |
| Mock 环境 | 需手工编码 | 声明式网络 Mock + 状态注入 | 🔄 (网络+状态 ✅, 原生 ❌) |
| 表单助手 | 无 | 内置、可配置、JSON 规则 | ✅ |
| 路由导航 | 无 | GoRouter + NavigatorState | ✅ |
| 录制器 | 无 | 双语言代码生成 + 断言建议 | ✅ |
| 失败上下文 | 基础截图 | 截图 + Widget 树 + 源码 + 自愈建议 | ✅ |
| 测试框架集成 | flutter_test | Vitest 原生集成 | ✅ |
| 客户端形态 | CLI | SDK + CLI + MCP + Vitest + VS Code (部分) | 🔄 |
| 插件系统 | 无 | 可扩展插件架构 | ✅ |

---

## 7. 可行性分析

### 7.1 技术可行性 — ✅ 已验证
- **Dart VM Service 协议**：已成功实现 WebSocket 连接、扩展注册、事件流监听。
- **零侵入模式**：已通过 `test_driver/fliwright_app.dart` 验证。
- **跨语言控制**：Node.js ↔ Dart VM Service 通信链路已打通。
- **自愈引擎**：多维评分匹配策略已实现，准确率待大规模验证。
- **表单助手**：语义识别 + Faker 引擎 + JSON 规则加载已完成。
- **GoRouter 集成**：路由导航扩展已实现并通过 E2E 测试验证。

### 7.2 资源可行性
- 开发团队需具备 Dart/Flutter、TypeScript 能力。
- MVP 阶段已完成，当前处于 V1.0 收尾阶段。

---

## 8. 价值评估

### 8.1 解决的核心痛点
- **测试编写与维护成本高** ✅：AI 生成代码导致 UI 频繁变更，Fliwright 的自愈和自动等待已降低维护成本。
- **AI 工作流脱节** ✅：通过 MCP 打通闭环，AI Agent 可直接运行测试、获取结构化失败反馈、自动修复。
- **表单测试低效** ✅：表单助手将表单填写过程智能化、配置化。

### 8.2 市场定位与商业化潜力
- **开源基础版** ✅：已开源（GitHub: 0x01lab/fliwright），捕获开发者心智。
- **企业版/云服务** 📋：CI 云端并行测试、高级自愈模型、团队管理功能。
- **生态锁定** 🔄：基础 Skill 注册表已实现，Skill 市场待建设。

---

## 9. 风险与挑战

- **VM Service 依赖 Debug 模式**：Release 下不可用，需明确告知用户测试仅在非生产环境使用。
- **复杂自定义组件的语义识别准确率**：对于完全自绘且无 `hintText` 的输入框，表单助手可能误判，需提供手动标注回退方案。
- **自愈引擎误匹配**：相似组件可能导致错误重定向，需设置合理的置信度阈值并提供人工审核界面。
- **跨平台原生弹窗处理**：原生硬件层 Mock 尚未实现，需集成 Patrol 内核。
- **性能开销**：高频轮询截图和 Widget 树可能影响测试执行速度，快照缓存机制已部分缓解。

---

## 10. 后续规划

### 10.1 MVP 阶段（1-2 个月）— ✅ 已完成
- ✅ 开发 `fliwright_bridge` Dart 包，实现 VM Service 点击、滚动、输入扩展。
- ✅ 实现 `@fliwright/core` 基础框架：设备连接、Page、Locator、自研断言机。
- ✅ 完成编译期注入的 `fliwright_app.dart` 自动生成与清理。
- ✅ 实现基础 HTTP Mock 服务器。
- ✅ 实现自愈引擎核心功能。
- ✅ 实现表单助手核心层与 JSON 规则加载。
- ✅ 实现 MCP Server 四个核心工具。
- ✅ 实现 CLI 四个命令。
- ✅ 实现 Vitest 集成包。
- ✅ 实现 Riverpod 插件。
- ✅ 实现录制器 + 双语言代码生成 + 断言建议。
- ✅ 实现 GoRouter 路由导航集成。
- ✅ 实现 FailureCollector 结构化失败上下文。

### 10.2 V1.0 阶段（当前）— 🔄 进行中
- ✅ 录制器核心逻辑
- ✅ 集成表单助手核心层与 TS 适配器
- ✅ 自愈引擎基本功能
- ✅ MCP Server 对接 Cursor/Claude Code
- 🔄 **VS Code 插件**（核心功能已实现：6 视图 + 27 命令 + CodeLens，待 VSIX 打包发布和 Marketplace 上架）
- 📋 **性能帧率断言** (`performanceJankRateLessThan`)
- 📋 **路由断言** (`toContainRoute`)

### 10.3 V2.0 及以后
- 高级性能监控与异常断言
- 表单助手 Skill 市场
- Electron 可视化 Trace Viewer
- 支持 Dart 侧集成测试适配器 (`DartIntegrationAdapter`)，让现有 Dart 测试直接复用表单助手和 Mock 能力
- 原生硬件层 Mock（GPS、相机等，集成 Patrol 内核）
- Web/Desktop 平台验证与适配
- `DeveloperToolAdapter`（VS Code 命令触发表单填充 — 部分已在 VS Code 插件中实现）

---

## 11. 项目结构

```
fliwright/
├── .fliwright/                  # 本地测试资产目录
│   ├── forms/                   # 表单模拟数据 JSON 规则
│   ├── mocks/                   # API Mock JSON 配置
│   │   └── api/                 # 按 endpoint 拆分的 Mock 文件
│   └── snapshots/               # 自愈快照与选择器元数据
├── packages/
│   ├── fliwright-core/          # TypeScript SDK 核心 (@fliwright/core)
│   ├── fliwright-cli/           # CLI 工具 (@fliwright/cli)
│   ├── fliwright-mcp/           # MCP Server (@fliwright/mcp)
│   ├── fliwright-vitest/        # Vitest 集成 (@fliwright/vitest)
│   ├── fliwright-plugin-riverpod/ # Riverpod 插件
│   ├── fliwright-vscode/        # VS Code 扩展
│   └── fliwright-bridge/        # Dart 桥接器 (pub.dev package)
├── examples/
│   ├── form_demo/               # 表单填充示例
│   ├── riverpod_demo/           # Riverpod 集成示例
│   └── go_router_demo/          # 路由导航示例
├── e2e/                         # E2E 测试套件
├── docs/                        # 文档
└── melos.yaml                   # Monorepo 工作区管理
```

---

## 12. 结论
Fliwright 已完成 MVP 阶段全部功能和 V1.0 阶段大部分功能。核心架构（零侵入桥接、自愈引擎、表单助手、MCP 集成、Vitest 集成、插件系统）均已实现并通过测试验证。VS Code 插件已实现核心功能（6 视图 + 27 命令 + CodeLens），待 VSIX 打包发布、Marketplace 上架和真实用户验证。下一步重点为 VS Code 插件发布、性能断言完善，随后进入 V2.0 规划（Skill 市场、Trace Viewer、原生硬件 Mock）。

---
