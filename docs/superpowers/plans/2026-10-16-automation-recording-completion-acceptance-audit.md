# 自动化执行与过程记录：41 项任务验收核对

核对日期：2026-10-17。依据[设计](../specs/2026-10-16-automation-recording-completion-design.md)与[实施计划](./2026-10-16-automation-recording-completion.md)。本文为任务证据索引，不修改原始验收报告，不扩大其验证范围。用户已确认 macOS 原生权限与 exio 验收在另一台电脑完成，见[跨机器交接](./2026-10-16-automation-recording-completion-machine-handoff.md)。

本次核对任务 ID、主要测试入口及 14 份本地验收 JSON 的存在性、状态和范围，没有重新执行产品测试或 App 验收。“有代码/进程证据”表示已有对应实现与回归记录，不表示本次重新证明整项完成；完整完成条件仍以实施计划为准。Flutter widget test、bridge 驱动动作、原生输入、真实业务 App 与设备验收分别记账。

## M0：5 项

| ID | 当前证据与核对入口 | 尚不能据此关闭的条件 |
| --- | --- | --- |
| M0.1 | [真实 runner hook 探针](../../../packages/fliwright-vitest/tests/runner-lifecycle-probe.test.ts)，包含失败、重试、跳过及 worker crash | 探针不代替真实 App 验收。 |
| M0.2 | [Binding](../../../packages/fliwright-bridge/test/recording_binding_test.dart)、[目标冻结](../../../packages/fliwright-bridge/test/recording_target_test.dart)、[分发行为](../../../packages/fliwright-bridge/test/recording_dispatch_test.dart)；Android/iOS 原生跨页销毁表单记录见计划最新记录 | 两平台该流程已有原生证据；其余输入/手势完整验收仍关联 M3.12。 |
| M0.3 | [controller listener](../../../packages/fliwright-bridge/test/recording_input_test.dart)及分发行为测试；最新 iOS 系统拼音、粘贴、选择替换、清空记录见计划 | iOS 受控设备流程已有系统输入证据；其他键盘/平台及完整 M3.12 不由单一系统 IME 覆盖。 |
| M0.4 | [协议/结果契约](../../../packages/fliwright-core/tests/RunContracts.test.ts)、[配置](../../../packages/fliwright-core/tests/RecordingConfig.test.ts)、[bridge 握手](../../../packages/fliwright-bridge/test/recording_protocol_test.dart) | 有生产/消费契约，不外推所有平台行为。 |
| M0.5 | [Flutter fixture](../../../examples/form_demo/lib/recording_fixture.dart)、[fixture 测试](../../../examples/form_demo/test/recording_fixture_test.dart)，E04/E05 同机 off/standard/full；Android/iOS 原生输入及 iOS 系统拼音切片 | 受控夹具与当前实现对照测量有证据；其他系统 IME/原生场景仍待验收。 |

## M1：9 项

