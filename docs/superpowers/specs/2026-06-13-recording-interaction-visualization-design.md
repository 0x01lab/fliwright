# 录制交互可视化增强设计

> 日期：2026-06-13
> 状态：Approved
> 范围：VS Code 录制画布（recording-canvas）对 tap/longPress/drag/type 四种交互的可视化补全；不改动 Dart 捕获层与 wire protocol。

## 1. 背景

用户反馈：可视化录制脚本"貌似只实现了点击"，字符输入、滑动在画布里看不到、事件列表里也没有。

对录制链路做了一次端到端 review，结论与直觉相反——**引擎层其实已经支持四种交互**，缺口几乎全在**可视化**（外加一处疑似**捕获可靠性**问题）。

## 2. Review 发现

### 2.1 引擎层已支持四种交互（有测试覆盖）

| 层 | 文件 | 结论 |
|---|---|---|
| Dart 捕获 | `packages/fliwright-bridge/lib/src/extensions/recording.dart` | 全局 PointerRoute 捕获 down/move/up；50ms 轮询 `_pollFocusedTextInput` 捕获文本输入 |
| TS 聚合 | `packages/fliwright-core/src/EventAggregator.ts` | 位移>10px→`drag`；持续≥500ms→`longPress`；否则 `tap`；`textInput`→合并/生成 `type` |
| 代码生成 | `packages/fliwright-core/src/CodeGenerator.ts` | `.click()` / `.longPress({duration})` / `.drag(dx,dy)` / `.type()` / `.fill()` |
| 测试 | `tests/EventAggregator.test.ts`、`tests/RecorderController.test.ts` | tap/longPress/drag/type 聚合与 type 合帧均有用例通过 |

### 2.2 真实缺口

**缺口一 · 可视化（已确认，直接解释"看不到"）：**

- **滑动看不出**：drag 会产生帧，但 `app.tsx` 只画一个编号圆点 `tap-marker`（落在 down 位置），**完全不渲染 `frame.delta`（方向/距离）**。滑动在画布上和点击长得一样，只有 kind 标签写着 "drag"。
- **独立文本输入不可见**：`RecorderController.captureFrameForRawEvent`（`RecorderController.ts:191`）只在 `pointerEvent down` 时建帧。自动聚焦/键盘聚焦（无前置 tap）的 `textInput` → 聚合出 position={0,0} 的 `type` op → **永远没有帧 → 画布里彻底看不到**。
- **没有平铺的事件/操作列表**：所有东西塞进 ReactFlow 帧节点，raw 事件只显示为计数。

**缺口二 · 捕获可靠性（疑似，尤其文本）：**

- 文本靠 50ms 全树轮询找 `focusNode.hasFocus` + diff 文本，IME 输入法 / 编程式聚焦 / 自定义焦点管理下可能漏抓。
- 滑动 move 事件理论能抓到（pointer route 在手势竞技场下层），但真实滚动场景未验证。

## 3. 范围决策

经 brainstorm 选定 **方案 A：可视化优先**（最小改动，对症"看不到"）。本设计只覆盖 A；若第 7 节验证发现滑动/文本确未捕获，再追加方案 B（Dart 捕获加固），届时另起设计。

| 维度 | 决定 |
|---|---|
| 目标 | 让 tap/longPress/drag/type 四种交互在录制画布清晰可见、可检索 |
| 改动面 | 纯前端（`app.tsx`）+ 少量 `RecorderController` 补帧逻辑；**不动 Dart、不动 wire protocol、不动 CodeGenerator** |
| 操作列表 | 右侧栏，行 = frames（补帧后≈operations），无 raw 切换 |
| 数据来源 | 复用现有 `session.frames`，无新消息类型 |
| 验证先行 | 实现第一步先真实录制确认捕获是否真的工作 |

## 4. 设计

### 4.1 节点 kind-aware 渲染

改造 `app.tsx` 的 `RecordingFrameNode`（`app.tsx:190`），按 `frame.kind` 分支渲染标记。配色全画布统一：

| kind | 圆点色 | 叠加标记 |
|---|---|---|
| `tap` | 绿 `#4b8f78` | 编号圆点（现状） |
| `longPress` | 橙 `#e0a458` | 橙环 + `⏱ {ms}` |
| `drag` | 蓝 `#58a6ff` | SVG 箭头 start→(start+delta) + `{方向} {px}` |
| `type` | 紫 `#a371f7` | `⌨ "{text}"`；**合成帧不画点** |
| `pending` | 灰 `#8a8f98` | 现状 |

实现要点：

- 箭头：在 `.screen-wrap` 内画一段 SVG `<line marker-end>`，起点 = `markerPosition(frame)`，终点 = 起点 + `frame.delta` 归一化到截图宽高百分比。`.screen-wrap` 已 `overflow:hidden`，超界自动裁剪。
- 把纯逻辑抽成可单测函数：`swipeDirection(delta)`（↑↓←→）、`formatDuration(µs)`（→`1.2s`）、`markerEnd(frame)`、`kindColor(kind)`。
- `MiniMap.nodeColor`（`app.tsx:145`）由"绿/灰/红"改为按 `kindColor` 上色（error 仍红）。

### 4.2 独立文本输入补帧（让每个操作都可见）

在 `RecorderController.syncFramesWithOperations`（`RecorderController.ts:327`）补一步兜底：**任何 operation 若 `findFrameIndexForOperation` 返回 -1，就为其创建一个合成帧**——kind/position/delta/text/duration/action 全取自 op，截图取 `latestScreenshot`。

