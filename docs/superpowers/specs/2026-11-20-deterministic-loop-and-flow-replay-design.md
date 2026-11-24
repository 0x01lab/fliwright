# Fliwright 热重载验证与 Flow 回放优化方案

首批交付两项能力。在现有 `tdd cycle` 中验证 App 已同步本轮改动，并让一次 Agent 探索产出可在 CI 中重复执行的业务回归。两项能力共用现有 Timeline 和测试工件。首个试点选仓库内 `form_demo` 的表单提交路径，便于同时验证代码变更、定位失败和断言失败。[Fliwright PRD](../../PRD.md) · [表单夹具](../../../examples/form_demo/lib/recording_fixture.dart)

## 优先级

| 优先级 | 采纳的研究做法 | Fliwright 的落点 |
| --- | --- | --- |
| P0 | 用确定性工具同步代码、观察运行时并重跑测试。[Flutter 更新](https://flutter.dev/blog/whats-new-in-flutter-3-50) · [Flutter AI 工具](https://docs.flutter.dev/ai/tools) | 补齐 `tdd cycle` 的同步确认和每次尝试的证据。结构化树用于定位，截图用于核对画面。 |
| P1 | 把一次场景探索沉淀为可重复执行的测试。[ScenGen](https://conf.researchr.org/details/ase-2026/ase-2026-journal-first/24/Scenario-Guided-LLM-based-Mobile-App-GUI-Testing) | 复用 Timeline、Flow 和 Vitest，为线性业务路径补齐动作、断言和场景绑定。 |
| P1 | 分析失败阶段并在环境变化下复测。[VenusBench-Mobile](https://proceedings.mlr.press/v306/gong26a.html) | 先覆盖同一条业务路径的语言、字号和 Mock 响应变化，按失败阶段和环境维度出报告。 |
| P2 | 通过复现、补丁和受影响测试验证修复。[APR Agent Traceability](https://www.cs.columbia.edu/~junfeng/papers/apr-agents/) | 先输出可审查的修复建议和验证记录。Flutter MCP 作为可选适配，视觉定位和更广的设备矩阵依据试点数据排期。 |

## P0　让热重载结果可验证

`TddRuntime` 已支持定向重跑、命名场景、受控启动与附加会话，并可在部分失败后尝试热重启。当前附加分支在 `reloadSources` 不可用时仍能返回 `reload`，受控启动的控制器也未检查 `app.restart` 的返回内容。运行时在重启重试成功时会返回最终结果，调用方难以从该结果看出首次失败的完整经过。[TddRuntime](../../../packages/fliwright-tdd/src/runtime/TddRuntime.ts) · [FlutterDaemonController](../../../packages/fliwright-tdd/src/daemon/FlutterDaemonController.ts)

1. **给现有 cycle 增加明确的执行阶段。** 观察失败 → 记录诊断和补丁引用 → 同步 App → 等待运行时就绪 → 恢复命名场景并重跑目标用例 → 验证结果。Agent 负责提出诊断和补丁，运行时负责同步、状态准备和验证。同步记录请求方式、实际方式、工具响应、会话及就绪结果。受控启动要求工具明确确认同步成功，重启后重新确认 Bridge 和场景就绪。附加会话须能确认变更已传送给运行中的 App。同步失败、能力缺失或超时时，以对应原因结束验证。仅在确认重启受支持且有同步或初始化边界的依据时升级一次。
2. **每次尝试都能定位回原始证据。** 复用 Timeline、`FailureCollector` 和 `TddFailureContext`，关联变更集、目标用例、场景指纹、同步结果、耗时和完整测试日志。保存重载前后的结构树，失败时保存截图与断言实际值。修复验证收集适用的 analyzer 结果，明确区分已通过、失败和未运行。重启重试使用同一 cycle 的独立尝试记录。用现有会话和租约串行控制同一设备，超时后的迟到结果保留为诊断记录。[FailureCollector](../../../packages/fliwright-core/src/FailureCollector.ts) · [TddFailureContext](../../../packages/fliwright-tdd/src/diagnostics/TddFailureContext.ts)
3. **先验证实际构建产物。** 在表单夹具中改变一个可观测的提交结果，保持 App 进程运行，通过重载前后的断言证明第二次测试确实读到新行为。再注入编译错误、模拟同步能力缺失和重启重试，检查失败归因和尝试记录。以现有冷启动流程为参照，在相同设备、同一用例上采集从改动到断言结果的中位耗时和 P95。

## P1　把探索路径变成可执行回归

仓库已有录制和 Timeline 转 Flow、`flow validate` 与 `flow generate-test`。Timeline 转换目前主要保留节点类型、选择器、截图和元数据。测试生成器生成的是骨架，对只有选择器的节点生成可见性断言。因此，业务预期和可回放动作需要在探索记录时显式保存。[TimelineFlowBuilder](../../../packages/fliwright-core/src/flow/TimelineFlowBuilder.ts) · [FlowTestGenerator](../../../packages/fliwright-core/src/flow/FlowTestGenerator.ts)

1. **用现有 Flow 承载已验证的步骤。** 一次 Agent 探索后形成线性 Flow。每个操作关联意图、结构化目标、动作及输入引用、预期结果和 Timeline 节点，有稳定候选时附经验证的备用定位。全流程绑定命名 `TestScenario`，至少具备一个明确的业务结果断言。回放校验发现缺少动作、必需输入或业务断言时，标明待补齐步骤。通过校验后，扩展现有生成器产出可直接执行的 Vitest 测试。敏感输入沿用录制参数引用。
2. **只在目标一致且唯一时采用备用定位。** 优先使用 Key 或语义标识，其次使用页面或容器作用域下的结构选择器。主定位命中多个目标或找不到可验证的候选时，暂停执行并记录候选、截图和当前页面。定位调整后，从可验证的场景初始状态或显式检查点重放最短可复现路径。提交等有副作用的动作在结果不明确时，先检查可观察的提交结果，再决定是否重试。截图和视觉识别可辅助诊断候选。[RecordedSelectorResolver](../../../packages/fliwright-core/src/RecordedSelectorResolver.ts) · [Scenario](../../../packages/fliwright-core/src/Scenario.ts)
3. **用同一业务路径做对照。** 从表单首页打开表单，输入固定值并提交，通过 `saved_value` 断言保存内容恰好等于输入。用同一生成测试验证正常版本、按钮文案变化、主定位失效但备用定位唯一，以及保存内容错误。前几项验证结构化定位的稳定性，最后一项必须触发业务断言失败。CI 首轮覆盖能确定性准备的环境变化，优先验证文案和字号。异常 Mock 在现有 HTTP Mock E2E 用例上验证，同步采集结果。设备能力或环境准备失败单独显示，指标按同步、场景准备、定位、操作、断言归因，并报告备用定位使用率和用例重跑通过率。[ScenarioDevicePreparation](../../../packages/fliwright-core/src/ScenarioDevicePreparation.ts) · [HTTP Mock E2E](../../../e2e/mock-api-e2e.test.ts)

## P2　形成可审查的修复建议

首版输出失败假设、补丁前的最小复现、最小补丁、补丁后的目标测试、至少一项有明确影响理由的邻近回归，以及适用的语义或视觉差异。每条结果链接到同一变更集的测试尝试。证据尚缺时标记为建议，证据齐备后可进入人工审查。Flutter 官方 MCP 适配先用目标 SDK 做验证，确认它能报告同步结果并与 Fliwright 的会话所有权协调，再决定是否接入现有 CLI 工作流。

## 首批交付与验收

| 交付 | 归属 | 建议试点门槛 |
| --- | --- | --- |
| 同步确认与尝试记录 | `fliwright-tdd` 实现，`fliwright-cli` 暴露结果 | 正常代码改动能在同进程重跑中被断言观测到。同步拒绝、能力缺失、超时和重启重试都有可查记录，注入的同步失败均无法取得绿色验证结果。 |
| Flow 转可执行回归 | `fliwright-core` 维护 Flow 和生成，`fliwright-cli` 调用，`fliwright-vitest` 执行 | 同一生成脚本从干净场景连续通过 10 次，回放过程的模型调用为 0。定位歧义时执行 0 次点击。注入业务错误后，断言能报告预期值和实际值。 |
| 稳定性对照 | 现有 E2E 和 CI 工件 | 按环境给出首次通过率、失败阶段和证据链接。无变更重跑与已注入故障分开统计，记录热重载与冷启动的中位耗时和 P95。 |
