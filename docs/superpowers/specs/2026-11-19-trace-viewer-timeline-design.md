# Trace Viewer 执行时间轴整合草案

日期：2026-11-19。状态：已实施常驻时间轴布局，截图默认仅失败帧；本文保留设计背景，交付状态见末尾。

## 目标与推荐布局

将 Cloud 测试报告中的执行时间轴体验引入 VS Code Trace Viewer，让用户按运行时间定位步骤、查看截图和对应证据。推荐「常驻时间轴」：左侧保留步骤树，右侧上方放时间轴，下方继续使用截图与证据详情双栏。

```text
运行状态 / 测试名 / 结果统计 / Generate Report
┌────────────────┬───────────────────────────────────────────┐
│ 步骤 / Actions │ 时间轴：上一步 播放 下一步 倍速 跳到失败     │
│ 搜索与步骤树   │ 时间刻度 / 操作区间 / 游标 / 截图缩略图      │
│                ├──────────────────────┬────────────────────┤
│                │ 当前步骤 / route     │ 详情 / 错误         │
│                │                      │ 日志 / UI 树        │
│                │       运行截图       │                    │
│                │                      │ 已有证据详情        │
│                │ 截图来源与采集时刻   │                    │
└────────────────┴──────────────────────┴────────────────────┘
```

常驻方案默认仅显示失败节点已采集的截图；工具栏提供「仅失败帧 / 全部截图 / 隐藏截图」三档。时间轴中的图片缩至约 64×88px，连同时间标签的点击区域约 76×118px；点击后在下方主画面查看完整截图。仅失败帧模式下成功节点仍保留操作区间，并可在主画面查看对应证据；截图模式只影响时间轴缩略图，不过滤操作、改变时钟或重置选择。全通过或失败节点未采集截图时，不预留空白截图行，也不把其他步骤的画面伪装成失败帧。

移除独立的拖拽进度条，直接通过时间轴刻度、操作条和游标定位。截图遵循 Cloud 的布局：以步骤结束时间映射到时间轴横坐标，缩略图尽量以该坐标为中心，边缘处钳制到可视范围，并用中性细线保留准确的时间锚点；相邻截图重叠时分行，不均分成卡片列，也不修改时间比例。时间轴位于画面和详情共同的上方，明确它控制两者。左侧步骤树保持完整高度。详情偏窄时改放截图下方；缩略图区域限制高度，增加轨道时在自身区域滚动。

已选定「常驻时间轴」，草图不再展示此前的底部收纳备选。

可点击草图位于 `work/trace-viewer-timeline-design/trace-timeline.html`。其中使用虚构下单流程与示意画面；支持步骤选择、时间轴游标定位、播放、倍速、跳到失败、证据页签和三档截图展示。截图已按 Cloud 的步骤结束时间锚点及防重叠分轨排列，独立进度条已删除。草图没有重现原有 Actions 切换、搜索、生成报告、窗口拖拽及全部缩放控件。

## 已验证的代码现状

| 位置 | 当前职责与整合价值 |
| --- | --- |
| `packages/fliwright-cloud/src/web/TimeTimeline.tsx` | 真实时间坐标、重叠操作分轨、截图结束时刻锚点、缩放、游标拖动、键盘定位、按速度播放；截图通过回调注入 |
| `packages/fliwright-cloud/src/web/replay-model.ts` | `buildTimeAxis`、`stepAtTime`、层级排序、耗时、截图解析；时间映射依赖 Cloud 的 `d3-scale` |
| `packages/fliwright-cloud/src/web/Replay.tsx` | 持有选中步骤、截图索引、播放及速度；协调时间轴与画面 |
| `packages/fliwright-vscode/src/webview/viewer/app.tsx` | `ViewerApp` 持有选择与三栏布局；当前没有时间轴播放状态 |
| `packages/fliwright-vscode/src/webview/viewer/components/Viewport.tsx` | 单张截图、最近前序截图回退、上一步和下一步；没有多截图切换与自动播放 |
| `packages/fliwright-vscode/src/webview/viewer/artifacts.ts` | `deriveSelection`、截图路径、`trace:<index>` 与 timeline node key 的选择契约 |
| `packages/fliwright-vscode/src/viewer/ViewerPanel.ts` | 已将 timeline、trace、日志与 Webview 资源根传入前端；截图使用 `asWebviewUri` |

本次对应 Cloud 的 `TimeTimeline`，Worker 执行准备/清理时间轴属于另一种数据，不纳入本界面。

## 交互契约