| ID | 当前证据与核对入口 | 尚不能据此关闭的条件 |
| --- | --- | --- |
| M1.1 | [RunSession](../../../packages/fliwright-core/tests/RunSession.test.ts)：嵌套/并发上下文、原错误、动作与证据租约 | 已有代码级证据；阶段退出仍按 M1 全部条件核对。 |
| M1.2 | [结果契约](../../../packages/fliwright-core/tests/RunContracts.test.ts)、[真实 fixture 结果](../../../packages/fliwright-vitest/tests/runner-fixture-outcomes.test.ts) | retry、expected-failure、捕获动作错误均有独立语义，不以最终通过覆盖历史。 |
| M1.3 | [runner adapter](../../../packages/fliwright-vitest/tests/runner-adapter.test.ts)、[真实集成](../../../packages/fliwright-vitest/tests/runner-integration.test.ts)、[fixture 结果](../../../packages/fliwright-vitest/tests/runner-fixture-outcomes.test.ts) | 准备失败走 Vitest early-failure；不能宣称它具有主体失败的全部 retry 行为。 |
| M1.4 | [EvidenceCapture](../../../packages/fliwright-core/tests/EvidenceCapture.test.ts)、[收尾预算](../../../packages/fliwright-vitest/tests/finalization-budget.test.ts)、[终态回归](../../../packages/fliwright-vitest/tests/finalization-outcomes.test.ts)、[直接运行恢复](../../../packages/fliwright-vitest/tests/direct-run-recovery.test.ts)，E11/E12 | 已捕获 running Timeline 现场，并以真实子进程稳定复现：worker 终态写盘耗尽预算，直接运行入口未消费恢复信息。preset/IDE 现接入父进程恢复并保持 partial；历史缺 Trace 的原现场缺失，不能断言所有历史现象同因。 |
| M1.5 | [租约](../../../packages/fliwright-core/tests/EndpointLease.test.ts)、[初始化错误](../../../packages/fliwright-core/tests/EndpointLeaseFaults.test.ts)、[整测试串行](../../../packages/fliwright-vitest/tests/endpoint-test-lease.test.ts)，E13；最新 Android/iOS 真实双 worker 各精确 +24，排队取消及持有者强杀后恢复 | 列明移动模拟器切片各自通过；租约故障操作在宿主 Node 进程，不外推物理设备/任意并发组合。 |
| M1.6 | [ArtifactStore](../../../packages/fliwright-core/tests/RunArtifactStore.test.ts)、[journal](../../../packages/fliwright-core/tests/RunProgressJournal.test.ts)、[manifest](../../../packages/fliwright-cli/tests/artifacts-manifest.test.ts) | 父进程无法写盘时保留原错误并报告失败，不声称 manifest 已落盘。 |
| M1.7 | [show/export 清单](../../../packages/fliwright-cli/tests/artifacts-manifest.test.ts)、[run](../../../packages/fliwright-cli/tests/run.test.ts)，E05/E06/E13 | partial 默认拒绝；allow-partial 必须保留 missing 与原证据状态。 |
| M1.8 | [组合故障](../../../packages/fliwright-cli/tests/run-fault-matrix.test.ts)、[排队取消](../../../packages/fliwright-vitest/tests/endpoint-test-lease.test.ts)，E02 | POSIX 进程组退出已有记录；不能据此声明 Windows 后代进程清理已验收。 |
| M1.9 | [真实 fixture 矩阵](../../../packages/fliwright-vitest/tests/runner-fixture-outcomes.test.ts)、[CLI 矩阵](../../../packages/fliwright-cli/tests/run-fault-matrix.test.ts)，E11–E14 | 代码/真实子进程及受控 VM 证据共同覆盖；平台与原生输入仍由 M4 关闭。 |

## M2：9 项

| ID | 当前证据与核对入口 | 尚不能据此关闭的条件 |
| --- | --- | --- |
| M2.1 | [Page](../../../packages/fliwright-core/tests/Page.test.ts)、[Locator](../../../packages/fliwright-core/tests/Locator.test.ts)、[RunSession](../../../packages/fliwright-core/tests/RunSession.test.ts) | 公开逻辑动作与 transport 分层；保留 bridge success:false 的实际失败语义。 |
| M2.2 | [真实 Vitest 模式矩阵](../../../packages/fliwright-vitest/tests/recording-modes.test.ts)，E04/E05 | standard/full/off 证据与显式请求分别验证；文本掩码不代表截图已脱敏。 |
| M2.3 | [Trace 投影](../../../packages/fliwright-core/tests/RunTraceProjection.test.ts)、真实 fixture 结果 | testOutcome 来源为 runner，不能按动作成功数量推断测试通过。 |
| M2.4 | [共享配置](../../../packages/fliwright-core/tests/RecordingConfig.test.ts)、[CLI 配置](../../../packages/fliwright-cli/tests/config.test.ts) | core 不加载 TS 配置文件；入口必须使用已解析配置。 |
| M2.5 | [runner 组合](../../../packages/fliwright-vitest/tests/runner-composition.test.ts)、[注册保真](../../../packages/fliwright-vitest/tests/test-registration.test.ts)、[scenario 组合](../../../packages/fliwright-vitest/tests/scenario-composition.test.ts)，E14 | 保留 Vitest 原生注册错误与 fixture 依赖顺序，不承诺任意项目 fixture 都晚于 scenario。 |
| M2.6 | [init](../../../packages/fliwright-cli/tests/init.test.ts)、[run](../../../packages/fliwright-cli/tests/run.test.ts)，E01 | 真实初始化宿主使用本地依赖、跳过网络安装；不把它当作注册表下载安装验收。 |
| M2.7 | [公共 capture](../../../packages/fliwright-core/tests/RecordingCapture.test.ts)、[CLI](../../../packages/fliwright-cli/tests/record.test.ts)、[MCP](../../../packages/fliwright-mcp/tests/record.test.ts) | 共享生命周期已有回归，实际人工输入仍关联 M3.12。 |
| M2.8 | [Viewer](../../../packages/fliwright-vscode/tests/RunViewerService.test.ts)、[导出包](../../../packages/fliwright-vscode/tests/ExportedRunViewer.test.ts)、[路径](../../../packages/fliwright-vscode/tests/WorkspacePaths.test.ts)、[doctor](../../../packages/fliwright-cli/tests/doctor-recording.test.ts)，E01/E02 | IDE 宿主受控流程有证据；原生录制和平台发布门槛不随之关闭。 |
| M2.9 | [两次动作/断言与模式矩阵](../../../packages/fliwright-vitest/tests/recording-modes.test.ts)、CLI/MCP record 测试，E01/E02 | 普通动作记录已有证据；真实跨端平台验收仍关联 M4。 |

