# Fliwright 产品需求文档 (PRD)

**版本**：v1.0  
**日期**：2026年5月27日  
**作者**：项目团队  
**状态**：初稿

---

## 1. 引言

### 1.1 背景与机遇
在 2026 年，AI 辅助编码（Cursor、GitHub Copilot、Claude Code 等）使代码生成门槛大幅降低。程序员的角色已从“写代码”转变为“把控 AI 生成代码的质量”。传统的 Flutter 端到端测试工具（如已废弃的 `flutter_driver`、官方的 `integration_test` 和社区的 Patrol）在 AI 时代暴露出严重短板：编写繁琐、对 AI Agent 亲和度低、缺乏智能自愈能力、难以无缝融入 AI 研发闭环。

Fliwright 是一款针对 Flutter 生态的下一代自动化测试框架，定位为“AI 时代质量把控工作站”。它提供类 Playwright 的声明式 API、零侵入架构、智能自愈引擎、可复用的表单助手，并原生集成 MCP 协议，让 AI Agent 能够直接调用测试、理解失败并自动修复问题。

### 1.2 产品愿景
成为 Flutter 领域 AI 驱动的端到端测试基础设施，让 AI 生成的代码在秒级内得到可靠验证，实现“代码生成 → 自动化测试 → 失败反馈 → 自动修复”的完整闭环。

### 1.3 文档范围
本文档详细描述 Fliwright 的核心功能、技术架构、模块设计、可行性分析及商业价值，为后续开发提供蓝图。

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

### 2.3 目标用户
- 使用 AI 生成 Flutter 代码的独立开发者和团队。
- 需要维护大规模 Flutter 应用、频繁回归测试的 QA 与开发团队。
- 希望将自动化测试集成到 AI 编码工作流（Cursor/Claude Code）的开发者。

---

## 3. 功能需求

### 3.1 测试用例录制 (Codegen)
- **描述**：开发者在模拟器/真机上操作 App 时，工具自动生成可维护的声明式测试脚本（TS/Dart）。
- **技术实现**：通过 Dart VM Service 监听指针事件，逆向解析点击坐标对应的 Widget 树，提取语义特征（文本、Key、类型）生成选择器代码。
- **输出**：纯净的 TypeScript/Dart 测试脚本，支持一键插入编辑器。

### 3.2 AI 生成测试用例
- **描述**：基于自然语言需求或 Flutter 源码，AI 自动生成覆盖边界条件的测试用例。
- **输入**：PRD 片段、页面源码、用户 prompt（如“测试购物车数量减到 0 时弹出删除确认框”）。
- **技术实现**：结合代码理解和多模态模型，输出符合 Fliwright API 规范的测试脚本。

### 3.3 测试失败上下文传递给 AI Agent
- **描述**：测试失败时，结构化打包错误信息（截图、Widget 树快照、源码行号、修复建议）并通过 MCP 协议反馈给 AI 编码工具。
- **反馈内容**：
  - 失败时的屏幕截图
  - Widget 树 JSON 与差异对比
  - 关联的 Flutter 源代码文件和行号
  - 自愈引擎给出的替代组件置信度

### 3.4 Mock 环境搭建 (Fliwright Sandbox)
- **描述**：为 Flutter 应用提供三层 Mock 能力：
  - **网络层**：内置 HTTP Mock 服务器，支持路由规则声明，拦截并替换接口返回。
  - **状态层**：通过依赖注入框架直接修改状态（Provider/Bloc/Riverpod），跳过登录等前置流程。
  - **原生硬件层**：利用 Patrol 内核处理权限弹窗，并支持 Mock 传感器数据（GPS、相机等）。
- **使用方式**：在 TS 测试用例中声明式配置。

### 3.5 表单助手 (Form Helper)
- **描述**：自动识别表单字段语义，一键填充合规的随机数据。支持自动化测试和手动调试两种场景。
- **能力**：
  - 语义识别：根据 hintText、label、keyboardType 推断字段类型（手机号、邮箱、身份证等）。
  - 数据生成：内置 Faker 引擎，按国家/地区生成合规数据。
  - 配置化：通过 AI 生成的 JSON 配置文件搭配 Skill（预设算法或 LLM prompt）实现高度定制。
  - 可复用设计：核心层与注入方式解耦，同一份 JSON 规则可同时用于 TS E2E 测试、Dart 集成测试和手动闪填。