- 泛用：不只修 type，也覆盖未来任何"无 down 事件"的操作。
- 合成帧渲染：不画坐标圆点，居中显示紫色 `⌨ "{text}"` 徽标（type）或对应 kind 的无坐标标记。
- 标记合成帧：给 `RecordingFrame` 增加可选字段 `synthetic?: boolean`。该类型**不参与 Dart wire 协议**（Dart 只发 `RawInputEvent`，`RecordingFrame` 是 TS 侧构造），持久化 manifest 加可选字段向后兼容。比用 position={0,0} 判断更可靠，避免真实角落点击被误判为无坐标。

### 4.3 操作列表面板（右侧栏）

布局：画布左 + 列表右（flex，列表固定宽度比）。

```
┌──────────────────────────────────────────────┐
│ ● Recording live     4 ops · 8 raw · 4 frames│  ← 工具栏（现状）
├──────────────────────────────┬───────────────┤
│                              │ 操作列表       │
│      ReactFlow 画布          │ ① 点击 绿     │
│   （节点带箭头/环/文本）      │ ② 长按 橙 ⏱1.2s│
│                              │ ③ 滑动 蓝 ↓180 │
│                              │ ④ 输入 紫 "x@" │
│                              │ ⑤ 点击 (忽略)  │
└──────────────────────────────┴───────────────┘
```

每行内容：`序号 · 类型(配色同节点) · 坐标/参数(delta·时长·文本) · selector · 状态(✓/忽略)`。

交互：

- **行 = frame**：直接渲染 `session.frames`（4.2 补帧后与 operations 1:1）。
- **点行**：本地 React state 设选中，调用 ReactFlow `setCenter`/高亮对应节点居中。**纯前端，无消息往返。**
- **include/ignore**：复用现有 `setFrameIncluded` 消息（`app.tsx:197`），不新增协议。
- 行按 `operationStatus === 'ignored'` 半透明显示。

### 4.4 配色一致性

节点圆点、minimap、列表类型标签三处共用 `kindColor(kind)`，保证用户在画布、缩略图、列表里看到同一交互颜色一致。

## 5. 边界 & 错误处理

- drag 的 delta 极大 → 箭头超出截图，靠 `.screen-wrap{overflow:hidden}` 裁剪，不报错。
- type 文本很长 → 列表行 chip 与节点徽标均截断省略。
- `action === 'replace'`（生成 `.fill()`） → type 徽标追加 `↻ replace` 小标记，区分追加/替换。
- 截图未返回 → 沿用现有 "Capturing screen" / "Screenshot failed" 占位。
- 被忽略 op → 行半透明、节点沿用 `.frame-node--ignored`。

## 6. 测试

- **RecorderController（新增）**：
  - 独立 `textInput`（无前置 tap）→ 产生合成帧（kind=type，可见）。
  - drag（down+moves+up）→ 产生带 `delta` 的帧（当前帧级未覆盖）。
- **EventAggregator**：四种已覆盖，无改动。
- **app.tsx 纯函数**：单测 `swipeDirection` / `formatDuration` / `markerEnd` / `kindColor`。
- **回归**：`RecorderService.test.ts`、`RecordingPanel.test.ts`、`recording-integration.test.ts` 保持通过。

## 7. 验证步骤（实现第一步，也是 A 是否够用的判据）

在样本 app（`exio_app`）跑一次真实录制，依次执行 **点击 / 滑动滚动 / 长按 / 文本输入**，通过新的操作列表或 `recorder.getOperations()` 确认四种是否都被捕获：

- **四种都抓到** → 方案 A 完整收尾（可视化 + 补帧 + 列表）。
- **滑动/文本未抓到** → 触发**方案 B（Dart 捕获加固）**：文本捕获从轮询改为 EditableText 事件监听、滑动 move 事件补强，届时另起设计并告知用户。

## 8. 非目标（超出范围）

- 不改 Dart 捕获层与 wire protocol（除非第 7 节判定需要 B）。
- 不新增交互类型（scroll/pinch/keyboard keys 等不在内）。
- 不做"从 VS Code 直接驱动 app 录制"的交互式录制台（方案 C，后续可选）。
- 操作列表不加 raw 事件切换（用户选定纯右侧栏）。

## 9. 涉及文件

| 文件 | 改动 |
|---|---|
| `packages/fliwright-vscode/src/webview/recording-canvas/app.tsx` | `RecordingFrameNode` kind-aware 渲染；新增右侧栏组件；抽纯函数；`MiniMap.nodeColor` 按 kind 上色 |
| `packages/fliwright-core/src/RecorderController.ts` | `syncFramesWithOperations` 增加无帧 op 的合成帧兜底 |
| `packages/fliwright-vscode/src/webview/recording-canvas/styles.css` | 节点标记/箭头/徽标/列表样式 |
| `packages/fliwright-core/tests/RecorderController.test.ts` | 新增独立 type 补帧、drag 帧测试 |
| `packages/fliwright-vscode/src/webview/recording-canvas/marker-utils.ts`（新） | `swipeDirection`/`formatDuration`/`markerEnd`/`kindColor` 纯函数 |
| `packages/fliwright-vscode/tests/marker-utils.test.ts`（新） | 上述纯函数单测 |

`EventAggregator.ts`、`CodeGenerator.ts`、wire protocol、Dart bridge 均**不改动**。