## M3：12 项

| ID | 当前证据与核对入口 | 尚不能据此关闭的条件 |
| --- | --- | --- |
| M3.1 | [core 协议](../../../packages/fliwright-core/tests/RecordingProtocol.test.ts)、[bridge 协议](../../../packages/fliwright-bridge/test/recording_protocol_test.dart) | 已替换协议不新增旧版兼容读路径。 |
| M3.2 | [冻结目标](../../../packages/fliwright-bridge/test/recording_target_test.dart)、[before-dispatch](../../../packages/fliwright-bridge/test/recording_dispatch_test.dart)；Android/iOS 原生跨页销毁表单均使用事件时稳定 key | 该流程原生证据已取得；macOS 与其他原生输入场景仍关联 M3.12。 |
| M3.3 | [冻结候选解析](../../../packages/fliwright-core/tests/RecordedSelectorResolver.test.ts) | nth/坐标保留草稿阻塞条件，不由受控成功回放豁免。 |
| M3.4 | bridge 输入/分发测试、[事件聚合](../../../packages/fliwright-core/tests/EventAggregator.test.ts)、[输入参数化](../../../packages/fliwright-core/tests/RecordingAutomation.test.ts)；Android/iOS 首段输入，iOS 系统拼音 composing、原生粘贴/自动聚焦/选择替换/清空及原样回放 | iOS 指定切片通过；其他系统 IME/平台、macOS 双窗口连续回放未外推。iOS 首次空值现象原因未确定。 |
| M3.5 | 事件聚合、core/bridge 协议测试、[事件归档](../../../packages/fliwright-core/tests/RecordingEventStore.test.ts)、[手势行为](../../../packages/fliwright-bridge/test/gesture_test.dart)；iOS 原生长按、约 1,283ms 拖动/双指守门，Android 约 1,370ms 拖动 | 两平台指定拖动通过严格原样回放与反例；线性插值保留位移/总时长，不宣称复现任意原生轨迹。Android 先前三份预算 draft 保留，未放宽 12ms。 |
| M3.6 | [Recorder lifecycle](../../../packages/fliwright-core/tests/RecorderLifecycle.test.ts)、公共 capture 测试，E06；计划最新 iOS 原生输入后 App terminate、AbortSignal、实际 CLI SIGINT 及新会话恢复 | 三项 iOS 受控故障切片保留动作/既有截图/原始归档并正常退出；既有截图是先前观察，不作为故障当时画面。其他平台/故障组合仍需独立验收。 |
| M3.7 | [readiness](../../../packages/fliwright-core/tests/RecordingReadiness.test.ts)、[生成](../../../packages/fliwright-core/tests/RecordingAutomation.test.ts)、[严格回放](../../../packages/fliwright-cli/tests/record-replay.test.ts)；iOS 禁滚动反例暴露并修复 healing 误通过 | 显式验证禁止断言自动换目标；历史误通过 run 保留。生成内容或 scenario 变化撤销 verified；捕获 partial 不能靠回放成功绕过。普通 authored test 的既有 healing 不在此切片改写。 |
| M3.8 | [检查点](../../../packages/fliwright-core/tests/RecordingCheckpoints.test.ts)、生成测试、[IDE 审阅](../../../packages/fliwright-vscode/tests/RecordingPanel.test.ts)，E02 | 已确认的可执行断言与建议分开；不能推断业务保存成功。 |
| M3.9 | CLI 回放、scenario 组合测试，E12/E14；[暂停帧 settle 回归](../../../packages/fliwright-bridge/test/settle_test.dart)与真实 macOS 红绿探针证明导航不会把未执行路由 ticker 当稳定 | 命名 fixture scenario 已验证；app-owned auth seed 的 exio 业务仍待 M4.2。暂停帧修复不能解释缺少当时 lifecycle 数据的历史偶发失败。 |
| M3.10 | MCP record、[Record After Test](../../../packages/fliwright-vscode/tests/recordAfterTest.test.ts)、IDE 审阅测试，E01/E02 | 受控宿主审阅/确认/回放/保存有证据；原始输入由 bridge 驱动。 |
| M3.11 | [Dart codegen](../../../packages/fliwright-core/tests/DartCodeGenerator.test.ts)、readiness 测试，E07–E10；新增独立 analyze/实际 macOS integration test 证明 fractional timedDrag 与 containing 元素去重 | Dart 编译/运行与 TS 验证独立；headless 红灯与临时宿主配置失败保留，不计实际设备成功。E07 路径中的 native 不表示原生输入。 |
| M3.12 | fixture 与 widget/协议回归、E03 同文件回放；Android/iOS 原生跨页输入及新增慢拖动/重复 Save，严格正例→反例→恢复；iOS 编辑/拼音/粘贴/多指守门及导出图像见计划 | **部分通过**：两平台列明切片分别通过；macOS 原生鼠标/键盘和双窗口每流程连续回放、其余完整矩阵仍待验收。Android 列表控件捕获新增 [keyed ancestor 回归](../../../packages/fliwright-bridge/test/recording_target_test.dart)。 |