1. 打开运行时沿用「首个失败，否则最后节点」的默认选择，保持暂停。播放从当前游标继续；已到末尾时从头开始。
2. 手动点操作条、步骤、截图、前后步或失败定位均先暂停。点击操作/步骤将游标放到步骤起点；点击截图将游标放到其显示的证据锚点，同时锁定该截图的步骤和索引。
3. 游标连续变化，选中步骤仅在跨越节点边界时变化。父子操作重叠时按 Cloud 的最具体节点规则解析；用户直接点父操作时仍可查看父节点。
4. 选中步骤同时更新左侧、截图、详情和节点日志，不另建一套独立的时间轴选择。自动播放不强行切换用户已打开的详情页签；跳到失败也保留页签。
5. 点击时间轴命中被折叠或搜索隐藏的节点时，展开祖先并清空冲突的搜索条件，显示被选中节点。搜索与折叠仅影响步骤列表，不裁切真实时间域或改变播放速度。
6. 每个节点可有多张截图：选择状态包含 `screenshotIndex`；点击第 N 张缩略图后主画面展示同一张，避免现有「只取第一张」的限制。
7. 无截图节点显示本次运行中最近的前序已采集画面，并明确其来源步骤与时刻；没有可用截图则显示空状态。回退依据完整时间顺序，不依据已过滤的可见列表。
8. 主画面是所选步骤的已采集证据，可能在步骤结束时采集；始终标明采集/锚定时刻。时间游标不意味着存在该毫秒的连续视频，也不产生中间帧。
9. 截图本身没有精确采集时间时，沿用 Cloud 的步骤完成时刻锚点，并称为「步骤结束锚点」。无 endedAt 的节点只显示开始标记/未完成，不猜测耗时；缺失 startedAt 的节点保留在列表，提示不能按时间定位。
10. 倍速、缩放、截图展示模式与面板高度记忆到 Webview 布局状态，截图模式默认 `failed`；切换 runId 时重置游标、播放与选择。不要将播放中的逐帧游标写入 VS Code 持久状态。

## 代码整合边界

首期复用 Cloud 的时间语义与交互，UI 在 VS Code 包内适配；不让 VS Code 跨包引用 Cloud 的 `src/web`。当前依赖规则允许两者消费 core，但不允许 VS Code 依赖 Cloud。

- 把 Cloud 的层级排序、区间构建、命中规则提炼到 core 的纯 timeline 投影模块，通过 `src/index.ts` 导出；保持原有算法语义，由 Cloud 与 VS Code 同时消费。核心投影不引入 React、样式、DOM 或 `d3-scale`，刻度与屏幕缩放留在各自视图层。
- 在 VS Code 的 `webview/viewer/components/` 新增 `ExecutionTimeline.tsx`，适配其本地 Button、主题和布局组件；从 Cloud 迁移相应交互逻辑。首期不新建共享 UI 包，避免为单个界面先扩大包与框架依赖。
- `ViewerApp` 统一维护 node/action 身份、`screenshotIndex`、`cursorMs`、`playing` 和 `speed`；把时间轴与现有截图/详情共同包进右侧容器。删除 Viewport 底部重复的前后步工具栏，把唯一导航入口移到时间轴。
- 扩展 `artifacts.ts` 的多截图解析与选择，不再只取第一张；截图列表由 VS Code adapter 生成 Webview URI，组件只消费 URL。继续使用现有 `ViewerPanel` 资源范围与 CSP，不引入 Cloud HTTP 请求。
- 当前 `selectedKey` 通过「可见 orderedKeys」校验，时间轴命中隐藏节点后会被回退到默认值。应先按完整节点身份解析选择，再由列表负责展开与滚动；明确区分完整播放序列与当前可见列表。
- 可持久化状态增加布局偏好、倍速和截图索引，并携带 runId 以隔离不同运行；逐帧游标与播放标志仅存内存。运行内容替换时取消旧动画帧。

如果之后还需要多端共享 React 组件，再单独评估共享 UI 包及架构/依赖登记；本设计不把这项扩展作为首期前提。

## Timeline 与 Actions 的时间和身份

时间事实优先使用 `timeline.json` 的 `startedAt` / `endedAt`，以测试运行边界为共同时间域；父子耗时不累加，空闲时段不压缩。缺失结束时间、空数据、零时长和中断要沿用 Cloud 的退化展示。

Actions 与 timeline 可以通过 `TraceStep.operationId` 和 `TimelineNode.metadata.operationId` 建立明确映射。已有 `trace:<index>` key 可以继续作为动作列表身份，同时由选择控制器记录对应 timeline node；这保留的是现有 Actions 功能，不增加第二个时钟。

需要特别防止 timestamp 混用：

- `TraceCollector.onAction` 的传统采集路径在动作完成后写 `timestamp`。
- `projectRunTrace` 写入的是 `operation.startedAt`，即动作开始时间。
- 两者目前都是 `traceVersion: 1`，不能只凭版本或字段名推断区间。