### 3.6 智能断言与自动等待
- **描述**：提供类 Playwright 的链式断言 API，内置自动重试与异步等待，消除手动 `pumpAndSettle`。
- **支持断言**：
  - UI 可见性 (`toBeVisible()`)
  - 文本内容 (`hasText()`)
  - 组件状态 (`toBeEnabled()`)
  - 路由 (`toContainRoute()`)
  - 异常捕获 (`hasNoUncaughtExceptions()`)
  - 性能帧率 (`performanceJankRateLessThan()`)
- **自愈集成**：断言失败时，若自愈引擎成功重定位，则自动通过并生成维护报告。

### 3.7 自愈引擎 (Self-Healing)
- **描述**：UI 因 AI 修改而微变时，自动匹配原目标组件，避免测试中断。
- **机制**：
  1. 首次成功运行或录制时，存储组件多维元数据快照（类型、父级结构、相邻文本、屏幕位置、绑定回调函数名）。
  2. 运行失败时，拉取当前屏幕上所有可交互组件，进行模糊匹配打分（位置相似度、上下文相似度、代码绑定、语义向量）。
  3. 得分超过阈值（如 0.85）则重定向操作，并通过 MCP 通知 AI 更新测试选择器。

### 3.8 跨语言远程控制 (TypeScript → Dart VM Service)
- **描述**：测试逻辑运行在 Node.js 端，通过 WebSocket 发送指令到 Flutter 设备的 Dart VM Service，实现零侵入操控。
- **支持操作**：
  - 点击、长按、拖拽、双指捏合等手势
  - 表单输入（通过系统通道仿真键盘事件，保证触发校验）
  - 滚动至指定组件（`scrollIntoViewIfNeeded`）
  - 系统弹窗处理（调用 Patrol 原生能力）

### 3.9 多模式客户端
- **CLI**：供传统 CI/CD 流水线和脚本使用。
- **VS Code 插件**：侧边栏测试面板、Webview 录屏与 Trace Viewer、一键启动/停止沙箱。
- **Electron 桌面应用**：高级可视化监控与控制台（可选）。

VS Code 插件的详细设计见：`docs/superpowers/specs/2026-05-31-vscode-extension-design.md`。

---

## 4. 非功能需求

- **性能**：核心操作用时低于 50ms，断言轮询间隔可配置，默认 50ms。
- **可靠性**：自愈引擎在典型 UI 变更下的重定位准确率 > 90%。
- **可扩展性**：Skill 和策略可动态注册，支持第三方插件。
- **兼容性**：支持 Flutter 3.x+，iOS/Android/Web/Desktop 目标平台；Dart VM Service 依赖 Debug/Profile 模式。
- **安全性**：测试入口和 Mock 服务器在 Release 模式下完全移除，不引入生产风险。

---

## 5. 技术方案

### 5.1 总体架构
```
+-----------------------------------------------------------------------+
|                        用户 / AI Agent / CI                            |
+-----------------------------------------------------------------------+
                                    |
                (调用 @fliwright/core SDK 编程式API)
                                    |
+-----------------------------------------------------------------------+
|  上层 Shell（CLI、VS Code 插件、Electron）   →   仅做 UI 和交互封装     |
+-----------------------------------------------------------------------+
                                    |
                        +---------------------------+
                        |   @fliwright/core (NPM)    |
                        |   - Runner / Controller    |
                        |   - VM Service Connector   |
                        |   - Mock Manager           |
                        |   - Self-Healing Engine    |
                        |   - Form Engine + Skills   |
                        |   - MCP Server             |
                        +---------------------------+
                          | WebSocket (VM Service) / HTTP (Mock)
+-----------------------------------------------------------------------+
|                    Flutter 设备 (Debug/Profile)                        |
|  +------------------------------------------------------------------+ |
|  | test_driver/fliwright_app.dart (编译期注入，零侵入)                 |
|  |   - FliwrightBridge.init()                                       | |
|  |     - 注册 ext.fliwright.* 扩展                                   | |
|  |     - 启动内置 HTTP Mock 服务器                                    | |
|  |   - 调用业务 main.dart                                            | |
|  +------------------------------------------------------------------+ |
|  Flutter App (业务代码无污染)                                          |
+-----------------------------------------------------------------------+
```