## M4：6 项

| ID | 当前证据与核对入口 | 剩余交付与验收 |
| --- | --- | --- |
| M4.1 | E01/E02：真实 Extension Host，两种 runner、失败查看、取消及移动导出包 | 受控流程切片通过；完整发布仍依赖 M3.12 等门槛。 |
| M4.2 | 计划明确指定 exio 路径、auth seed 与命名 scenario；用户确认在另一台电脑完成 | **待异机验收**：认证业务闭环、错误分支及业务结果未验收，按交接清单执行。 |
| M4.3 | E03 单流程；六份 iOS 原生生成文件双窗口正反/恢复共 54 portable run/324 attempt、1,902 PNG；暂停帧 settle 修复后，两尺寸各 20 轮，另 40 portable run/240 attempt、1,400 PNG；历史失败均保留 | **跨平台双窗口切片通过，完整项保留**：六文件原样严格回放/反例/恢复有独立证据。暂停帧路径已独立红绿验证；原第 14 轮与启动失败缺同因证据，不能声明一并修复。macOS 原生捕获与 exio 另机验收。 |
| M4.4 | Android API 35 ARM64 与 iOS 26.5 ARM64 模拟器均完成系统输入→原样生成 TS 回放→保存值反例→移动导出；iOS 另有长按/编辑/拼音/粘贴/多指记录 | **两平台规定的输入/跨页/提交流程切片通过**：各自完整正反证据；iOS 新增切片分别记账，原生故障矩阵和物理设备未外推。iOS 首次原生试验保存空值原因仍未确定。 |
| M4.5 | CLI 故障矩阵，E02/E11/E12/E13；最新 Android/iOS 各自原生输入后 App terminate/AbortSignal/CLI OS SIGINT，录制及 verified run 回读共 16 PNG；各自双 worker、worker 强杀/取消、transport loss、截图超时/cleanup、宿主写盘/缺文件 export 与租约恢复，共 12 个便携运行/80 PNG | 列明模拟器、宿主故障注入切片通过；截图为先前观察时明确区分时间含义。不以此关闭完整平台/原生手势/物理设备或任意故障组合；首次计数读取及脚本加载失败保留。 |
| M4.6 | E04/E05/E06；[性能报告](../../release/recording-performance.md)、[兼容性](../../release/compatibility.md) | 当前受控 macOS 性能/缓存/十分钟切片通过；其他发布门槛未完成，不能把整项发布标完成。 |

## 本次实际读取的本地验收记录

以下 14 份 JSON 本次均存在且顶层 status=passed。status 只针对各报告 scope；同一报告的旧 remaining 不会被后续报告回写。路径属于当前机器临时证据，不是随仓库交付的便携附件，也不保证长期保留。复验时按计划重新生成报告并保存其依赖证据。