因此首期不从无映射的 TraceStep 推算时间。Actions 无 operationId 映射时继续显示列表和截图，时间轴提示「此动作缺少可关联的时间记录」，清除该动作的定位高亮并暂停。不要按数组下标或最近时间猜测关联；不存在真实关联时不伪造精确播放。

## 代码整合与包边界

采用「共享纯时间投影，分别适配 UI」：

```text
@fliwright/core：TimelineData + 纯时间投影/节点查找
    ├── Cloud：TimeTimeline + Cloud Button/theme + 归档截图 URL
    └── VS Code：TimeTimeline + Webview Button/theme + asWebviewUri 截图
```

Cloud 与 VS Code 已允许依赖 core，但 VS Code 不允许依赖 Cloud。不能从 VS Code 直接导入 Cloud 源码，也不应让 core 承担 React、DOM、Cloud URL 或编辑器布局。

建议将 `buildTimeAxis`、层级排序与 `stepAtTime` 对应的纯记录时间运算移到 core 的独立、浏览器可打包模块，公开导出；Cloud 与 Webview 各用本地组件和主题。百分比映射是线性运算，保持现有数值语义即可，不为 core/VS Code 新增 d3 依赖。浏览器导入路径须验证，避免将 core 的 Node.js 文件读取模块打进 Webview。

首期在 `packages/fliwright-vscode/src/webview/viewer/components/TimeTimeline.tsx` 适配 Cloud 已验证交互，组件接收 entries、选择、截图 URL 回调及 playback 回调。保留 Cloud 的稳定测试场景并增加 Webview 联动测试。暂不新建共享 React 包；以后若两端持续共同演进，再单独评估公共 UI 包及对应依赖审批。

ViewerApp 增加统一选择/播放控制：

- 稳定选择：runId、nodeId / action key、screenshotIndex。
- 瞬时播放：cursorMs、playing、speed，游标每帧保持在时间轴局部；跨步骤才更新证据面板。
- 展示偏好：zoom、timelineExpanded、screenshotMode（`failed | all | none`）、timelineHeight。
- 保留 `listMode`、`filter`、`activeTab`；以原始节点校验选择，避免当前 `orderedKeys` 只含可见节点时把有效选择退回默认值。

Viewport 原有 prev/next 移到时间轴工具栏，避免出现两套相互冲突的播放控制；仍保留截图适配缩放。首期无需新增 Host 消息，也无需请求设备或 Cloud 服务；截图资源根和 URI 解析继续由 ViewerPanel 负责。

## 实施顺序与验收点

1. 固化共享时间投影及 Actions 映射规则，再接入常驻时间轴和单一选择控制；验证 Cloud 与本地同一份节点得到同样时间域与命中结果。
2. 接入多截图、主画面、前后步与失败定位，验证折叠/搜索命中、缺图来源以及两次运行间的状态隔离。
3. 接入线性播放、倍速、拖动暂停与时间缩放；覆盖到末尾停止、重播、嵌套重叠、零时长、缺失时间和中断数据。
4. 检查深浅主题、窄面板重排、键盘游标、资源访问，以及截图密集/长时间运行的响应性能。

实现验证包括 core、Cloud 时间轴及 VS Code viewer 的相关测试、包级 build/lint，以及 `node scripts/verify-harness.mjs`；稳定后通过生成器更新 feature docs。

## 交付状态

已新增共享 `TimelineTimeAxis` 投影和浏览器安全的 `@fliwright/core/timeline` 入口，Cloud 与 VS Code 共享时间计算。Trace Viewer 使用 `ExecutionTimeline`，具备三档截图模式、结束时刻锚点、小截图分轨、直接定位、播放与倍速、缩放、失败导航、多截图选择以及 Actions 显式身份联动。没有独立进度条。

时间轴按内容自动收缩，轨道区使用 240px 滚动上限；当前未提供单独的时间轴高度拖动或高度记忆。左右栏与截图/详情的布局比例继续由现有可调面板保存。实际构建后的预览使用示例运行数据验证布局，未宣称完成真实 VS Code Extension Host 和 Flutter 设备端 E2E。

验证结果：core 全量 1180 项通过；viewer 聚焦 56 项、Cloud 时间投影/时间轴 15 项通过。Core lint、Cloud build/lint、VS Code build（包含 TypeScript 检查）及 Harness 校验通过；功能文档和 capability catalog 已重新生成。浏览器已核对深浅主题、窄面板、三档截图、播放末尾停止及页签保持。VS Code 全量首轮 478 项通过；最终新增测试后的复跑为 478 项通过、1 项失败，失败位于已有 `VitestRunner.test.ts` 的实时进度握手（`missing initial running progress`），单独复跑仍失败；本次未修改其 runner 实现。