### 5.2 关键模块设计

#### 5.2.1 Dart 端桥接器 (`fliwright_bridge`)
- **零侵入启动**：通过 `test_driver/fliwright_app.dart` 包装原始 `main.dart`，编译时条件注入。
- **VM Service 扩展注册**：利用 `dart:developer` 的 `registerExtension` 注册自定义方法：
  - `ext.fliwright.click`：在指定坐标仿真点击
  - `ext.fliwright.scrollIntoView`：滚动到目标组件
  - `ext.fliwright.gesture`：复合手势
  - `ext.fliwright.updateState`：修改状态管理数据
  - `ext.fliwright.type`：通过系统通道输入文本
- **内置 HTTP Mock 服务器**：监听 8080 端口，接收来自 TS 端的路由规则，拦截应用内 `HttpClient` / `Dio` 请求。
- **Widget 树查询**：封装 `WidgetInspectorService`，提供灵活的组件查找器。

#### 5.2.2 TypeScript SDK (`@fliwright/core`)
- **FliwrightDriver**：管理设备连接、Mock 规则、测试运行。
- **Page**：提供 `goto()`, `locator()`, `waitForSelector()` 等高层 API。
- **Locator**：支持文本、语义角色、Key、组合选择器，以及自动滚动。
- **Expect**：自研异步断言机，内置 5000ms 轮询重试，失败时生成 MCP 结构化上下文。
- **SelfHealing**：元数据存储、模糊匹配算法、投票机制、重定向与报告。
- **FormHelper**：独立模块，输入 Widget 树 JSON，输出填充方案。集成 Skill 注册表和正则/LLM 策略。
- **MCP Server**：将核心功能暴露为标准工具，供 AI 编辑器调用。

#### 5.2.3 表单助手的可复用设计
- **Form Engine Core**：纯数据处理，接收 Widget 元数据数组，返回 `{id: value}` 映射。规则由 AI 生成的 JSON 文件定义，策略包括：
  - `PRESET_SKILL`：调用预置算法（如生成台湾手机号）
  - `REGEXP_MOCK`：正则逆向生成
  - `LLM_GENERATE`：调用本地大模型生成复杂内容
- **适配器层**：
  - `TsE2EAdapter`：通过 VM Service 注入
  - `DartIntegrationAdapter`：通过 `WidgetTester` 注入
  - `DeveloperToolAdapter`：通过 VS Code 命令触发

### 5.3 交互流程示例：失败自愈与 AI 闭环
1. AI Agent 生成代码 → 触发 `fliwright run`。
2. `expect(page.locator('text=确认支付')).toBeVisible()` 失败（按钮文案改为“去结算”）。
3. 自愈引擎启动，模糊匹配到新按钮，得分 0.94，测试通过。
4. SDK 生成自愈报告，打包失败快照（截图、Widget 树、建议选择器 'text=去结算'）。
5. MCP Server 将结构化反馈发送给 AI Agent。
6. AI Agent 自动更新测试脚本中的选择器。

### 5.4 与 Patrol 的对比
| 特性 | Patrol | Fliwright |
|------|--------|-----------|
| 测试语言 | Dart | TypeScript (可扩展) |
| 侵入性 | 需引入库和配置 | 零侵入（编译期包装） |
| AI 亲和度 | 低（Finder 难写） | 高（MCP 协议、结构化反馈） |
| 自愈能力 | 无 | 多维模糊匹配自愈 |
| Mock 环境 | 需手工编码 | 声明式三层 Mock |
| 表单助手 | 无 | 内置、可配置、跨场景复用 |
| 客户端形态 | CLI | SDK + CLI + VS Code 插件 + Electron |