| 编号 | 本地路径 | 本次核对范围 |
| --- | --- | --- |
| E01 | `/tmp/fliwright-init-host-acceptance/acceptance.json` | 初始化、发现及生成示例；明确原生输入、exio、移动设备限制。 |
| E02 | `/tmp/fliwright-ide-acceptance/acceptance.json` | 真实宿主受控流程；旧 remaining 中的初始化、双窗口和性能已分别有 E01/E03/E04–E06 后续报告。 |
| E03 | `/tmp/fliwright-frame-window-replays/acceptance.json` | 双窗口同文件回放；nativeInputGatePassed=false。 |
| E04 | `/tmp/fliwright-frame-core-1002/benchmark.json` | 当前截图实现、core 三种模式各 1,002 动作。 |
| E05 | `/tmp/fliwright-frame-vitest-1002-isolated/acceptance.json` | 完整 CLI/Vitest 三种模式、持久化及便携导出。 |
| E06 | `/tmp/fliwright-frame-recorder-soak/acceptance.json` | 600,000.815ms、千次动作、缓存预算、归档、便携读回及资源释放；releaseGateComplete=false。 |
| E07 | `/tmp/fliwright-dart-recording-native/acceptance.json` | 生成 Dart 自身分析及运行；目录名称不是输入来源证据。 |
| E08 | `/tmp/fliwright-dart-evidence-producer/acceptance.json` | 独立 Dart 验证文件与指纹。 |
| E09 | `/tmp/fliwright-dart-evidence-consumers/acceptance.json` | CLI/MCP/IDE 消费相同 Dart 验证身份。 |
| E10 | `/tmp/fliwright-dart-import-host/acceptance.json` | 宿主导入/保存与失败降级 draft。 |
| E11 | `/tmp/fliwright-real-finalization-matrix-verified/acceptance.json` | 丢截图响应+挂 cleanup、项目 cleanup 抛错、父目录不可写。 |
| E12 | `/tmp/fliwright-scenario-real-matrix/acceptance.json` | 公共命名 scenario 重复上述三种故障，检查实际指纹。 |
| E13 | `/tmp/fliwright-whole-test-live-acceptance.json` | 双 worker 整测试串行、业务计数 0→12→24、便携 PNG。 |
| E14 | `/tmp/fliwright-registration-live-acceptance.json` | aroundEach/scenario 重试的两个 attempt、失败历史与最终 flaky。 |

## 后续执行顺序

1. M1.4 已修复直接 Vitest/preset 与 IDE JSON 入口遗漏 worker 终态恢复；保留 3 路并发原始 running Timeline 现场、稳定失败/通过回归及 15 轮共 165 attempt 复验。历史缺 Trace 原现场不足，若重现需继续检查；8 路压力下触发外层 6 秒进程超时属另一种现象，未调整预算或声明修复。
2. M3.12：原生输入条件就绪后，按原生鼠标/键盘、IME、清空/替换、长按/拖动和 unsupported 手势分别记录；跨页生成文件原样回放并验证业务反例。
3. M4.3：把每条新通过的关键流程分别扩展至双窗口、重建控件树、连续 20 次及反例，不重复计入已有单一流程的 40 次结果。
4. M4.2：指定 exio 可用后交付命名 scenario、app-owned auth seed、mock、认证业务结果与错误分支；不替换目标 App 或真实登录。
5. M4.4/M4.5：保留 Android/iOS 原生输入正反流程、原生录制三种中断与当前移动 VM 故障/租约报告；后续按尚缺的明确场景补证据，不重复计算既有切片。iOS 首次空值现象独立追查，物理设备与其余平台不外推。
6. 所有门槛满足后再关闭 M4，更新兼容性与性能结论；稳定源码变化后生成 feature docs，保留失败和未验收记录。

当前整体目标未完成。现有实现、受控 VM、宿主与性能切片不抵消原生输入、指定业务 App 和移动平台的独立门槛。

## 历史偶发失败专项复核（2026-10-17）

[三次失败诊断](./2026-10-17-recording-incident-review.md)已用真实窗口隐藏/最小化复现旧 settle 的首动作失败及截图等待，并验证当前修复；恢复窗口后的 hasScheduledFrame=true 变体 5/5 复现，当前实现 5/5 正常。历史具体窗口触发仍缺记录。iOS 首轮原始录像与同期无文字事件将空值问题收窄到输入应用阶段，尚无系统/engine 层确切根因；不继续将它描述成已证实的录制丢字。

后续 iOS 系统历史日志确认失败轮 UIKit 收到 12 个合成按键；成功轮也有相同 shouldSend=0，不能据此判断丢弃。新增 TextInput 通道/controller 观测后，录制开关、截图开关、显式键盘等待及全新模拟器首次输入合计 24 轮全部通过（12 轮开启录制）；没有复现空值，没有产品修复。可复用诊断探针和证据随交接包附带，历史故障保持未关闭，详见同一专项报告。

再次复核发现失败轮 KeyEventComplete 通知晚于 Save，成功轮相反；通知时点不等于 controller 更新时点，仍属竞态线索。前述 24 轮在输入/保存间带诊断请求，因此另跑立即提交、被动指针/controller 观测和两种隔离键盘服务延迟共 32 轮，全部通过（16 轮录制），历史空值仍未复现。立即提交与被动观测首轮各有一次 XCTest 内部焦点重试，明确单列。采证脚本取消输入/Save 间请求，新增中止状态保留，并修正 ZIP 中误脱敏的固定 HTTP 回调；工具故意失败负对照独立记账。不改产品输入语义，完整平台门槛不变。