---

## 6. 可行性分析

### 6.1 技术可行性
- **Dart VM Service 协议成熟**：Flutter 的调试与 DevTools 依赖该协议，已暴露 Inspector、事件注入、时间线等接口，足以支撑远程操控。
- **零侵入模式已验证**：`integration_test` 和 Patrol 均使用独立入口文件模式，`test_driver/` 目录是社区通用实践。
- **跨语言控制**：Playwright 的 CDP 协议思想可借鉴，Node.js 端负责逻辑，Flutter 端负责执行，通过 JSON 通信，没有无法逾越的技术壁垒。
- **自愈引擎**：基于元数据快照和特征匹配的思路在 Web 自动化（如 Healenium）已有落地，结合轻量级语义模型可保证较高准确率。
- **表单助手**：语义识别依赖 `hintText`、`keyboardType` 等 Flutter 已有属性，正则和 Faker 生成算法成熟。

### 6.2 资源可行性
- 开发团队需具备 Dart/Flutter、TypeScript、VS Code 插件开发能力。
- 初期 MVP 可聚焦 SDK + CLI，后续逐步扩展插件和 GUI。

---

## 7. 价值评估

### 7.1 解决的核心痛点
- **测试编写与维护成本高**：AI 生成代码导致 UI 频繁变更，传统测试极易“失明”。Fliwright 的自愈和自动等待极大降低维护成本。
- **AI 工作流脱节**：现有工具无法将测试失败直接喂给 AI 修复。Fliwright 通过 MCP 打通闭环，提升研发效率。
- **表单测试低效**：移动端手工填写低效，自动化用例又需为每个字段硬编码数据。表单助手将这一过程智能化、配置化。

### 7.2 市场定位与商业化潜力
- **开源基础版**：捕获开发者心智，建立社区生态。
- **企业版/云服务**：提供 CI 云端并行测试、高级自愈模型、团队管理功能。
- **生态锁定**：通过 Skill 市场和表单 JSON 配置分享，形成网络效应。

---

## 8. 风险与挑战

- **VM Service 依赖 Debug 模式**：Release 下不可用，需明确告知用户测试仅在非生产环境使用。
- **复杂自定义组件的语义识别准确率**：对于完全自绘且无 `hintText` 的输入框，表单助手可能误判，需提供手动标注回退方案。
- **自愈引擎误匹配**：相似组件可能导致错误重定向，需设置合理的置信度阈值并提供人工审核界面。
- **跨平台原生弹窗处理**：强依赖 Patrol 内核，需保持对底层原生库的持续跟进。
- **性能开销**：高频轮询截图和 Widget 树可能影响测试执行速度，需优化传输数据量。

---

## 9. 后续规划

### 9.1 MVP 阶段（1-2 个月）
- 开发 `fliwright_bridge` Dart 包，实现 VM Service 点击、滚动、输入扩展。
- 实现 `@fliwright/core` 基础框架：设备连接、Page、Locator、自研断言机。
- 完成编译期注入的 `fliwright_app.dart` 自动生成与清理。
- 实现基础 HTTP Mock 服务器。

### 9.2 V1.0 阶段（3-4 个月）
- 完成录制器核心逻辑。
- 集成表单助手核心层与 TS 适配器。
- 实现自愈引擎基本功能。
- 开发 MCP Server，对接 Cursor/Claude Code。
- 发布 VS Code 插件预览版。

### 9.3 V2.0 及以后
- 高级性能监控与异常断言。
- 表单助手 Skill 市场。
- Electron 可视化 Trace Viewer。
- 支持 Dart 侧集成测试适配器，让现有 Dart 测试直接复用表单助手和 Mock 能力。

---

## 10. 结论
Fliwright 构想精准抓住了 AI 时代 Flutter 开发测试的痛点，技术方案完整且可行。通过 SDK 中心化、零侵入架构、自愈引擎、表单助手和 MCP 集成，它为程序员和 AI Agent 提供了一个前所未有的闭环质量平台。该产品具有明确的市场差异化优势和商业化前景，建议立即启动 MVP 开发。

---
