# 自动化执行与过程记录闭环补全实施计划

> 对应设计：[自动化执行与过程记录闭环补全设计](../specs/2026-10-16-automation-recording-completion-design.md)
>
> 拆分结果：5 个里程碑、41 项任务。每项列明主要所有者、前置依赖与完成条件。先交付 M0 + M1，再按依赖推进 M2/M3，最后执行 M4。
>
> 表内“完成条件”是完整验收标准。已有实现与本轮验证证据单列在文末；切片验证不代表对应整项任务或里程碑已经完成。
>
> 当前逐项证据与剩余验收见[41 项任务验收核对](./2026-10-16-automation-recording-completion-acceptance-audit.md)。历史报告保留运行当时的状态，后续证据不会回写旧报告。

## 目标与交付边界

建立统一的运行结果、失败证据和产物身份，使普通自动化动作能够可靠记录；再将可靠目标捕获、录制生成、检查点确认和回放验证接入同一模型。最终通过真实 Flutter App、CLI、MCP、VS Code 与移动平台验收。

任务按主要所有权拆分：

| 所有者 | 主要工作 |
| --- | --- |
| `fliwright-bridge` | Flutter 指针分发前目标冻结、录制输入监听、录制协议生产端、测试 Binding |
| `fliwright-core` | RunSession、动作生命周期、配置模型、录制聚合/解析/生成、Timeline/Trace 投影、产物模型 |
| `fliwright-vitest` | Vitest runner adapter、preset、attempt/task 生命周期与 runner 结果归一化 |
| `fliwright-cli` | init/run/record/artifacts/doctor 的配置、取消、查看与导出入口 |
| `fliwright-mcp` | 复用公共录制会话和结构化结果 |
| `fliwright-vscode` | 录制审阅、回放工作流、Run Viewer 与诊断入口 |
| `e2e` / Flutter fixture / exio | 跨边界回归和真实业务验收，不承载可复用产品实现 |

跨包任务依赖前序公开契约，不新增反向依赖。每项按其包的测试、类型检查和 lint 验证；协议、selector、codegen、runner 生命周期和真实 Flutter 流程分别遵循设计第 10 节的专门验收要求。

## 设计覆盖与任务导航

以下映射用于核对设计范围；任务详情、依赖与验收条件见对应里程碑表。共 41 项顶层任务，M3.11a–e 是 M3.11 的内部执行步骤，不重复计数。

| 设计章节 | 对应任务 | 主要交付物 |
| --- | --- | --- |
| §2 总体架构与约束 | M0.1–M0.4、M1.1、M2.4 | 技术探针、公共契约、包职责和共享配置模型 |
| §3.1–§3.2 自动动作与证据 | M1.1、M1.4–M1.5、M2.1–M2.2、M2.9 | 完整动作边界、endpoint 租约、standard/full/off 策略及默认记录回归 |
| §3.3 Trace 定位 | M1.2、M2.3 | 以 Timeline/result 为事实来源的 Trace 投影 |
| §4.1 事件前固定目标 | M0.2、M3.2–M3.3 | RecordingBinding、共用 selector 匹配器、冻结候选与可靠性判定 |
| §4.2 录制协议 | M0.4、M3.1、M3.5 | v2 握手、会话与序列校验、单位及 stop flush |
| §4.3 输入与手势 | M0.3、M3.4–M3.5、M3.12 | 焦点输入会话、IME/空值、保真手势及真实录制回归 |
| §4.4 会话与资源 | M3.6、M2.7 | 结构化捕获状态、共享生命周期、有界取消和资源清理 |
| §5 脚本到业务测试 | M3.7–M3.11 | readiness 守门、确认检查点、scenario 回放、IDE 审阅及 Dart 独立验证 |
| §6 结果与失败证据 | M0.1、M1.2–M1.4、M1.9 | runner adapter、结果归一化、统一失败采集及真实子进程回归 |
| §7 运行与便携产物 | M1.6–M1.9、M2.8 | canonical run/manifest/report、原子持久化、中断恢复和移动导出包 |
| §8 入口一致性 | M2.4–M2.8、M3.10 | preset/init/run/record/doctor、MCP 与 VS Code 配置和流程贯通 |
| §10.1 既有失败回归 | M1.9、M2.9、M3.12、M4.5 | 覆盖结果、动作、输入、重试、导出和中断的故障矩阵 |
| §10.2 App、IDE 与反例 | M4.1–M4.4 | Extension Host、exio、macOS 多轮多窗口及 Android/iOS 验收 |
| §10.3 性能与数据规模 | M0.5、M4.6 | baseline/standard/full 对比、P95、长录制和缓存预算报告 |

## 依赖顺序

```text
M0 技术验证与契约
 └─ M1 运行身份、runner 结果、失败证据、run manifest/export
     ├─ M2 默认动作记录、Trace 投影、统一配置和入口
     └─ M3 可靠录制、生成状态、检查点确认、scenario 回放
          └─ M4 发布验收与兼容性声明
```

M0 中的录制捕获原型可与 runner hook 探测并行；M1 先完成公共结果/产物契约，再接入自动动作和录制产品流程。M3 的目标捕获实现可在 M1 期间准备，但“保存为可回归测试”依赖 M1 的 run/attempt 身份与 M2 的动作/证据模型。M2/M3 按任务依赖交错推进：M2.7 的入口最终接入依赖 M3.6 的公共录制生命周期，M3.7 则依赖 M2.1；阶段编号不表示必须先完成整个 M2 才能开始 M3。

## M0：契约与技术验证

| ID | 任务与所有者 | 依赖 | 完成条件 |
| --- | --- | --- | --- |
| M0.1 | Vitest hook 时序探针（`fliwright-vitest`） | 无 | 用 Vitest 4.1.11 真实子进程验证 task/attempt、setup/body/teardown、skip、timeout、retry、`test.fails`、suite/collection failure 和 worker crash，输出 hook 顺序与可用结果字段。 |
| M0.2 | Flutter before-dispatch 捕获原型（`fliwright-bridge`） | 无 | 验证 `FliwrightRecordingBinding` 在业务回调前冻结目标；导航立即销毁控件后仍保留原目标；pointer up/cancel 继承并清理目标；不兼容 binding 明确拒绝录制。 |
| M0.3 | 输入监听原型（`fliwright-bridge`） | 无 | 焦点 EditableText controller listener 捕获首段输入、IME 提交和空值；提交/失焦/stop flush；销毁解除监听，避免全树轮询。 |
| M0.4 | 定稿跨包契约（core + bridge + Vitest） | M0.1–M0.3 | 定义 recording config、协议 v2、operation/attempt/test/evidence 状态、RunSession、endpoint lease、manifest 和 RecordingResult 的生产/消费契约；明确单位、schema 版本与错误语义。 |
| M0.5 | 基线与受控验收夹具（`e2e` / Flutter fixture） | M0.2、M0.3 | 增加计数器、双页销毁表单、重复文案、滚动、可配置失败及 IME 输入场景；在固定机器记录可复现的现有基线，定义 standard/full 同口径测量脚本和缓存预算测量方式，最终对比由 M4.6 验收。 |

**M0 退出门槛：**导航即时销毁、IME/清空、body/setup/teardown 失败均能在探针中得到正确上下文；接口/schema 和性能基线可供 M1/M3 直接实现。

### M0.1 既有探针记录（实施时复核）

- `onBeforeRunTask` 在 task 执行前触发；预先 skip 的 task 随后直接返回，不触发 attempt、`onTaskFinished` 或 `onAfterRunTask`。adapter 必须在该入口识别 skip。
- `onBeforeTryTask` 在 `beforeEach` 前提供 retry/repeat 序号，可作为 attempt 开始点。
- `onTaskFinished` 每次 attempt 都触发，在 `beforeEach`/body 结果已知后、`afterEach` 与 fixture cleanup 前触发。setup 失败仍会进入该 hook，body 不运行。
- teardown 失败发生在 `onTaskFinished` 之后；`onAfterRetryTask` 在 afterEach、fixture cleanup 和 `onFinished`/`onFailed` hooks 之后读取更新结果。retry resolution 后可能再次调用，参数是刚结束的 retry 序号。
- `onAfterRunTask` 在最终 retry 和 `test.fails` 预期失败转换后触发。`test.fails` 的 observed failure 在 `onTaskFinished` 可见，最终 task 结果则是 pass。
- `beforeAll` 失败归 suite；被阻断的子测试不进入 task hooks，需由 `onAfterRunSuite` 观察 suite failure。
- worker 进程强杀不会执行该 worker 的 task 完成 hooks；父进程必须从 worker/run 级错误标记未完成 task，不能推断 passed。

复核入口：`packages/fliwright-vitest/tests/runner-lifecycle-probe.test.ts`；验证命令：`pnpm --filter @fliwright/vitest test`、`pnpm --filter @fliwright/vitest lint`。本次规划未重跑。

## M1：运行身份与失败可信

| ID | 任务与所有者 | 依赖 | 完成条件 |
| --- | --- | --- | --- |
| M1.1 | RunSession 与上下文隔离（`fliwright-core`） | M0.4 | 实现 `perform/checkpoint/finish`、operationId/parentId 与 AsyncLocalStorage；并发分支、嵌套操作有独立且正确的父子上下文，结束操作幂等。 |
| M1.2 | 规范化结果模型与 Timeline 状态（`fliwright-core`） | M0.4、M1.1 | 分离 operationOutcome、attemptOutcome、testOutcome 与 evidenceStatus；保留被捕获的动作错误、retry 历史和 expected-failure 的 observedOutcome；skip/interrupted 不误标 passed，更新 Timeline schema。 |
| M1.3 | Vitest runner adapter（`fliwright-vitest`） | M0.1、M1.1、M1.2 | setup 前建立 session，cleanup 前采集 body/setup 失败，cleanup 后完成 attempt，最终 task hook 归一化 retry/expected-failure；调用基类并保留 assertion/snapshot 行为，父进程处理 suite/collection/worker 错误。 |
| M1.4 | 统一失败归一化与证据采集（`fliwright-core`） | M1.1、M1.2 | runner、FailureCollector、AssertionTimeline 与节点生命周期共用 EvidenceCapture；按 failureId 去重；截图/快照/诊断独立超时，默认采集总预算 3 秒、测试收尾 5 秒；采集失败保留原错误，失联时明确标注 last-known 证据。 |
| M1.5 | endpoint 执行租约（core + Vitest） | M0.4、M1.1 | 在规范化 endpoint 上跨 worker/进程及工作目录互斥；同 App 的整条测试从 setup 到 teardown、fixture cleanup、最终证据收尾串行，重试保留占用；动作和截图共用租约且嵌套可重入，不同 App 可并行；异常、取消和进程退出释放占用，真实子进程验证无串扰。 |
| M1.6 | runDir、manifest 与原子持久化（`fliwright-core`） | M1.2 | 一次启动一个 runId，稳定 testId 区分同名测试，attemptId 包含 repeat/retry；多 worker 只写各自 attempt，父进程合并 manifest/report；二进制先落盘，JSONL 串行 flush，JSON 原子更新；引用相对化且无 endpoint，识别日志尾行损坏。 |
| M1.7 | canonical report、CLI show/export（`fliwright-cli`） | M1.6 | 始终写 runDir/report.json，`--output` 为带 artifact base 的副本；show 按 manifest 读取；export 校验清单引用、缺文件及路径逃逸，临时复制后原子发布；默认拒绝不完整，显式 allow-partial 列出 missing；移动包并移走原目录后仍可打开证据。 |
| M1.8 | 运行取消与中断恢复（Vitest + core + CLI） | M1.3、M1.6 | SIGINT/取消有界 flush 并标 interrupted；父进程将 worker crash 的未完成 task 标 interrupted；通过已 flush 日志重建可用记录，残留 running 不推断成功，缺口/损坏明确标 partial。 |
| M1.9 | M1 端到端回归（Vitest 子进程 + CLI） | M1.3–M1.8 | 用真实子进程覆盖零动作 throw、断言、setup/teardown、timeout、retry、expected-failure、skip/cancel、collection/suite failure、worker crash、multi-worker 和同名测试；逐项断言同一 run manifest/report、attempt 结果、证据和移动 export 的一致性。 |

**M1 退出门槛：**零动作失败不再产出空白且看似完整的 run；报告、Timeline/Trace 投影输入与 runner 最终结果一致；可移动 export 中引用均在包内。M1.9 必须使用真实 Vitest 子进程，不以模拟 hook 的单元测试代替。

## M2：默认过程自动记录与入口统一

| ID | 任务与所有者 | 依赖 | 完成条件 |
| --- | --- | --- | --- |
| M2.1 | 公开逻辑动作自动生命周期（`fliwright-core`） | M1.1、M1.2 | Page/Locator/helper 在完整公开操作边界调用 RunSession；记录目标、耗时、源位置及最终结果；bridge `success:false` 视为动作失败；嵌套 helper、重试和 raw `sendRequest` 不重复生成同等级节点。 |
| M2.2 | 动作证据调度与 recording mode（`fliwright-core`） | M2.1、M1.4、M1.5 | 实现设计 §3.1 行为表：standard/full 每个逻辑动作一次动作后图，并采集测试起止；full 增加动作前图/快照，off 保留最小报告及显式请求；失败立即采集，错误不覆盖操作错误；同 App 截图纳入 lease，截图遵守项目敏感信息策略。 |
| M2.3 | Trace 事实投影（`fliwright-core`） | M1.2、M2.1 | Trace action 与 Timeline 使用同一 operationId/结果，不重复执行或判定；Trace 顶层 test 状态取 runnerOutcome，允许断言失败而所有动作成功。 |
| M2.4 | 共享配置模型（`fliwright-core`） | M0.4 | 提供 recording、路径、runsRoot、scenarios 等类型、默认值、schema、校验和合并；优先级为参数 > 环境变量 > 已加载项目配置 > 默认值；core 不加载 TS 配置文件。 |
| M2.5 | Vitest preset 配置贯通（`fliwright-vitest`） | M1.3、M2.4 | preset 接受项目配置并传递 scenarios/recording/runsRoot 到 runner/fixture；直接 Vitest run 可获得生命周期；custom runner 有显式组合接口，缺失接入时报清晰错误。 |
| M2.6 | CLI init/run 配置贯通（`fliwright-cli`） | M2.4、M2.5 | init 生成 binding、preset、标准配置及示例脚本/测试；已有文件冲突时不覆盖并指出路径；run 参数/output/取消均映射公共模型。 |
| M2.7 | MCP 与 CLI 运行入口一致（`fliwright-mcp` + CLI） | M2.4、M2.6、M3.6 | CLI 与 MCP 调用 core 公共录制生命周期，传入参数和取消信号，返回同一 RecordingResult/readiness/issues；SIGINT、AbortSignal、timeout 和异常均有界 flush、解除监听并释放自有 driver；移除独立等待/清理逻辑和旧 recorder 回退。 |
| M2.8 | VS Code 路径、Run Viewer 与诊断（VS Code + CLI） | M1.6、M2.4、M2.5 | VS Code 默认 glob/保存路径从共享配置派生，用户 glob 保留；Run Viewer 按 manifest 中选定 testId/attemptId 精确读取并支持导出包，不扫描兄弟目录猜测；CLI doctor 显示配置来源、preset、target capture、scenario、目录和 evidence 能力；移除独立 Trace 目录开关。 |
| M2.9 | 默认动作流程回归（core + Vitest + 集成表面） | M2.1–M2.8 | 无 flow.step 的普通脚本执行两次点击和断言后，在 standard 产生两个动作、两张动作后图和断言；校验无重复动作；CLI/MCP/IDE 配置语义一致。 |

**M2 退出门槛：**普通脚本无需手写 flow.step 即具备动作与证据；standard/full/off 行为一致可解释；Trace 不再推导最终测试状态；CLI/MCP/VS Code 使用相同配置和产物模型。

## M3：可靠录制、生成与确认回放

| ID | 任务与所有者 | 依赖 | 完成条件 |
| --- | --- | --- | --- |
| M3.1 | 协议 v2 与能力握手（bridge + core） | M0.4 | sessionId/sequence/elapsedUs/frameId/targetId 与 pointer/text/focus/route 判别 payload 在两端一致；握手声明版本、before-dispatch target 和 focused-input 能力；不兼容时明确拒绝可靠录制。 |
| M3.2 | 目标事件前冻结与 selector 匹配复用（`fliwright-bridge`） | M0.2、M3.1 | pointer down 冻结 target/route/viewport/frame/祖先/候选和匹配数，pointer up 沿用 targetId；抽取实时 inspect 与录制共用的匹配 helper；预算超限/无目标标 unresolved，不在 stop 时实时 hitTest。 |
| M3.3 | 候选 selector 可靠性解析（`fliwright-core`） | M3.1、M3.2 | resolver 只校验事件内候选；按 key、semantics identifier、稳定 label/tooltip/text、稳定祖先组合 query 排序；记录匹配数和稳定级别；nth 仅草稿，坐标保留为阻塞草稿。 |
| M3.4 | 输入焦点会话与值变化聚合（bridge + core） | M0.3、M3.1 | 使用实际焦点 controller、IME 提交态和 focusSessionId；捕获自动聚焦、首段输入、粘贴、替换、删除和空字符串；输入不跨导航/提交合并，必须先于提交；默认 fill(finalValue)，逐字 type 需显式模式和完整事件；敏感文本沿用掩码并参数化回放值。 |
| M3.5 | 手势单位、排序与 stop flush（bridge + core） | M3.1 | durationMs 与 Flutter logical pixels/viewport/pixelRatio 明确；longPress/drag 可保真，unsupported 多指操作阻止可靠性标签；sequence 幂等去重/缺口检测；stop flush 并返回 lastSequence，等待或超时标 partial。 |
| M3.6 | RecorderController 结构化状态与资源清理（`fliwright-core`） | M3.1–M3.5 | 保留 start/stop 主接口，stop 返回统一 RecordingResult；captured/partial/failed 与生成/回放状态分离；并发/重复 stop 只 flush 一次且保留诊断；公共生命周期在启动失败、stop 失败/挂起、取消时有界清理 listener/sampler/自有 driver，并保留原错误；同一结果供帧编辑、生成和持久化。 |
| M3.7 | Script/test readiness 与 codegen 守门（core + CLI） | M2.1、M3.3–M3.6 | 默认生成 `.fliwright/scripts/<name>.script.ts` 并使用 script fixture；test mode 使用 test fixture 与 `.fliwright/tests/<name>.test.ts`，条件不足时仅保存草稿/issues；partial/failed 捕获不能绕过守门；记录 automationKind/readiness 与指纹，成功回放才写 verifiedRunId；代码、selector、检查点或 scenario 修改后实际撤销 verified。 |
| M3.8 | 可确认检查点模型（core + CLI/MCP/VS Code） | M2.4、M3.7 | 候选含位置/query/matcher/expected/证据来源/原因/确认状态；仅确认后生成 expect；零实际断言的 test 无效，script 不要求断言；业务副作用不从点击推断。 |
| M3.9 | scenario 绑定与显式回放验证（Vitest + CLI + core） | M2.5、M3.7、M3.8 | CLI 支持 `record --mode test --scenario <name> --assertions <file> --verify` 并真正执行已生成代码；绑定 scenario 名称和实际定义指纹；成功关联 verifiedRunId，失败保留原录制与失败 run，不自动改 selector 重跑；使用命名 TestScenario 与 app-owned auth seed，执行实际断言并验证零断言守门。 |
| M3.10 | MCP/VS Code 录制审阅和保存测试（MCP + VS Code） | M3.6、M3.8、M3.9 | CLI/MCP 返回相同 readiness/issues/verification；IDE 可确认检查点、发起回放、保存测试；CodeLens 先运行指定测试，成功才启动录制，失败时保留失败 run。 |
| M3.11 | Dart 输出能力边界（core codegen + Flutter 验收） | M3.3、M3.7 | Dart 输出显式包含 app test 入口/import/integration_test；不支持的 query/assertion 返回问题，不降级成 type finder 或错误 semantics label；只有自身编译及真实运行后才标 verified。 |
| M3.12 | 真实录制回归（Flutter fixture + core） | M3.2–M3.11 | 使用原生鼠标/键盘/设备触控录制双页销毁表单；验证输入先于提交，原样生成后连续回放；长按、IME、清空、重复文案、序列缺口与 unsupported gesture 有确定性回归。 |

**M3 退出门槛：**跨页目标来自事件发生时的冻结信息；真实录制生成的代码未经人工修改可连续回放；确认的业务反例能失败；录制命令在正常、失败和取消时都正确退出并释放资源。

### M3.11 执行子任务：Dart 输出能力边界

以下为 M3.11 内部拆分，不新增顶层任务，也不表示 M3.3/M3.7 已全量验收。延续已有敏感输入参数化实现；每个子任务独立记录验证结果。

| 子任务 | 所有者与交付物 | 前置 | 验收条件 |
| --- | --- | --- | --- |
| M3.11a | core：明确 Dart 生成所需的 app 入口与输出前提 | M3.7 | 生成选项明确 app 入口 import；缺失时返回阻塞问题，不发布看似可运行的文件。生成文件包含所需 Flutter/import、binding 初始化、`app.main()` 和启动等待。说明目标项目必须已安装 `integration_test`；不自动变更项目依赖。 |
| M3.11b | core：建立可保真转换的 SelectorQuery 支持边界 | M3.3、M3.11a | 递归校验整个 query，不忽略复合条件或未知字段。不支持的 role、hint、组合约束等返回带操作位置和原因的问题；只有语义等价的查询才生成 finder，不回退到 `find.byType(Widget)`，不把 role/hint 当 label。确定性回归覆盖支持与拒绝路径。 |
| M3.11c | core：动作、检查点与 Dart readiness 守门 | M3.11b | 保留敏感值参数化、空值和动作顺序；长按明确处理 `durationMs`，无法保真的操作或断言返回问题。确认检查点不得被静默丢弃；问题使结果保持 draft。Dart 验证与 TS 验证分开，不能继承 TS 的 verifiedRunId。 |
| M3.11d | Flutter fixture + core：对原样生成的 Dart 文件做分析、编译和实际运行 | M3.11c | 在受控 app 中使用声明的入口生成文件，不人工修代码；完成静态分析、目标平台构建与实际运行。覆盖启动、点击、输入/清空、支持的定位及检查点；业务反例必须失败。敏感参数缺失明确失败、传参后可回放，证据不包含输入明文。 |
| M3.11e | core + CLI/MCP/VS Code 消费者：接入 Dart 专属验证结果和诊断 | M3.11d、M3.9、M3.10 | 所有入口消费同一能力问题与 readiness；只有对应 Dart 内容与环境完成自身编译及实际运行后才显示 verified，并关联自身运行证据。修改入口、代码、selector、检查点或 scenario 后撤销验证；失败保留生成草稿、诊断及原录制。 |

建议按 a → b → c → d → e 顺序交付；d 不因 TypeScript 单测通过而关闭，e 的入口闭环仍依赖 M3.9/M3.10。每份验证证据记录生成文件指纹、app 入口、Flutter/平台版本、执行命令、结果与脱敏证据位置。缺少设备或 app 运行结果时保持“未验收”，不提前关闭 M3.11。

## M4：发布验收

| ID | 任务与所有者 | 依赖 | 完成条件 |
| --- | --- | --- | --- |
| M4.1 | VS Code Extension Host 全流程（`fliwright-vscode`） | M2.8、M3.10 | 实测初始化发现、审阅、确认断言、回放验证、保存测试、失败查看和导出包打开；同时验证 CLI runner 和直接 Vitest runner。 |
| M4.2 | exio 真实业务闭环（exio + 命名 scenario） | M3.9、M3.12 | 至少一条认证业务闭环和一个错误分支，使用 app-owned auth seed 与 mock；检查实际业务结果和失败反例，不以进程退出码代替。 |
| M4.3 | 多轮与多窗口稳定性（Flutter fixture / macOS） | M3.12 | 每条关键录制流程连续回放 20 次；至少两种窗口尺寸并重建控件树；成功和“保存未生效/错误文案/目标消失”反例均验证。 |
| M4.4 | Android/iOS 能力验收（设备测试） | M3.12 | 每个平台至少跑通一条输入、跨页、提交流程；没有设备证据的平台继续标记未验收，不外推 macOS 结论。 |
| M4.5 | 取消、并发、强杀和导出故障矩阵（全链路） | M1.8、M2.9、M3.12 | 覆盖 VM 断开、SIGINT、worker kill、fixture cleanup 错误、截图超时、缺文件 export；无 endpoint 操作串扰，状态和遗留资源符合设计。 |
| M4.6 | 性能/缓存门槛与兼容性声明（core + 发布文档） | M0.5、M2.9、M3.12 | 报告 baseline/standard/full 的操作、采集和总耗时；standard 截图额外耗时 P95 ≤ 300ms，10 分钟录制稳定，1,000 动作后二进制证据/原始事件缓存受固定预算约束；未达标时提出实现或指标调整并更新兼容性声明。 |

**M4 退出门槛：**完成设计第 10 节真实 App、IDE、平台、故障和性能门槛；按实际证据更新平台能力声明，不将未测平台标记为通过。

## 首轮建议

首轮先完成 **M0.1–M0.5 与 M1.1–M1.9**。M0 是高风险技术可行性验证，M1 建立后续自动记录、录制回放和 Run Viewer 共用的结果与产物基础。M1 完成后再根据真实子进程与 Flutter 夹具结果锁定 M2/M3 的实现细节。

实施每个包时遵循仓库质量门槛：TypeScript 按受影响 package 运行 test/build/lint，Dart 运行 analyze/test；跨包协议和依赖边界变更运行 `node scripts/verify-harness.mjs`。稳定 API 有显著变化后使用 `/document-features` 更新生成式实现文档。真实 E2E 验收需提供可连接的 Flutter VM Service，并记录设备/应用版本和运行结果。

## 可执行工作包

工作包便于分批交付，不替代上面的任务依赖；每包应交付代码、对应边界测试与可定位的验收记录。单个任务涉及多个包时先交付公共契约，再接入消费者。

| 顺序 | 任务范围 | 交付物与审阅重点 |
| --- | --- | --- |
| 1 | M0.1–M0.5（5 项） | runner/Flutter 技术探针、受控 fixture、协议与结果契约、可复现性能基线；决定采集时机是否可行。 |
| 2 | M1.1–M1.6（6 项） | RunSession、runner adapter、失败证据通道、跨进程 endpoint lease、统一 ArtifactStore；检查结果来源与资源所有权。 |
| 3 | M1.7–M1.9（3 项） | CLI run/show/export、取消恢复与真实子进程回归；移动导出包验证引用，满足 M1 退出门槛。 |
| 4 | M2.1–M2.6（6 项） | 完整动作边界、证据策略、Trace 投影、共享配置及 preset/init；验证两次点击加断言和 standard/full/off。 |
| 5 | M3.1–M3.6（6 项） | bridge/core 协议、冻结目标、输入/手势聚合、公共录制生命周期；覆盖历史目标、乱序/缺口及失败清理。 |
| 6 | M2.7–M2.9（3 项） | CLI/MCP 公共录制接入、manifest 驱动的 Viewer 与配置诊断；验证入口一致性与精确 attempt 选择。 |
| 7 | M3.7–M3.12（6 项） | script/test 生成、确认检查点、scenario 验证、IDE 审阅和 Dart 能力守门；真实录制原样回放，业务反例失败。 |
| 8 | M4.1–M4.6（6 项） | Extension Host、exio、macOS 多轮、移动设备、故障矩阵及性能报告；更新实测平台声明和生成式 feature docs。 |

## 当前收尾任务拆分（2026-10-17）

以下是既有任务的后续执行切片，不新增顶层任务，也不重新安排已存在的实现。状态持续按本文验证记录更新；历史通过记录不自动关闭整项任务。

| 顺序 / 子任务 | 所有者与工作范围 | 前置依赖 | 独立交付与验收 | 当前状态 |
| --- | --- | --- | --- | --- |
| 1 / M1.4a | core 配置 + Vitest：定义整个测试收尾预算 | M2.4 共享配置 | 在共享 recording 配置中增加独立的收尾预算，默认 5 秒，与默认 3 秒的 failure capture 预算分开；明确预算起点、作用范围和优先级，验证项目配置、环境和显式配置贯通及非法值拒绝。 | 已实现并验证：`testFinalizationBudgetMs` 默认 5000；限定 Fliwright 自身收尾累计耗时，项目 hook 继续由 Vitest `hookTimeout` 管理。 |
| 2 / M1.4b | Vitest：执行有界收尾并保留原始错误 | M1.4a、M1.3 | 被动诊断、失败投影、flush 和自有 driver cleanup 使用同一剩余预算；超时或清理失败保留 runner 原错误及已保存证据，记录超时阶段并标 partial；迟到的异步结果不能覆盖最终状态。 | 已验证挂起插件下 Driver 的 WebSocket/HTTP 释放、worker 存储挂起时的脱敏终态交接及真实 VM 取消。真实 Flutter 截图丢失叠加挂起 cleanup、项目 fixture cleanup 抛错、App SIGKILL 与父进程 run 目录不可写切片通过；父进程持久化失败通过 RunFinalizationError 保留原 runner 结果和磁盘原因，不宣称写入成功。详见文末故障记录。 |
| 3 / M1.4c | Vitest 子进程 + CLI：收尾预算回归 | M1.4b、M1.7 | 分别注入诊断挂起、投影失败、持久化受阻、cleanup 挂起/抛错；验证进程有界结束、原错误保留、result/Timeline/Trace/report/manifest 状态一致；移走原目录后检查 partial export 仍能读取最后证据。 | 已补真实 Vitest 子进程 9 个 attempt 场景、CLI partial export、worker 写入挂起时主体成功/失败的 reporter 恢复，以及 canonical manifest/报告副本/worker 恢复写入失败的原错误保留回归。真实 Flutter 三项故障切片通过，移动导出回读及两张保留截图 OCR 正确；其他平台和故障组合仍独立验收。 |
| 4 / M2.2a | core + Vitest：补齐 recording mode 行为矩阵 | M1.4、M1.5、M2.1 | 使用真实 Vitest fixture 子进程执行两次公开动作和实际断言；逐项核对 standard 的动作后图与测试起止图，full 的动作前图/快照/动作后图，以及 off 的最小结果和显式证据请求；检查动作数、证据归属及无重复采集。 | 确定性验收通过：3 种模式 × 有/无业务分组共 6 例；off 失败不自动采集，显式 frame 登记并可移动导出；full Trace 使用动作后截图。真实 VM 性能另行记录。 |
| 5 / M1.9a、M4.5a | CLI + Vitest + core：确定性组合故障矩阵 | M1.4c、M2.2a、M1.8 | 组合 VM disconnect、证据超时、cleanup 错误、取消、worker crash、run 级错误与损坏日志；每个用例核对 manifest/report/attempt/Timeline/Trace 和移动导出的一致性，保存未覆盖项清单。 | 3 个组合回归通过：断连+证据超时+cleanup+collection；worker kill/取消+损坏快照+损坏日志+缺失导出文件。实际 VM 资源故障、原生输入及平台矩阵继续由 M4.5b/M3.12a 验收。 |
| 6 / M3.12a | bridge + Flutter fixture：原生录制与原样回放 | M3.2–M3.11 | 原生鼠标/键盘或设备触控录制跨页销毁表单，保存原始事件、冻结目标、输入顺序和生成源码；覆盖 IME、清空、长按及 unsupported gesture，生成文件不人工修改即可回放，业务反例明确失败。 | Android/iOS 原生跨页输入、提交销毁、原样回放及保存失败反例通过；iOS 另有系统拼音、粘贴/自动聚焦、替换/清空、600ms 长按及双指守门证据。macOS 原生权限、原生拖动/重复文案与其余完整矩阵仍保留，详见文末。 |
| 7 / M4.1a | VS Code：Extension Host 完整用户流程 | M2.8、M3.10；App 回放使用 M3.12a 环境 | 从初始化发现到检查点编辑/确认、显式回放、保存测试、失败查看及打开移动导出包完成一轮操作；覆盖 CLI runner 与直接 Vitest runner；保存宿主操作和 run 证据。 | 真实宿主已验证初始化/发现、测试与脚本执行、录制、确认检查点、scenario 回放、原样保存、直接 Vitest/CLI 两种后端、业务断言反例、失败命令、取消和源目录移走后的导出包浏览。报告 `/tmp/fliwright-init-host-acceptance/acceptance.json`、`/tmp/fliwright-ide-acceptance/acceptance.json`；初始化跳过网络安装，使用本地依赖。受控宿主流程通过，录制输入由 bridge 驱动；原生输入和完整发布门槛继续保留。 |
| 8 / M4.2a | exio + scenario：认证业务与错误分支 | M3.9、M3.12a | 在 `/Users/leo.he/projects/exio/exio_app` 使用命名 TestScenario、app-owned auth seed 和 mock 完成业务闭环；验证实际持久化/业务结果和至少一个失败反例，关联录制及验证 run。 | 依交接记录，当前 App 路径不可用；保留为环境待就绪。 |
| 9 / M4.3a、M4.4a | Flutter fixture / macOS / Android / iOS：稳定性与平台矩阵 | M3.12a | 关键流程连续回放 20 次，至少两种窗口尺寸并重建控件树；Android、iOS 各提供输入、跨页、提交证据；逐平台记录通过、失败或未验收，保留业务反例。 | 同一受控跨页测试在 821×777、640×720 各原样回放 20 次，全部 passed/complete，报告 `/tmp/fliwright-frame-window-replays/acceptance.json`。Android/iOS 原生输入/跨页/提交正反流程及 iOS 指定编辑/系统拼音/手势切片另行通过；macOS 每条关键原生流程双窗口 20 次、其他手势和完整平台矩阵仍未关闭。 |
| 10 / M4.5b、M4.6a | core + Flutter fixture + 发布文档：真实故障、性能与最终交付 | M1.9a、M3.12a、M0.5；发布收口依赖其余 M4 项 | 在真实 VM 验证同 App 多 worker 租约及断连/取消/强杀；同机同场景测 baseline/standard/full，检查截图额外耗时 P95 ≤ 300ms、10 分钟录制和 1,000 动作缓存预算；保存脱敏报告，更新兼容性声明，稳定源码变更后再生成 feature docs 与能力目录。 | 双 worker 租约、worker 强杀/取消、代理断连叠加挂起 cleanup、真实 App SIGKILL、IDE 取消与缺图导出切片通过。当前 scene + endOfFrame 实现已完成 core/完整 CLI 各模式 1,002 动作及 600,000.815ms 录制复验，图像回读/抽样 OCR 通过，详见 M4.6 子表；首轮 partial 反例保留。发布文档、生成式 feature docs 和能力目录已更新；剩余故障组合、原生输入及平台门槛继续保留。 |

M1.4a–c、M2.2a 和本表确定性组合矩阵已有代码级证据；受控宿主流程、双窗口回放和当前 VM 性能切片已补齐。真实截图响应丢失叠加挂起 cleanup、项目 cleanup 抛错与父进程目录不可写的最新证据见文末。后续继续推进 M3.12a、exio、其他关键流程与移动平台及剩余故障组合。原生输入权限、exio 路径和移动设备缺失不视为对应验收通过，也不阻止独立的代码与 VM 工作。

### M4.6 执行子任务：性能、缓存与长录制

**当前重新验收结果：**2026-10-17 的合成 scene 与默认 endOfFrame 修复改变截图内容和耗时。M4.6a.1/.2 已完成当前千次复验及抽样图像计数核验，M4.6a.4 已完成当前十分钟/千次录制复验；仅关闭各自受控 VM 切片，原生输入和整项发布门槛独立保留。新旧证据及限制见文末。

| 子任务 | 所有者 / 前置依赖 | 独立交付与验收 | 状态 |
| --- | --- | --- | --- |
| M4.6a.1 | core + bridge；M0.5 fixture VM | 将真实动作基准固化为仓库脚本，按相同场景轮换 off/standard/full，分别保存操作、采集及总耗时与 P95/P99；核验最终业务计数、每动作证据数量及落盘文件，记录平台/SDK/viewport，不保存 VM URL。 | 当前 endOfFrame 实现已复验：每模式 1,002 动作，standard 采集 P95 222.859ms、full 487.378ms；业务计数及全部证据数量/回读通过，27 张首中末动作前后图 OCR 计数通过。报告 `/tmp/fliwright-frame-core-1002/{benchmark,image-content}.json`。 |
| M4.6a.2 | core + Vitest；M4.6a.1 | 在完整 CLI/Vitest 路径增加高动作数测量，包含逐节点 journal、Timeline、终态持久化和导出成本；区分操作附加耗时与整个运行耗时，不用扣除采集后的数值代替总耗时。 | 当前实现无并行构建/测试负载复验 9 attempt、每模式 1,002 动作通过。standard 含动作/采集/持久化 P95 236.271ms、full 576.580ms；全运行 548,848.832ms，导出另 2,679.294ms。移走源后 3,018 PNG 可读、27 张动作边界图 OCR 正确。报告 `/tmp/fliwright-frame-vitest-1002-isolated/{acceptance,image-content}.json`；首轮 partial 反例独立保留。 |
| M4.6a.3 | core + 录制消费方；M3.6 | 为原始事件、待处理截图及二进制缓存设固定预算；大体积证据及时落盘并保留可审阅引用，最终操作和生成代码保持完整。先写超过预算的回归，覆盖磁盘失败、乱序/缺口、输入合并边界和会话重启；1,000 动作后验证峰值预算与草稿/partial 状态。 | 原始事件 JSONL、有界聚合/乱序/截图任务及截图落盘引用已实现。1,000 张不同的大 PNG 迁移解码、跨入口保存和元数据加载、磁盘失败/预算耗尽/迟到响应回归通过。当前真实 VM 千次动作、十分钟及受控 IDE 用户流程实测见文末；原生输入与完整发布门槛继续保留。 |
| M4.6a.4 | core + bridge + fixture；M4.6a.3 | 持续十分钟录制，采样内存、事件缓存和截图队列峰值；stop 后 listener/计时器/连接释放，原始顺序和最终业务结果可核验。真实原生输入验收另外保留 M3.12a，不以桥接动作替代。 | 当前实现受控 VM 复验通过：600,000.815ms、1,000 个可靠动作/帧/生成点击、2,001 连续归档事件；capture 无问题，移走源后的 1,000 张不同 PNG 均解码通过，21 张帧 OCR 计数正确。固定缓存/队列、stop 后事件/采样/连接释放通过。报告 `/tmp/fliwright-frame-recorder-soak/{acceptance,png-verification,image-content}.json`；不替代原生输入或整项发布验收。 |
| M4.6a.5 | 发布文档；M4.6a.1–4 及平台验收 | 汇总脱敏可复现证据，更新 `docs/release/recording-performance.md` 与兼容性声明，生成 feature docs 和能力目录；明确每个平台的实际验收状态。 | 持续更新，不提前宣称整个 M4.6 通过。 |

M4.6a.3 按以下顺序执行，每项保留独立红绿证据：

1. **缓存契约与观测（core）**：明确 raw-event bytes/count、二进制 bytes、pending screenshot work 的固定上限及峰值统计；预算耗尽时有可持久化原因，不将不完整录制标 captured/verified。操作/Timeline 元数据可增长，不能把原始 payload 仅改名后继续无限保留。
2. **事件归档与有界聚合（core）**：原始 v2 事件增量落盘，只留有界乱序窗口、活动 pointer/focus 编辑段；已完成操作保留紧凑结果。验证跨 batch 输入合并、text-before-up、route/失焦边界、多指、重复/缺口与 stop lastSequence；归档失败保留可读草稿与明确 partial。
3. **二进制证据与队列（core）**：采样截图先落盘再发布引用，内存只保留有界热缓存；待处理任务结束即释放，限制排队工作。验证唯一大截图连续采样、慢盘/写失败、stop/取消、迟到截图及新会话隔离，不静默减少设计要求的截图。
4. **审阅、生成与持久化消费（CLI/MCP/VS Code）**：统一读取证据引用，按需加载可见帧；便携持久化复制引用文件，去掉长期 base64 快照；生成代码不因历史帧冷却而少操作或改变检查点。跨入口对同一录制结果验证读图、编辑、再生成、迁移目录和失败恢复。
5. **预算验收（core + fixture）**：1,000 动作使用各不相同的大截图和输入，检查峰值而非最终 GC 后内存；核验全部操作/归档顺序/图片可读，故障注入必须显示 partial。随后执行 M4.6a.4 的十分钟实测。只共享同一个小截图的 synthetic case 不能代替此验收。

## 验收记录与执行前提

每项记录任务 ID、实现位置、运行命令、预期与实际结果、证据路径及未覆盖条件。完成一个工作包不能自动关闭其中缺少证据的任务；阶段退出门槛全部满足后再标记阶段完成。

| 验证层 | 执行要求 |
| --- | --- |
| TypeScript 边界回归 | 受影响包运行 build/test/lint；定向回归使用 `pnpm --filter <package> exec vitest run tests/<file>.test.ts`。消费者依赖 core 构建产物时先构建 core。 |
| Dart / Flutter | 依赖变化后 `melos bootstrap`；执行适用的 `melos run analyze`、`melos run test`，录制捕获另提供真实 Flutter 事件证据。 |
| runner / 进程边界 | 使用真实 Vitest 子进程、多个 worker 和故障进程；模拟 hook 或同进程锁测试不代替端到端验证。 |
| Harness / 文档 | 依赖、协议边界或公共能力变化后检查生成目录是否需更新，并执行 `node scripts/verify-harness.mjs`；稳定 API 的实现文档由 `/document-features` 生成。 |
| App / IDE / 设备 | M3.12、M4 记录 App 构建、平台/设备、窗口尺寸、scenario、VM Service 可用性及脱敏 run 引用；设备不可用时保持未验收。exio 路径为 `/Users/leo.he/projects/exio/exio_app`。 |

设计要求的替换行为不添加旧协议、旧目录双读/双写或旧 recorder 回退。遇到实现与设计冲突时先记录具体差异；不降低验收门槛来迁就已有实现。

## 已有实现线索与待复核项

工作区已有未提交实现，后续实施应在现有代码上继续，不重复搭建或覆盖其他工作。本次仅保留线索，原完成标记不作为全量验收依据：

| 范围 | 已有线索 | 仍需核实或补齐 |
| --- | --- | --- |
| M0 | runner lifecycle probe、recording binding、focused-input listener、Flutter fixture | 真实控件销毁/IME 证据与性能基线；有 fixture 不等于完成性能测量。 |
| M1 | RunSession、EvidenceCapture、EndpointLease、RunArtifactStore、runner/preset 与 CLI manifest/export | 失败通道接线、跨进程 lease、多 worker 单 run 汇总、取消恢复和完整 M1.9 故障矩阵。 |
| M2.7 / M3.6 | core RecordingCapture 已供 CLI/MCP 共用等待、flush、取消、资源释放；stop 返回 RecordingResult，删除字符串回退 | 协议 v2 前置、IDE 关闭与真实 VM 失联/取消等全链路场景仍待验收。 |
| M2.8 | Run Viewer manifest 读取尝试及 script glob 调整 | 根据选定 test/attempt 读取准确路径，移除兄弟目录猜测，补 Extension Host 验证。 |
| M3.7–M3.9 | 公共 RecordingAutomation 生成 script/test，确认检查点转成可执行 expect；partial/failed、未验证唯一或位置 selector 保留为草稿 | 实际 scenario 指纹与回放、零实际断言运行守门、将 verification 失效工具接入编辑/保存、IDE 确认界面和 Dart 输出。 |
| M4 | 尚缺完整发布验收记录 | 真实 App、IDE、移动设备、20 轮/多窗口、故障和性能证据；不能由现有单元测试通过推断。 |

### 2026-10-16：录制生命周期与确认检查点切片

| 对应任务 | 本轮交付 | 直接证据 |
| --- | --- | --- |
| M3.6 | `RecorderController.stop()` 直接返回 RecordingResult；并发 stop 只发一次 RPC；启动/停止错误解除监听；挂起 RPC/截图有界；重复 stop 保留原始诊断，编辑后读取当前操作和代码 | `packages/fliwright-core/tests/RecorderLifecycle.test.ts`、`RecorderController.test.ts` |
| M2.7 / M3.6 | core `captureRecording/openRecordingCapture` 统一拥有 start/wait/stop/dispose；CLI SIGINT 移除监听，MCP AbortSignal 取消后 flush 为 partial；取消/启动失败释放自有 driver | `packages/fliwright-core/tests/RecordingCapture.test.ts`、CLI/MCP `tests/record.test.ts` 及各自 core integration 回归 |
| M3.7 | 默认输出 script fixture 和 `.fliwright/scripts/*.script.ts`；不完整捕获、未确认唯一或位置 selector 使输出保持 draft；取消不发布完整脚本；持久化失败向调用者报告 | `RecordingReadiness.test.ts`、`CodeGenerator.test.ts`、CLI `tests/record.test.ts` |
| M3.8 | 公共 checkpoint schema 和生成函数；检查目标 query、matcher、expected、动作位置和显式确认；只有有效确认生成 expect，检查点按动作边界执行；不再把建议自动变成断言或仅统计布尔确认 | `RecordingAutomation.test.ts` 执行生成代码校验动作/断言顺序；CLI/MCP `tests/record.test.ts` 检查实际断言输出和不完整输入守门 |
| 调用方迁移 | VS Code stop 消费同一 RecordingResult 的 operations/frames/code，迁移现有测试 mock，不保留旧字符串结果回退 | VS Code `RecorderService.test.ts`、`recording-integration.test.ts` |

本轮完成 `pnpm build`、`pnpm test`、`pnpm lint`，以及能力目录再生成和 `node scripts/verify-harness.mjs`。TypeScript 测试结果：core 780、CLI 93、MCP 156、VS Code 323、Vitest 36（另有 3 个 expected fail）、TDD 125、Riverpod 16 均通过。最后的重复 stop/编辑结果修复另通过 core 定向回归。

这些结果只证明确定性代码与现有集成边界。尚未证明 v2 握手、bridge 同帧候选验证、真实录制/回放、IDE Extension Host、移动设备和性能门槛。实现稳定后仍需使用 `/document-features` 完整再生成实现文档。


### 2026-10-16：协议 v2 握手、会话归属与 stop 序列切片

本切片推进 M3.1 / M3.5 / M3.6，不关闭整项任务。

| 范围 | 本轮交付 | 直接证据 |
| --- | --- | --- |
| bridge 握手与启动 | 能力来自实际安装的 recording binding；未初始化或不兼容 binding 明确返回不可录制；start 必须提供 protocolVersion 2 与 client-owned sessionId | `recording_protocol_test.dart`、`recording_uninitialized_test.dart`、`recording_test.dart` |
| bridge 会话所有权 | 其他 session 不能启动或停止当前录制；同一 active session 的重复 start 幂等；stop 先 flush 再返回 protocolVersion/sessionId/lastSequence，重复 stop 保留同一响应；reset 独立清理资源 | `recording_protocol_test.dart` |
| core 严格消费 | 启动前检查能力；只接受合法 v2 事件，忽略其他会话；按 sequence 排序去重，缺口包括首段和 bridge 声明的尾段；收到末序号仍等待中间缺口，超时保留 partial 草稿 | `RecordingProtocol.test.ts`、`recorder-integration.test.ts` |
| 调用方夹具迁移 | core、CLI、MCP 集成测试生产实际 v2 envelope，动态使用 start 请求中的 sessionId；不增加生产旧协议兼容；MCP 测试等待实际启动后再注入事件，并断言确实录到一次操作 | `tests/helpers/recordingProtocol.ts`、CLI/MCP `core-integration.test.ts`、MCP `multi-tool-workflow.test.ts` |

本轮确定性验证：core 录制定向 39 项通过；core 全包 789 项通过；CLI core 集成 3 项、MCP core/多工具集成 8 项通过；bridge 全包 155 项通过、2 项跳过。`pnpm build`、`pnpm test` 与 `pnpm lint` 通过；能力目录已再生成，`node scripts/verify-harness.mjs` 通过。

`flutter analyze` 返回非零：11 项已有代码的 warning/info，包括截图层的 protected member 使用、录制 viewport 的 deprecated API 及其他测试的 import/color 提示；本切片未将分析门槛标为通过。真实 Flutter 原生事件录制与设备验收仍未执行。

当前下一步：M3.2 在 bridge 同帧生成并验证冻结候选、抽取 inspect 共用匹配器；M3.3 移除 resolver 中剩余 stop-time resolve/hitTest；M3.4 按 focus/route/target 会话边界聚合最终输入值。协议已经能校验 focus/route payload，但 bridge 的完整事件生产、候选 schema 与聚合分段仍需完成。检查点回放、IDE、移动平台、性能及生成式 feature docs 的欠项保持原验收标准。

### 2026-10-16：同帧冻结候选与输入会话顺序切片

本切片推进 M3.2 / M3.3 / M3.4 / M3.5，不关闭整阶段或发布验收任务。

| 对应任务 | 交付与行为 | 直接证据 |
| --- | --- | --- |
| M3.2 | 从 inspect 抽取共用 selector tree evaluator；录制使用原匹配器验证候选的匹配数和原 Element 身份。targetId 按会话内 Element 实例分配；节点、访问和时间预算超限时返回 unresolved。已确认唯一的强候选不继续消耗预算查询弱候选 | `selector_tree_evaluator.dart`、`recording_target.dart`；`recording_target_test.dart` 覆盖重复 key/文案、稳定祖先、预算、控件销毁与重建 |
| M3.2 / M3.4 | 所有 pointer envelope 在 binding 分发业务回调前发送；down 先 flush 前一编辑再冻结新目标，up/cancel 复用原目标；focused EditableText 归一为同一逻辑输入控件，身份不使用 inspector hash | `recording_dispatch_test.dart` 真实 widget dispatch 覆盖 down 回调销毁目标、输入与 pointer 身份一致，以及 composing flush → submit down → 业务 callback 的顺序 |
| M3.3 | core resolver 只消费冻结候选，不接收 RPC callback、不查询停止后的 live tree；稳定候选按 key/semantics/label/ancestor 排序。位置、临时 id、generic Widget 和 fallback 不成为可靠候选；缺失目标保留坐标草稿或明确阻止回放 | `RecordedSelectorResolver.test.ts`、`CodeGenerator.test.ts`、`DartCodeGenerator.test.ts`、`recorder-integration.test.ts` |
| M3.4 | bridge 生产 focus 会话事件，捕获自动聚焦、粘贴、替换、删除和空值；按 Element/controller 绑定，失焦/停止清理 listener。帧回调用于观察当前 route 实例，连续未命名导航也产生边界，stop/reset 解除回调 | `recording_input_test.dart`、`recording_dispatch_test.dart` |
| M3.4 / M3.5 | core 按 sequence 顺序聚合；只有同 targetId/focusSessionId 的连续编辑才合并为最终值 fill。去掉一秒窗口、输入 chunk 拼接和按时间猜最近 tap；route、blur、新 focus session 或下一控件动作切断合并；取消指针不形成 tap | `EventAggregator.test.ts` 新增 8 项先失败再通过的回归；`RecorderController.test.ts` 更新为显式冻结输入目标 |
| M3.4 | 输入目标元数据及 selector 候选不保存 EditableText 当前值，也不将它当稳定文案；唯一 key 的元数据采集保持预算内早停 | `recording_target_test.dart` 先证明预填值泄露及错误 label 候选，再验证 TextField/EditableText 均不携带该值 |
| 协议契约 | frozen target/candidate schema 校验身份一致、候选数量和匹配数；调用方夹具显式生产相同 targetId，协议测试经过真实 binding.dispatchEvent | `RunContracts.test.ts`、`RecordingProtocol.test.ts`、bridge `recording_protocol_test.dart` |

确定性验证：`pnpm build`、`pnpm test`、`pnpm lint` 均通过；core 802、CLI 93、MCP 156、VS Code 323、Vitest 36（另 3 个 expected fail）、TDD 125、Riverpod 16 项通过。bridge 全包 168 项通过、2 项跳过。已再生成能力目录，`node scripts/verify-harness.mjs` 通过。

Flutter widget dispatch 是本切片的事件证据，不能代替 macOS 原生输入、Android/iOS 或发布性能验收。仍需完成敏感输入事件掩码和回放参数化、真正逐字模式的能力守门、真实帧身份/手势轨迹及多窗口坐标验收；route 观测开销与复杂嵌套 Navigator 仍需纳入 M0.5/M4.6 测量和回归。真实回放/scenario 指纹、IDE 工作流、跨进程租约/多 worker 汇总、完整故障矩阵和 feature docs 完整再生成仍为待完成项。

验证日志位于本次执行环境的 `/tmp/fliwright-focused-{build,tests,lint}.log`、`/tmp/fliwright-focused-bridge-tests.log`。这些临时日志不是便携 run 产物；发布验收仍须按前文要求保存可移交的脱敏证据。

本切片最终 `flutter analyze` 返回非零，剩余 8 项既有 warning/info：截图层 protected member、其他测试的冗余 import 和 deprecated color 属性。录制代码的冗余 import 与旧 viewport API 提示已清除；不将 Dart 分析门槛记为通过。

### 2026-10-16：敏感输入掩码与参数化回放切片

本切片继续推进 M3.4，并补齐与 M3.7 / M2.3 相交的输入值处理；不把所有录制、Dart 或 Trace 工作标为完成。

| 范围 | 本轮交付 | 直接证据 |
| --- | --- | --- |
| bridge 输入事件 | 在 VM 事件发出前将非空敏感输入替换为 `<masked>`，携带 `sensitive: true`；同一焦点会话只要进入过 obscure 状态，后续显式显示明文仍继续掩码。只检查已绑定的 EditableText，不增加输入全树轮询；空字符串仍是可回放清空 | `recording_dispatch_test.dart` 先证明真实 controller 值泄露，再验证动态 obscure 切换、掩码粘贴/替换和空值 |
| core 协议及聚合 | v2 schema 接受掩码敏感事件，拒绝带敏感标记的原文；raw event、operation、frame 保留标记；连续值聚合仍保留最终 clear，不把 mask 当作普通文本回放 | `RunContracts.test.ts`、`RecordingProtocol.test.ts`、`EventAggregator.test.ts` |
| TS / Dart 生成 | 根据操作位置生成 `FLIWRIGHT_INPUT_<n>` 参数。TS 从环境读取，Dart 使用编译时环境参数；缺少参数时明确报错。TS 在动作及生成的 home reset hook 前检查；代码不嵌入掩码字符串。readiness 返回 requiredInputParameters 清单 | `RecordingAutomation.test.ts` 实际执行生成回调，验证缺参时零页面操作、补参后填入正确值；`DartCodeGenerator.test.ts` 覆盖 Dart 参数表达式 |
| 回放 Trace | TS 生成敏感 fill 时传 `sensitive: true`；Locator 保留真实回放值，并传递敏感标记。Trace 使用真实 selector，输入参数及包含同一输入值的错误文本掩码，不把填充值误当目标 selector | `Locator.test.ts`、`TraceCollector.test.ts` 验证实际写出的 trace.json 不含该输入值 |
| 可编辑 Flow | Flow 保存敏感标记，重新生成时使用同一参数命名，不输出 `fill('<masked>')`；忽略的操作不回放，明确保留清空值 | `flow/FlowTestGenerator.test.ts` 执行由录制 Flow 再生成的脚本，验证缺参拒绝和参数填充 |
| CLI / MCP | 两个入口复用同一 requiredInputParameters/readiness；CLI 生成文件和 recording.json 保留参数说明，不嵌入输入值 | CLI/MCP `tests/record.test.ts` |

验证：`pnpm build`、`pnpm test`、`pnpm lint`、能力目录再生成及 `node scripts/verify-harness.mjs` 均通过。TypeScript：core 811、CLI 94、MCP 157、VS Code 323、Vitest 36（另 3 个 expected fail）、TDD 125、Riverpod 16 项通过。bridge 全包 169 项通过、2 项跳过；`flutter analyze` 非零，仍为前轮列出的 8 项既有 warning/info。

日志：`/tmp/fliwright-sensitive-{build,tests,lint}.log`、`/tmp/fliwright-sensitive-bridge-{tests,analyze}.log`。本轮 Dart 证据仅覆盖生成输出的参数表达式，不能视作自身编译或设备验证。任意业务截图/快照、其他 runner 错误通道的统一隐私策略仍需在 M1.4/M2.2 中审计；本切片不声称替代该范围。

下一实施重点：M3.11 明确 app 入口、严格支持的 query/assertion 与 Dart 自身编译/运行；其后继续处理未完成的 runner 失败/Trace 结果通道和跨进程/多 worker 产物。原计划的真实回放、IDE、设备、性能及 feature docs 完整再生成门槛保持不变。

### 2026-10-16：Dart 输出入口、能力守门与 macOS 编译回放切片

本切片推进 M3.11a–d，并修复 M2.3 的 Trace 最终状态持久化；不关闭 M3.11e、M1 或 M3 整体。

| 范围 | 本轮交付 | 直接证据 |
| --- | --- | --- |
| M3.11a | 公共 `dartAppEntrypoint` 要求 app-owned package URI；生成 integration binding、必要 imports、`app.main()` 与启动等待。缺失入口产生失败草稿，敏感参数在 app 启动前检查 | `DartCodeGenerator.test.ts`、`RecordingAutomation.test.ts`、CLI/MCP `record.test.ts` |
| M3.11b | `generateResult()` 返回 code/issues/assertionCount；支持保真的 key/text/type、同一 match 内的交集与 within/containing，严格拒绝未支持字段与条件，不丢弃约束。key 保留不同 ValueKey 值类型的 bridge 匹配规则；text 保留 Text/RichText/EditableText；类型按 runtime 名称匹配，无需猜 app 类 import | `DartCodeGenerator.test.ts` 覆盖 role/hint/label/tooltip/name/ancestorKey/semanticIdentifier/filter/fallback/and 等拒绝路径、嵌套问题、未知字段与冲突 position |
| M3.11c | 生成真实 durationMs 长按、drag offset、输入及清空；Dart 字符串转义 `$`，不将输入当插值执行。确认的文本/可见检查点生成可执行 expect；不支持的 matcher 阻塞生成，未执行断言不计数。CLI/MCP 共用问题与 readiness；CLI 的 TS verifier 不得给 Dart 写 verified | `DartCodeGenerator.test.ts`、`RecordingAutomation.test.ts`、CLI/MCP `record.test.ts`；原有 recorder integration 更新为显式入口 |
| M3.11d（macOS 受控切片） | 增加 `recording_replay_main.dart`，与人工录制 binding 入口分开；夹具按钮提供不同的点击/长按结果。验收脚本在临时 app 副本中按锁文件解析 SDK，生成文件保持原样，分析后执行缺参、成功及业务反例，保存源码/输入/指纹/版本/命令/日志 | `scripts/verify-dart-recording.mjs`、`examples/form_demo/test/recording_fixture_test.dart`；本次最终证据 `/tmp/fliwright-dart-recording-native/acceptance.json` |
| M2.3（core 状态持久化切片） | Trace 不再丢弃 `complete(status)` 参数或从动作是否失败推导测试状态；保留 runner 指定 passed/failed/skipped/interrupted。被捕获动作失败与最终 passed 可并存；`success:false` 即使 transport 正常也保留 action 失败事实 | `TraceCollector.test.ts` 新增 5 项先失败后通过的回归 |

最终 Dart 验收使用 Flutter **3.41.9 / Dart 3.11.5**、macOS App，代码指纹为 `da40f60af01ff159bed2ca695627f692e6e9e8732bd6c0a39f6574e4c0e33100`。`flutter analyze` 成功；三次实际 App 构建均成功：缺少 `FLIWRIGHT_INPUT_7` 时失败于参数检查，传参后成功完成计数/600ms 长按/跨页/填写/清空/提交销毁/确认断言，注入 `FLIWRIGHT_FIXTURE_FAIL=true` 后明确失败于 `business-result`（实际 `Configured failure`、预期 `Configured success`）。进程报告了无法将窗口置前，但 App 已启动并实际执行测试；本证据不包含原生人工输入或窗口交互验收。

可复现命令：先 `pnpm --filter @fliwright/core build`，再执行 `node scripts/verify-dart-recording.mjs --flutter <匹配锁文件的 Flutter SDK>/bin/flutter --device macos --output <证据目录>`。macOS 临时路径必须 realpath 规范化；验收脚本检查实际 App 构建日志，避免 Flutter 将路径别名下的 integration test 误判成 host widget test。先前 `/tmp/fliwright-dart-recording-isolated/` 的通过仅为 host 模式，不作为设备证据；`-native/` 是修正后的最终证据。3.47.2 与已有锁文件不匹配，`--enforce-lockfile` 明确拒绝升级，未变更依赖要求。Flutter 自动修改的原仓库 native 工程文件已还原，最终脚本在临时副本内构建。

待完成：M3.11e 仍需接入 Dart 自身编译/运行的公共验证结果与 IDE 入口，目前输出只标 generated；不继承 TS verifiedRunId。M1/M2 的 runner→fixture→Timeline/Trace 最终状态传递、cleanup 前证据与最终 expected-failure 状态仍需真实子进程验证；本次 core Trace 修复不等于接线完成。此前标记的多 worker 汇总、跨进程 lease、M3.9/3.10、原生录制、平台/性能和 feature docs 完整再生成门槛保持未关闭。

最终检查：`pnpm build`、`pnpm test`、`pnpm lint`、能力目录再生成和 `node scripts/verify-harness.mjs` 通过。TypeScript：core 845、CLI 96、MCP 158、VS Code 323、Vitest 36（另 3 个 expected fail）、TDD 125、Riverpod 16 项通过；form_demo 的 `flutter test --no-pub test` 两项通过。日志为 `/tmp/fliwright-dart-final-{build,tests,lint}.log`、`/tmp/fliwright-dart-fixture-tests.log`；本轮未重跑无源码变化的 bridge 全包，也未将既有 Dart 全量 analyze 门槛改标通过。上述 `/tmp` 文件是本机验证证据，不能替代 M1.7/M4 的便携 run/export 交付。

### 2026-10-16：runner 结果归一化、attempt 产物与 endpoint 租约切片

本切片继续推进 M1.2 / M1.3 / M1.4 / M1.5 / M1.6 / M1.9，以及 M2.3 / M2.5 / M2.6；不关闭 M1 或 M2。

| 范围 | 本轮交付 | 直接证据 |
| --- | --- | --- |
| Vitest attempt 生命周期 | 使用真实 Vitest 子进程覆盖普通 throw、最后一次断言、setup/teardown、timeout、expected failure、unexpected success、捕获动作错误、skip、repeat、retry 成功及零断言；attempt 在 outer aroundEach teardown 完成后再最终化，避免 `onAfterRetryTask` 过早读取结果 | `packages/fliwright-vitest/tests/runner-fixture-outcomes.test.ts`、`runner-lifecycle-probe.test.ts` |
| 结果与隐私 | 分离 observed attempt outcome 与最终 test outcome，保留 expectedFailure/flaky/retry 历史；失败报告、Timeline、Trace、子进程输出和 failure projection 对敏感输入掩码；普通 Vitest 断言计数以 fixture 起始基线计算 | `AttemptContext.ts`、`runner.ts`、Vitest runner fixture 回归 |
| 多 worker / TDD 身份 | attempt-local `failures.json` 消除共享文件竞争；manifest 按精确 run/test/attempt 身份读取；TDD 两轮重跑得到不同 canonical attempt 路径 | CLI run、TDD `PersistentTestExecutor.test.ts`、Vitest integration 回归 |
| endpoint 执行租约 | `EndpointLeaseManager` 增加跨进程文件系统租约、心跳、死进程原子隔离回收、共享 root 配置；HTTP/HTTPS 与 WS/WSS 别名归一化；AsyncLocalStorage 支持跨 manager 嵌套重入；不同 endpoint 继续并行 | `packages/fliwright-core/src/EndpointLease.ts`、`tests/EndpointLease.test.ts`（5 项，含真实 Node 子进程） |
| 证据与 Trace 投影 | EvidenceCapture 独立超时、总预算和原错误保留；Trace 由 Timeline/result 投影，捕获动作失败可与最终 passed 并存；Timeline schema v2 及 skipped/interrupted 状态落盘 | core Evidence/Trace/Timeline 回归与 Vitest/CLI/MCP 集成测试 |

验证命令：`pnpm build`、`pnpm test`、`pnpm lint`；本轮运行日志为 `/tmp/fliwright-final-{build,tests,lint}.log`。仍需在命令完成后读取退出状态并运行 `node scripts/verify-harness.mjs`；feature docs 需按 `document-features` skill 从当前源代码完整再生成。

仍未关闭：M1.5 与真实 fixture 动作/截图的全链路接线、suite/collection/worker crash 与取消恢复、canonical export 的缺失/损坏矩阵、M2 默认 start/end 截图和完整 action 边界、M2.8 manifest 驱动 VS Code 精确查看、M3.9–M3.10 scenario/IDE 流程、M3.11e Dart 验证结果接入，以及 M4 原生录制、移动平台、性能和发布验收。

### 2026-10-16：TDD 持久 rerun 隔离修复与全量验证

针对全量测试暴露的持久 watcher 偶发复用旧 attempt 路径问题，runner 在 TDD 模式的新任务周期刷新 run identity；`PersistentTestExecutor` 为每次 rerun 切换到独立的 `runs/rerun-N` 根目录，避免旧 watcher 结果与当前 attempt 混读；focused rerun 在模块缓存短暂清空时按项目直接创建精确 specification，减少 `No test files found` 竞态。

直接证据：`packages/fliwright-tdd/tests/executor/PersistentTestExecutor.test.ts` 连续 5 次通过，包含两次实际失败 fixture rerun 且 timeline 路径不同；`packages/fliwright-tdd/src/executor/FocusedRerunRecipe.ts` 的精确 specification fallback；`packages/fliwright-vitest/src/runner.ts` 的 TDD 周期身份刷新。

最终确定性验证：`pnpm build`、`pnpm test`、`pnpm lint` 全部通过；结果为 core 855、Vitest 39（另 3 个 expected fail）、TDD 125、CLI 97、MCP 158、VS Code 323、Riverpod 16；随后 `node scripts/generate-harness-capabilities.mjs` 与 `node scripts/verify-harness.mjs` 通过。core 测试中的 manual checkpoint 仍按设计等待人工输入，未将其误报为设备验收。

剩余未完成项保持原表：跨 fixture 动作/截图租约接线、worker crash/取消恢复、canonical export 故障矩阵、完整默认证据策略、VS Code 精确 attempt 查看、M3.9–M3.12 场景/IDE/Dart 结果闭环，以及 M4 原生录制、移动平台和性能门槛；`docs/features/` 仍需使用 document-features skill 完整再生成。

补充修复：`ResultReporter` 忽略持久 watcher 在规格刷新期间产生的空模块中间结果，避免用 stale report 结束当前 rerun；该场景曾导致 `No test files found` 异步错误和旧 timeline 路径复用。最终全量验证（`/tmp/fliwright-final-{build,tests,lint}-4.log`）再次通过，Harness 能力目录生成与校验也通过。

M1.5 补充：`normalizeEndpoint` 现将无路径 HTTP/WS VM URI 统一到 `/ws`，并覆盖 HTTP/HTTPS 与 WS/WSS 别名；EndpointLease 定向回归现为 6 项通过。该租约 API 尚未接入 Driver/fixture 的整段动作与证据生命周期，因此 M1.5 仍保持部分完成。

### 2026-10-16：CLI 可移动导出包补全切片

本切片推进 M1.7，不关闭整项任务。

- `artifacts export` 现在按 manifest 精确定位 attempt，并递归复制整个 attempt 目录，因此会保留 `timeline.json`、`trace/trace.json`、`failures.json`、截图及其他二进制证据；不再只复制 `result.json`。
- 校验 `resultPath`、`failureContextPath` 的路径逃逸、缺失和不可解析 JSON；默认拒绝不完整，`allowPartial` 返回缺失列表并复制可用文件。
- 导出先写临时目录，完成后原子 rename；失败会清理临时目录。

回归证据：`packages/fliwright-cli/tests/artifacts-manifest.test.ts` 3 项通过，新增完整 attempt 目录移动验证；CLI build/lint/test 通过（98 项）。仍需补齐 report 内部引用的完整校验、导出包移走后的真实 Viewer/IDE 打开验证，以及 M1.8 取消/中断故障矩阵。

### 2026-10-16：VS Code canonical attempt 精确查看切片

本切片推进 M2.8，不关闭整项任务。

- `RunViewerService.listRuns()` 读取 canonical `run.json` 后按 manifest 的每个 test/attempt 生成摘要，并从该 attempt 的 `resultPath` 精确定位 `timeline.json`。
- `loadRun()` 接受 `testId`/`attemptId` 选择；manifest 多 attempt 时不再猜测同级目录或扫描 `${runId}-*` 目录。
- `ViewerPanel` 在选择摘要和打开最新记录时传递精确选择身份。
- 新增 canonical layout 回归：两个 attempt 使用不同 timeline，存在诱导性的同级目录时仍只读取指定 attempt。

证据：`packages/fliwright-vscode/tests/RunViewerService.test.ts` 324 项全包通过；仓库 build/lint 通过。仍需完成导出包 URI、Extension Host 实测及 CLI doctor 配置诊断闭环。

### 2026-10-16：租约接入 RunSession 与 Vitest fixture 切片

继续推进 M1.5 / M2.1 / M2.2：`RunSession.configureEndpointLease()` 将逻辑 action 连同其 start/finish/failure evidence 放进同一 endpoint lease；Vitest fixture 为有 VM endpoint 的 session 配置进程共享 `EndpointLeaseManager`，跨 worker 仍通过文件租约协调。新增回归在证据采集尚未完成时启动第二 session，确认第二 action 不会提前进入；Vitest runner fixture 集成也通过。

证据：`packages/fliwright-core/src/RunSession.ts`、`packages/fliwright-vitest/src/index.ts`、`packages/fliwright-core/tests/RunSession.test.ts`（4 项）、Vitest runner integration 定向测试（4 项）。仍需真实 Flutter VM service 下验证同 App 多 worker 的动作/截图串行性，以及取消、强杀和 lease owner 丢失后的恢复矩阵。

### 2026-10-16：standard/full 生命周期截图与租约覆盖切片

继续推进 M2.2：Vitest page fixture 在 recording mode 为 `standard` 或 `full` 时记录 `Test start screenshot` 和 `Test finish screenshot` 节点；`testFinalScreenshots: false` 可关闭结束截图；`off` 不产生自动生命周期证据。`RunSession.checkpoint()` 也纳入 endpoint lease，因此测试起止证据和 action 内证据共享同一 App 租约。

回归证据：`packages/fliwright-vitest/tests/integration.test.ts` 新增实际 fixture 断言，验证两个生命周期节点及 screenshot artifact；该文件 26 项通过、3 项 expected fail。核心 RunSession 的跨 session action/evidence 串行测试仍通过。

M2.2/M1.5 定向验证补充：core 857 项、Vitest 41 项（另 3 项 expected fail）和 VS Code 324 项均通过。core 测试中的 manual checkpoint 仍按测试设计等待人工输入，不作为自动化失败证据。

本轮最终验证：`pnpm build`、`pnpm test`、`pnpm lint`、`node scripts/generate-harness-capabilities.mjs`、`node scripts/verify-harness.mjs` 和 `git diff --check` 均通过。最新包计数：core 857、Vitest 41（另 3 项 expected fail）、TDD 125、CLI 98、MCP 158、VS Code 324、Riverpod 16。

补充回归：`testFinalScreenshots: false` 只保留开始截图，不写结束截图；Vitest integration 定向结果为 28 项通过、3 项 expected fail。

### 2026-10-16：M1.8 中断 attempt 恢复切片

本切片补齐了中断恢复的确定性文件边界，仍不关闭 M1.8 或 M1.9 的完整故障矩阵：

| 范围 | 交付与行为 | 直接证据 |
| --- | --- | --- |
| Vitest runner | attempt 建立时在配置的 runsRoot 写入 `running` 标记；fixture 配置最终 runsRoot 后再次写入；worker 被 `SIGKILL` 时父进程仍能发现未完成 attempt | `packages/fliwright-vitest/src/AttemptContext.ts`、`runner-integration.test.ts`（worker crash marker） |
| CLI manifest / export | 写 manifest 前修复缺少、损坏或仍为 `running` 的 result；保留已 flush 的 operations/evidence，补 `interrupted` 状态与 `partial` 证据状态，临时文件 rename 原子写回；`runCommand` 支持 AbortSignal，取消后向子进程发送 SIGINT，5 秒后强杀兜底并清理监听；export 的 allow-partial 路径遍历拒绝 manifest 路径逃逸 | `packages/fliwright-cli/src/commands/run.ts`、`artifacts.ts`、`run.test.ts`、`artifacts-manifest.test.ts`（missing/running/corrupt result、真实 worker-killed attempt、AbortSignal 取消、suite failure 与 path escape） |
| 运行结果 | manifest 中发现 interrupted attempt 时，CLI report 的 status 同步为 `interrupted`，避免 Vitest 空报告被误判为 passed | CLI `run.test.ts` |

验证：`pnpm --filter @fliwright/vitest build`、runner integration 定向回归、`pnpm --filter @fliwright/cli build`、CLI `run.test.ts`（102 项）、CLI lint 均通过。

仍需：真实 SIGINT/AbortSignal 有界 flush 与 listener 清理、多 worker/collection/suite crash 的完整父进程归因、移动 export 故障矩阵，以及 M1.9 的全量子进程回归。当前 worker crash 证据证明 marker→repair→manifest 链路，不替代真实 Flutter VM 断连和设备验收。

补充验证：`runCommand` 的 `AbortSignal` 取消、suite setup failure、损坏 JSON 和 export path escape 回归已加入 CLI；最终 `pnpm test` 通过（core 857、Vitest 44 + 3 expected fail、TDD 125、CLI 102；随后 CLI 定向回归 103、MCP 158、VS Code 324、Riverpod 16），`pnpm lint`、`node scripts/generate-harness-capabilities.mjs`、`node scripts/verify-harness.mjs` 和 `git diff --check` 均通过。`docs/features/` 已按 `document-features` skill 从当前 source 完整重建，300+ Markdown、10 个包目录、pipeline/index，857 个相对链接无缺失。

### 2026-10-17：M3.9 scenario 指纹接入切片

继续推进 M3.9，不关闭 scenario 的真实 app 回放验收：

- core 新增 `fingerprintScenario()`，对 resolved scenario 的内容做稳定排序后生成 SHA-256 身份。
- CLI `record --mode test --scenario <name>` 从 `fliwright.config.ts` 解析 scenario，将 fingerprint 写入 readiness；scenario 不存在时保持 draft 并报告 blocker。
- MCP `fliwright_record` 增加 `cwd`，使用同一配置解析和 fingerprint 逻辑，和 CLI 共享 readiness 字段。
- 新增 core、CLI、MCP 回归，确认继承解析后的 fingerprint 稳定且两入口一致。

证据：`packages/fliwright-core/src/Scenario.ts`、`packages/fliwright-cli/src/commands/record.ts`、`packages/fliwright-mcp/src/tools/record.ts` 及对应 `Scenario.test.ts`/`record.test.ts`。core 858、CLI 105、MCP 159 定向回归通过；CLI replay verifier 现在同时收到 scenario fingerprint。

仍需：将 fingerprint 与真实 scenario apply、生成内容指纹和 verifiedRunId 绑定，在 replay 成功/失败后持久化和失效；VS Code 保存测试与 Dart 专属验证仍未闭环。

### 2026-10-17：真实 replay、IDE 审阅、便携导出与中断恢复切片

本记录汇总最新工作区中的实现与已运行证据；M1/M3 和发布验收仍未整体关闭。

| 任务范围 | 当前交付 | 直接证据与边界 |
| --- | --- | --- |
| M3.9 | `@fliwright/cli/run` 暴露 `verifyRecordingReplay`；原样保存候选并真正运行一次，检查精确 run/test/attempt、首次通过、实际断言和实际应用的 scenario 指纹；配置/源码改变失效，失败保留 source/capture/verification 与失败 run。CLI/MCP 共用验证能力，Dart 不继承 TS verified | CLI `record-replay.test.ts` 6 项真实 Vitest/fixture 集成，包含正例、业务反例、零断言、跳过、scenario 变化及直接 preset 运行；driver 在 VM 边界受控，不作为真实 Flutter 设备证据 |
| M3.10 | IDE 保存结构化录制与 generation/readiness/checkpoint；确认检查点、显式回放、draft 保存守门、scenario 改变与回放期间编辑失效；CodeLens 等待指定运行成功后才启动录制 | VS Code `RecordingReadiness.test.ts`、`recordAfterTest.test.ts`、CodeLens/Panel 回归。检查点目前从 JSON 导入后确认；snapshot 候选编辑、Extension Host 和加载/插入时的完整失效链仍待验收 |
| M1.7 / M2.8 | 校验 result/timeline/trace/failures/report 的嵌套证据引用、缺失投影与损坏 JSON；路径按实际 symlink 目标检查；内部 symlink 实体复制，外部引用拒绝；原子导出并转换相对路径；partial 包写 `export.json` 和 partial manifest；只接受 canonical manifest，取消旧目录整包回退 | CLI `artifacts-manifest.test.ts` 25 项；`ExportedRunViewer.test.ts` 删除原目录后由实际 ViewerService 读取迁移的 attempt/Trace/截图。仍不是 Extension Host 验收 |
| M1.7 | canonical report 自身引用不再指向外部 `--output` 副本；副本保留 artifact base；汇总 failure appState 时先从 attempt 基址转换，导出后与 timeline firstFailure 引用一致 | CLI `run.test.ts` 外部 output 删除后仍可 export、失败 appState 截图迁移回归 |
| M1.8 | RunSession 在动作/证据边界交回调用者前持久化 running result/timeline；并发分支串行写入；强杀后保留已完成动作与截图，未完成 operation/node 标 interrupted，Trace 不再投影成 pass；持久化错误保留动作返回和原异常并标 partial | core RunSession/RunTraceProjection 回归；CLI 真实 fixture worker SIGKILL（一次动作成功、下一次动作中断）；明确等待主体启动的 AbortSignal/SIGINT、独立 CLI 父进程 OS SIGINT 验证有界结束、listener 恢复和 worker 退出 |
| M1.3 / M1.9 | CLI 通过 Vitest 公共 reporter API 收集 collection、suite 和 unhandled errors；保留 process 启动错误及退出码，测试通过但未处理异常时整次 run 失败；canonical report、pretty、JUnit 展示 run 级错误 | CLI run/reporter 回归使用真实子进程覆盖模块加载失败、嵌套 beforeAll、配置启动失败、passing test + uncaught error；不将空测试列表等同于成功 |

最终检查：`pnpm build`、`pnpm test`、`pnpm lint`、能力目录再生成、`node scripts/verify-harness.mjs` 和 `git diff --check` 均通过。TypeScript：core **865**、Vitest **45**（另 **3** 个 expected fail）、TDD **125**、CLI **142**、MCP **160**、VS Code **336**、Riverpod **16**。日志：`/tmp/fliwright-completion-{build,tests,lint}.log`。feature docs 已从当前 source 全量再生成：**11** 个 package、**398** 份 Markdown、**963** 个有效相对链接，补充 mock 和 scenario/state pipeline。

仍未关闭：完整追加事件日志与损坏尾行恢复、同 App 真实多 worker Flutter 租约、5 秒收尾/VM 断连完整矩阵；共享配置所有字段与优先级、custom runner 组合及 doctor；IDE snapshot 候选和完整编辑失效；Dart 公共验证结果闭环；原生人工录制、exio、20 轮/多窗口、Android/iOS、Extension Host 与性能门槛。未用本轮受控 driver 或静态检查代替这些验收。

### 2026-10-17：M1.6 / M1.8 追加事件日志与快照损坏恢复

本切片把事件日志接入真实 fixture 生命周期及 CLI 父进程恢复，不关闭 M1 整体。

| 范围 | 交付 | 证据 |
| --- | --- | --- |
| core 进度日志 | 新增公共 `RunProgressJournal` / `recoverRunProgress`；日志有版本、精确身份、单调 sequence，只追加变化的 operation/node 和新增 evidence 引用；并发写入串行，写失败不推进缓存或序号；二进制仍先写入 artifact store | `RunProgressJournal.test.ts` 4 项，覆盖变化量、并发/写失败重试、身份拒绝、乱序/缺口、损坏行/尾行 |
| fixture 接线 | 动作/证据边界先 append 日志，再更新 result/timeline 快照；最终 runner 判定另写 finalized 标记，区分 observed attempt 与 retry/expected-failure 后的 testOutcome；journal 写失败保留业务异常和 runner 状态并标 partial | `AttemptContext.ts`、`runner.ts`；`runner-fixture-outcomes.test.ts` 同时验证敏感输入不写入 journal |
| CLI 恢复 | result/Timeline 损坏时重放已 flush 日志，恢复动作和截图；缺口、损坏/不完整行明确列为 evidenceIssues；无 finalized 的残留 attempt 标 interrupted；已落盘 finalized result 不被故障日志改写为测试失败 | `run.test.ts`：真实 worker 在第二 action 中 SIGKILL，先损坏两种快照并截断日志尾行；验证第一动作/截图保留、第二动作 interrupted、Trace 同步；另覆盖 expected-failure journal commit 和日志写入失败两种 runner 结果 |
| 导出完整性 | result 记录 `eventsPath`；export 检查引用 journal 的身份、sequence、格式和 finalized 状态；缺失、损坏或目录伪装为文件都要求 allow-partial，保留原 run | `artifacts-manifest.test.ts` 新增 4 项 journal 故障回归，以及 CLI 写入失败后的 partial export |
| 产物身份 | 用保留区分度的编码代替字符替换；`-123`/`123`、`suite/test`/`suite-test` 和点路径不再碰撞或逸出，空 identity 明确拒绝 | `RunArtifactStore.test.ts` |
| Timeline 状态 | `complete('interrupted')` 将未完成节点标 interrupted，保留已完成节点事实 | `timeline/TimelineRecorder.test.ts` 先失败后通过 |

本轮最终 `pnpm build`、`pnpm test`、`pnpm lint`、能力目录生成、`node scripts/verify-harness.mjs`、`git diff --check` 全部通过。日志：`/tmp/fliwright-journal-{build,tests,lint}.log`。feature docs 按源码完整再生成，并更新 run artifact pipeline。

边界：当前进度 journal 在 RunSession 动作/证据边界及 runner 最终化时采集 Timeline 变化；尚需审计独立 flow/mock/AI 节点在两次此类边界之间的逐节点即时 flush，以及高动作数的写入/序列化成本。真实 VM 失联、同 App 多 worker Flutter、设备/Extension Host、Dart 公共验证和性能门槛仍未关闭，不能以这次受控 VM 边界的子进程回归替代。

### 2026-10-17：M1.6 / M1.8 独立节点即时日志

- `TimelineRecorder` 在节点开始、通过、失败、跳过、证据附加和 complete 时按顺序排队持久化；每次变更拥有独立深拷贝，异步 sink 错误经 evidence error 通道报告，不替换业务返回或异常。公共 `flushProgress()` 提供生命周期落盘屏障。
- flow、mock 的异步操作、断言、主动/被动 AI、repair 和 RunSession action 在执行主体前及返回/抛错前等待节点落盘；scenario 与测试起止截图也接入屏障。同步 `startNode` / `listRules` 仍保持同步接口，变更会排队，直接调用者需要在强制退出前显式等待 `flushProgress()`。
- Vitest AttemptContext 将独立节点变化写入同一追加 journal，切换 store/recorder 和最终化前排空队列；节点 metadata/error 经 session 脱敏边界处理。JSON 快照仍在原有动作/证据及终止边界写入。
- 红绿证据：`TimelinePersistence.test.ts` 3 项先失败再通过，验证主体开始前的 running、返回前的 passed、嵌套数据隔离、sink 故障后继续及业务错误保留。CLI `run.test.ts` 新增 3 项真实 Vitest worker SIGKILL 回归：分别在独立 flow/mock/AI 的第二次调用主体中损坏 result/timeline 后强杀，由 journal 恢复已通过节点和当前 interrupted 节点。

最终 `pnpm build`、`pnpm test`、`pnpm lint`、能力目录生成、`node scripts/verify-harness.mjs` 均通过；日志 `/tmp/fliwright-node-progress-{build,tests,lint}.log`。feature docs 使用 document-features 从源码全量再生成（11 个包、399 份 Markdown、966 个有效相对链接）。

仍不关闭 M1/M4：同步调用后无 flush 的立即强杀无法承诺落盘；全量快照序列化与高动作数成本仍待性能验收。5 秒收尾/VM 失联完整矩阵、真实 Flutter 同 App 多 worker、配置贯通、IDE/Dart 验证及设备发布门槛继续保留。

### 2026-10-17：M2.4–M2.6 共享配置与直接 Vitest 贯通

- core `RecordingConfig` 补齐 typed scenarios / scenarioMode、声明校验和公共 `readFliwrightEnvironment()`；完整 JSON 配置可跨进程传递，scalar 环境覆盖同一 envelope；参数 > 环境 > 项目 > 默认值，非法模式/预算/scenario 在边界拒绝。core 仍不加载 TS 文件。
- CLI 的 define/load 配置复用共享默认值与校验，测试默认目录改为 `.fliwright/tests`；`paths.tests` 派生 discovery，已有显式 testDir 输入统一映射到该字段。run 按优先级解析 recording/runsRoot/paths/scenarios，再把全部 recording 字段传给 worker；screenshot 参数缺省时使用项目配置。
- preset 通过 Vitest `test.env` 传递完整配置及 runner 所需 scalar 字段，不再写父进程 process.env；默认 test/script glob 从共享 paths 派生。fixture 每次 use 时读取配置，避免持久 worker 缓存上一次 runsRoot。调用者显式 fixture 配置继续高于环境。
- init 将测试和脚本放入共享目录，生成的 Vitest 配置显式导入项目配置并保留完整 preset（包括 runner）；tsconfig 覆盖 tests/scripts/config。
- 直接证据：core `RecordingConfig.test.ts` 10 项；preset `runner-adapter.test.ts` 5 项；CLI config/init/run 回归覆盖环境覆盖项目和本次参数覆盖环境、真实子进程的全部 recording 字段、共享发现目录；Vitest `runner-integration.test.ts` 直接子进程发现自定义 test/script 目录且无断言测试遵守 requireAssertions=false。

全量验证暴露并修复 TDD 持久运行问题：boot 改为启动时 standalone，禁止初始意外执行；`focusAndRerun` 返回 Vitest 公共 API 的精确 run，executor 不再等待可能来自 watcher 的下一条 reporter 消息。macOS 延迟送达 boot 前 config 写事件会触发 Vite 重启并清理活跃临时模块目录，使用 polling 保留监听能力并避免该竞态。现有失败证据双 rerun 与新增 boot 不执行回归组成 6 项测试，连续 8 轮通过；无临时 DEBUG 探针残留。

仍未关闭 M2：custom runner 的组合契约、CLI/MCP record 保存路径与环境配置贯通、VS Code 自定义路径发现与 doctor 能力诊断仍需完成；本切片不代表完整入口一致性或真实设备验收。

最终验证：`pnpm build`、`pnpm test`、`pnpm lint`、能力目录生成、`node scripts/verify-harness.mjs`、`git diff --check` 均通过。core 879、Vitest 47（另 3 expected fail）、TDD 126、CLI 157、MCP 160、VS Code 336、Riverpod 16。日志 `/tmp/fliwright-shared-config-build-final.log`、`/tmp/fliwright-shared-config-tests-final-2.log`、`/tmp/fliwright-shared-config-lint-final.log`；feature docs 已按源码再生成（11 包、399 Markdown、966 相对链接）。

### 2026-10-17：M2.7–M2.9 入口一致性与普通动作回归

- CLI `record` / replay 与 MCP record 使用 `resolveProjectConfig` 解析项目、环境和本次参数；录制输出、Flow、runsRoot、scenario 指纹使用共享字段。CLI 定向回归 65 项，MCP 录制回归包含环境 scenario 与项目 VM endpoint。
- VS Code 的测试/脚本发现、录制保存、Flow 创建/保存、录制代码生成和脚本提示使用共享 `paths`；相对和绝对路径均正确解析，显式 VS Code glob 通过 `inspect` 保留。`WorkspacePaths.test.ts`、`RecordingReadiness.test.ts` 和 VS Code 全包 341 项通过。
- CLI doctor 现在报告有效 recording 配置、来源、scenario、共享目录和实际解析的 Vitest preset；运行时拆分检查 target capture、focused input、screenshot、snapshot、mock、Riverpod 能力，并在连接失败时释放 driver。`doctor-recording.test.ts` 4 项通过。
- Vitest 暴露 `createFliwrightRunner(BaseRunner)`，为 custom runner 提供显式组合契约；真实子进程验证自定义 hooks、断言失败和 inline snapshot 保留。普通 locator 脚本连续点击两次并断言时，Timeline 有两个 `tap` action 和一个 assertion，无 `flow.step` 包装。

本轮验证：`pnpm build`、`pnpm test`、`pnpm lint`、`node scripts/verify-harness.mjs`、`git diff --check` 均通过；feature docs 重新生成 11 个包、400 份 Markdown、968 条有效链接。M2.4–M2.9 的代码级入口和受控子进程证据已补齐；仍未替代 M4 的 Extension Host、真实 Flutter/设备、Dart 编译运行、20 轮多窗口和性能门槛验收。

### 2026-10-17：M3.11a–d Dart 输出能力与真实 Flutter 验证

- `DartCodeGenerator.generateResult` 要求合法的 `package:` app entrypoint，生成 `IntegrationTestWidgetsFlutterBinding`、`integration_test` import、`app.main()` 启动等待；缺入口、未知/复合不支持 query、未确认 checkpoint、无效长按时长或拖拽参数均返回 issue 并只生成启动前 `StateError` 草稿，不回退到 `find.byType(Widget)` 或错误 semantics label。
- Dart 输出保留敏感输入环境参数、空值和动作顺序；确认的 `toHaveText`、`toContainText`、`toBeVisible` 检查点在对应 action 后执行。core 定向回归 66 项通过。
- 真实验证器 `scripts/verify-dart-recording.mjs` 在 Flutter 3.41.9 / macOS fixture 上对原样生成文件完成 `pub get --enforce-lockfile`、`flutter analyze`、缺少输入失败、传入 `FLIWRIGHT_INPUT_7` 成功回放和 `FLIWRIGHT_FIXTURE_FAIL=true` 业务反例失败；结果 `status=passed`，内容指纹为 `da40f60af01ff159bed2ca695627f692e6e9e8732bd6c0a39f6574e4c0e33100`，证据目录 `/tmp/fliwright-dart-recording-acceptance-final/`。

该证据关闭 M3.11a–d 在 macOS 受控 fixture 的代码与运行条件；M3.11e 的 CLI/MCP/VS Code Dart 专属 readiness 消费、原生人工录制 M3.12、Android/iOS、Extension Host、exio、20 轮多窗口及性能门槛仍保持未验收。

### 2026-10-17：M3.11e Dart 验证证据消费闭环

- core readiness 新增 `DartVerificationEvidence` 消费接口：证据必须是 passed，且匹配生成内容指纹和声明的 `package:` app entrypoint；失败或不匹配保持 draft、清除 verifiedRunId，并保留诊断。Dart readiness 独立于 TS replay，不继承 TS verifiedRunId。
- CLI `record` 和 MCP `fliwright_record` 接收独立 Dart compile/run evidence；无证据仍保留生成草稿，匹配证据才晋级 verified，错误指纹或失败状态降级并返回 blockers/issues。
- VS Code RecorderService 新增 Dart evidence 应用和持久化入口；停止录制时沿用 Dart lang/entrypoint/reset 配置，避免把 TS home reset hook 注入 Dart readiness。重新加载 recording 后保留 Dart run identity。
- 回归：core readiness 882 项全包通过；CLI record 20 项、MCP record 12 项、VS Code readiness 7 项通过；三包 lint/build 通过。

该切片关闭 M3.11e 的代码级入口消费与持久化回归；Dart 证据生产工具与真实设备矩阵、原生人工录制 M3.12、Android/iOS、Extension Host、exio、20 轮多窗口及性能门槛仍保持未验收。

### 2026-10-17：M4.6 性能基准入口与缓存观测切片

- 新增 `scripts/benchmark-recording.mjs`，在 core build 后可用固定参数运行 1,000 个动作、三次重复，分别测量 `off`、`standard`、`full` 的操作耗时、证据调用次数、P95/P99，并报告录制协议聚合的原始事件/操作计数。
- 新增 `docs/release/recording-performance.md`，明确命令、输出字段和真实 Flutter VM 验收边界；兼容性声明同步标明 synthetic benchmark 不能替代设备证据。
- 当前本机报告：`/tmp/fliwright-recording-benchmark.json`，standard 相对 off 的 synthetic P95 附加开销为 0.006ms，1,000 动作聚合为 2,000 原始事件和 1,000 操作，1,000 个帧引用同一个最新截图 payload，状态为 `synthetic-only`。

本切片提供可重复的性能测量入口，但不关闭 M4.6：仍需固定机器上的 Flutter baseline/standard/full、standard 截图 P95、十分钟录制稳定性及 1,000 动作二进制/原始事件固定预算证据。

### 2026-10-17：M4.1 Extension Host 启动与扩展发现烟测

- `packages/fliwright-vscode/scripts/run-integration.mjs` 显式下载并解析 VS Code 可执行文件；兼容 macOS ARM64 新包提供 `Contents/MacOS/Code` 而 `@vscode/test-electron@2.5.2` 仍推导 `Electron` 的路径差异。
- VS Code bundle 的 ESM banner 将 `createRequire` 改为内部别名，避免与打包的 Vitest runner 同名导入冲突。
- 真实 VS Code 1.142.0 Extension Host 成功启动，加载开发扩展，集成套件确认扩展可发现并注册连接、运行、失败、录制、状态等命令，进程退出码为 0。

证据：`pnpm --filter fliwright-vscode build`、`pnpm --filter fliwright-vscode test:integration`、VS Code 全包 344 项测试、VS Code lint 均通过；随后 `node scripts/generate-harness-capabilities.mjs` 与 `node scripts/verify-harness.mjs` 通过。

该烟测只关闭 M4.1 的 Extension Host 启动和基础发现部分；初始化配置发现、录制审阅/确认、回放验证、保存测试、失败查看和导出包的完整宿主流程，以及真实 Flutter、exio、移动设备、多窗口和性能验收仍未关闭。

### 2026-10-17：M4.5 自定义 fixture cleanup 故障回归

- 新增真实 Vitest 子进程回归：项目 fixture 在 `use()` 返回后抛出 cleanup 错误，而测试 body 已成功执行。
- Fliwright runner 将 cleanup 错误归入同一 attempt 的 runnerErrors，canonical result、Timeline 和 Trace 均最终为 `failed`，没有被 body 的 passed 状态覆盖。

证据：`packages/fliwright-vitest/tests/runner-fixture-outcomes.test.ts`，定向命令 `pnpm --filter @fliwright/vitest exec vitest run tests/runner-fixture-outcomes.test.ts`，4 项通过。

该切片补齐 M4.5 的 fixture cleanup 分支；VM 真实断连、同 App 多 worker Flutter 租约、完整 SIGINT/强杀资源矩阵和设备验收仍未关闭。

同一回归文件新增 VM transport 断连场景：动作期间 driver 抛出 `WebSocket connection closed`，后续失败证据也不可用；真实子进程结果保留原始 transport 错误，attempt/test 为 failed，evidence 为 partial。该文件现有 4 项定向测试全部通过。

### 2026-10-17：M4.5 VM 断连与连接替换边界

- `VMServiceConnector` 在 socket close 时清空连接和 isolate 状态、拒绝所有 pending 请求；断连后新请求立即返回未连接错误。
- 主动 `disconnect()` 也会先拒绝 pending 请求；重连或替换 mock socket 时旧连接请求以明确的 `VM Service connection replaced` 结束。
- 旧 socket 的迟到 close 事件不会影响新连接，避免重连期间跨 endpoint/连接串扰。

证据：`packages/fliwright-core/tests/VMServiceConnector.test.ts` 的 12 项定向回归，覆盖关闭、重连、替换和 stale close；`pnpm --filter @fliwright/core lint` 通过。

该切片补齐 VM transport 的确定性资源边界，但不等同于真实 Flutter VM 进程断开、SIGINT/worker 强杀和设备上的全链路故障验收。

### 2026-10-17：M4.1 Extension Host 回归复验

在最新 VS Code webview/RecorderService 代码和构建产物上重新运行 `pnpm --filter fliwright-vscode test:integration`。真实 VS Code 1.142.0（macOS ARM64）Extension Host 成功启动开发扩展，扩展可发现并注册连接、运行、失败、录制、保存录制和状态命令，宿主退出码为 0。

该结果复验宿主启动和命令发现，不关闭 M4.1 的真实 workspace 初始化配置发现、webview 鼠标/键盘审阅、确认检查点、VM 回放、保存测试、失败查看和导出包打开全流程；这些仍需在可用 Flutter VM 和 Extension Host workspace 中验收。

本轮验证汇总：core 全包 95 个测试文件、887 项通过；Vitest 全包 8 个测试文件、52 项通过及 3 项既有 expected fail；core/Vitest 相关 lint、Harness 校验和 `git diff --check` 通过。core 全包期间打印了手工验证码 checkpoint 提示，但该测试按既有 expected/manual-checkpoint 设计完成，未将人工输入误记为真实 Flutter 验收证据。

补充 M1.5/M4.5 租约证据：`EndpointLease.test.ts` 新增跨进程 stale lock 回收回归，确认 owner 进程消失且 heartbeat 过期后，同 endpoint 能重新获取租约并清理旧锁；该文件 7 项定向测试通过。

另外覆盖损坏/缺失 owner 记录：只有锁目录及 owner 文件都超过 stale 窗口时才回收，避免把刚创建但尚未写完 owner 的活跃锁误判为空闲；租约测试现为 8 项。

### 2026-10-17：M4.5 注入 driver 断连后的资源释放

- `createFliwrightTest({ driverProvider })` 的 `driver` fixture 现在拥有注入 driver 的生命周期：依赖 fixture 完成后始终调用 `dispose()`；测试已有 body/transport 错误时，清理异常不会覆盖原始错误；测试通过但清理失败仍会作为 fixture cleanup failure 进入 runner 结果。
- `page` 与 `aiRuntime` 复用同一 fixture driver，避免各自重新创建连接，确保 VM 断连、截图失败和 teardown 都经过同一资源所有权边界。

直接证据：`runner-fixture-outcomes.test.ts` 的真实 Vitest 子进程 VM disconnect 回归写入并断言 driver dispose marker；4 项定向测试、Vitest build/lint 和全包 52 项测试通过。该证据覆盖注入 fixture 的 Node 资源释放，仍不替代真实 Flutter VM 断连、设备连接和多 worker 同 App 的发布验收。

### 2026-10-17：M1.9 多 worker 同名测试身份回归

- CLI 真实 Vitest 子进程以两个 worker 执行不同文件中的同名测试，一个通过、一个失败；canonical `run.json` 保留两个不同的稳定 `testId`、各自的 attempt/result 引用和正确的混合 run 状态。
- canonical report 同时保留两个同名测试结果及各自通过/失败状态，所有 manifest 引用都能解析到 attempt 产物，证明同名标题不会覆盖多 worker 结果。

直接证据：`packages/fliwright-cli/tests/run.test.ts` 新增多 worker 同名测试回归，定向测试通过。该切片补充 M1.9 的身份/汇总边界；suite/collection/worker crash、取消恢复和 export 故障矩阵已有独立回归但仍需最终组合矩阵收敛。

### 2026-10-17：M3.10 检查点编辑与验证失效链切片

- VS Code 录制画布的检查点审阅器现在允许编辑候选 id、matcher、expected、冻结目标 query（JSON）和动作边界；空 query、非法 JSON 和复杂 SelectorQuery 仍由统一 core readiness 校验决定是否可生成。
- 画布比较本地检查点草稿与宿主 session；存在未应用编辑时显示待处理状态，并禁用回放验证和保存，要求先通过 `reviewRecordingCheckpoints` 重新生成和持久化。
- 加载已保存的 verified recording 后修改检查点，会通过 `RecorderService.reviewAutomation()` 重新生成内容并撤销旧 `verifiedRunId`；编辑后的 query、断言和 readiness 状态会写回 `recording.json`。

直接证据：VS Code `lint` 通过；`RecordingReadiness.test.ts` 与 `RecordingPanel.test.ts` 定向回归 23 项通过，新增“加载后修改已验证检查点并持久化为 generated”测试。该切片覆盖宿主服务和受控 webview 代码，仍不等同于真实 Extension Host 中的完整鼠标/键盘交互验收；M4.1 的初始化发现、宿主审阅、回放、保存、失败查看和导出包全流程仍需继续补齐。

### 2026-10-17：M1.9 运行级错误与便携导出一致性

- `RunManifest` 新增可选 `runnerErrors`，由 CLI 父进程把 collection、suite、unhandled、worker/process 级错误写入 canonical `run.json`；旧的无该字段 manifest 仍可解析。
- 新增真实 CLI/Vitest 子进程组合回归：一个测试文件正常执行、另一个文件在 collection 阶段失败；report、manifest 与移走原 run 目录后的 portable export 均保留相同的运行级错误，且导出不依赖原目录。

直接证据：`packages/fliwright-cli/tests/run.test.ts` 39 项通过；`packages/fliwright-core/tests/RunContracts.test.ts` 5 项通过；core build/lint 和 CLI lint 通过。该切片收紧 M1.9 的 canonical report/export 审计，仍需完整组合 suite/collection/worker crash、取消恢复和跨 App Flutter 租约的最终矩阵。

### 2026-10-17：M2.8 Run Viewer 精确测试身份选择

- `RunViewerService.findLatestRunForTest()` 现在优先按 canonical `run.json` 中的完整 `testId` 和 `attemptId` 读取；同名但来自不同文件的测试不会再通过标题扫描互相匹配。
- 旧的无 manifest 目录仍保留标题/结果查找，供历史产物读取；canonical 目录不再回退到兄弟目录猜测。

直接证据：`packages/fliwright-vscode/tests/RunViewerService.test.ts` 13 项通过，新增同名测试身份回归；VS Code lint 通过。该切片补齐 M2.8 的 manifest 精确选择边界，Extension Host 中的完整初始化、审阅、回放和导出流程仍属于 M4.1 未验收项。

### 2026-10-17：M1.5 Vitest 多 worker 同 App 租约接线

- 新增真实 Vitest 子进程回归：两个 worker 使用同一 VM endpoint，各自执行 action 并采集 standard 截图；请求日志验证 action 与截图区间在跨 worker 间严格串行，不同 endpoint 的并行能力仍由 core 租约测试覆盖。
- 该证据覆盖 fixture 创建的 `RunSession.configureEndpointLease()`、跨进程文件锁和 action/evidence 共用租约，避免仅凭 `EndpointLeaseManager` 单元测试宣称同 App 不串扰。

直接证据：`packages/fliwright-vitest/tests/runner-fixture-outcomes.test.ts` 5 项通过；Vitest lint/build 已通过。真实 Flutter VM/同一 App 的设备动作仍需在可用 Flutter fixture 上复验，不能把受控 driver 的请求串行化等同于原生 App 验收。

### 2026-10-17：M1.8/M1.9 中断与 worker 强杀的父进程错误归因

- CLI 对 AbortSignal/SIGINT 追加明确的 `process` runner error；worker 非零退出或信号即使 Vitest 同时返回 `unhandled` worker error，也会补充父进程级错误，不丢失原始错误。
- 真实子进程回归验证取消、worker SIGKILL、已 flush attempt 修复后，report、manifest 和 interrupted attempt 同时保留 `unhandled` 与 `process` 诊断。

直接证据：`packages/fliwright-cli/tests/run.test.ts` 40 项通过，覆盖 OS SIGINT、AbortSignal、worker kill、collection/suite failure 和 portable export。该切片补齐父进程错误归因，仍需完整跨平台 VM 断连和设备资源矩阵。

### 2026-10-17：M1.4 收尾预算、取消写入与 partial export 回归

- M1.4a：共享 `recording.testFinalizationBudgetMs` 默认 5000，独立于默认 3000 的 `failureCaptureBudgetMs`；schema 拒绝非正数、非整数和非法类型，项目/环境/显式配置保持既有优先级。直接 Vitest preset 和真实 CLI 子进程验证字段贯通。
- M1.4b：Vitest 的 `FinalizationBudget` 按单调时钟累计 Fliwright 自身收尾阶段耗时。失败证据、投影、最终截图、注入 driver cleanup、被动诊断、进度 flush、终态写入和生命周期回调共用剩余预算，并预留终态持久化时间。项目自定义 hook 的等待继续由 Vitest `hookTimeout` 管理，预算在 Fliwright 阶段之间暂停，避免项目 hook 用尽报告写入时间。
- 失败和超时保留原始 runner 错误，脱敏后将阶段问题写入 `evidenceIssues`；启用证据时标 partial。body 已失败时 cleanup 错误不替换它；body 成功但 cleanup 超时仍是 teardown failure。较早 attempt 的最终 task/flaky 投影使用最后一次 attempt 的剩余预算，不把后一次主体执行时间误算进前一次收尾。
- `EvidenceCapture.capture()` 接受取消信号，保留已采集通道，将尚未完成的通道标 timeout 并移除计时器和监听；fixture 用 AsyncLocalStorage 传递当前收尾信号。`PassiveAgent` 在取消后停止发布诊断节点，且在 flush 后复查取消，避免迟到诊断改写终态。
- `RunArtifactStore.writeAttemptResult/appendEvent`、`TimelineArtifactStore.writeTimeline`、`RunProgressJournal.append` 接受取消选项；取消排队的 running 写入不会再覆盖终态。原子快照使用独立临时文件并清理遗留临时文件，收尾后停止进度回调写入。
- 真实 Vitest 子进程覆盖 9 个 attempt：body 失败加 cleanup 挂起、body 成功加 cleanup 挂起、诊断挂起、证据预算大于收尾预算、flush 挂起、投影写入错误、失败后较长主体重试的两个 attempt，以及具有独立 hookTimeout 的项目 hook。CLI 回归确认清理超时后 report/manifest/result/Timeline/Trace 保持失败，普通 export 拒绝 partial，显式 partial export 在原 run 被移除后仍能读取失败截图。

验证：`pnpm build`、`pnpm test`、`pnpm lint`、能力目录再生成、`node scripts/verify-harness.mjs` 与 `git diff --check` 通过。TypeScript：core 902、Vitest 57（另 3 个 expected fail）、CLI 168、MCP 162、VS Code 347、TDD 126、Riverpod 16 项通过。按 `/document-features` 从当前源码重建了 400 个 Markdown 文件，968 个内部链接通过检查。

日志：`/tmp/fliwright-finalization-{build,tests,lint,docs}.log`。本轮没有 Dart 或真实 App/设备验收；受控 driver 不能证明真实 VM 在插件 dispose 挂起时已断开。M1.4b/c 保留真实 driver 清理、存储完全不可用时的父进程交接及完整故障矩阵为待完成项；M3.12/M4 的原生输入、设备、exio 和性能门槛没有关闭。

### 2026-10-17：M1.4b/c 传输取消与 worker 存储故障交接

- `FliwrightDriver.dispose({ signal })` 在插件清理挂起时响应取消，继续释放自有 mock HTTP server 和 VM connector；取消时强制终止 WebSocket，拒绝待处理请求。HTTP server 对尚未提交完请求体的连接执行 `closeAllConnections()`。取消监听及时解除，迟到的插件 promise 仍被观察。
- core 回归使用实际 `FliwrightDriver.connect()` 与本地 WebSocketServer 完成 JSON-RPC 握手，验证插件挂起后 peer 关闭、pending request 拒绝、connector 不再接受请求；另用实际 TCP socket 的未完成 HTTP 请求验证 mock server 可退出。这些是 Node 传输证据，不能替代 Flutter VM/设备验收，也不能强制清理任意插件自己拥有的资源。
- worker 收尾持久化失败时，通过 Vitest task metadata/reporter 传回脱敏的最终 result 和 Timeline；CLI 父进程校验 run/attempt 身份后补写 result/Timeline/Trace，保留 runner 最终结果并标 partial。正常执行仍只传紧凑身份信息。
- CLI 真实子进程分别验证主体成功、主体失败加所有 worker 终态写入挂起，report/manifest/result/Timeline/Trace 保留最终 passed/failed；敏感输入和原始错误经过脱敏。该恢复要求父进程仍能写入，不宣称父进程磁盘故障时也能持久化。

验证：`pnpm build`、`pnpm test`、`pnpm lint` 通过；core 905、Vitest 57（另 3 个 expected fail）、CLI 170、MCP 162、VS Code 347、TDD 126、Riverpod 16。敏感值增强后另重跑两个 CLI 恢复用例通过。按 `/document-features` 再生成 400 个文档，968 个内部链接有效。日志：`/tmp/fliwright-disposal-handoff-{build,tests,lint,docs}.log`。M1.4 的确定性边界证据已补强，M1.9/M4.5 组合故障和 M3.12/M4 实机门槛继续开放。

### 2026-10-17：M2.2a 三模式矩阵与 M1.9a/M4.5a 组合故障

- `recording-modes.test.ts` 通过真实 Vitest fixture 子进程执行 3 种模式 × 有/无 `flow.step` 两种写法：两次公开 locator click 和实际可见性断言，检查确切采集次数、内容、operation 归属、分组父子关系及 Trace 引用。standard 保存起止和动作后截图；full 额外保存动作前截图/快照，Trace 优先展示失败/动作后截图。
- `RunSession` 默认使用 standard；off 结果省略动作记录，自动 checkpoint 不采集。fixture 解析配置前只写最小 recovery marker，避免显式 off 被 runner 初始 standard 配置污染出事件日志。失败断言及业务 flow 也遵守 off。
- 显式 `flow.frame` 通过 RunSession checkpoint 保存所请求的通道和引用，`reason=explicit`、frame metadata `requestedBy=user`；off 模式继续执行显式请求。通道共用既有捕获超时和 endpoint lease。CLI 回归移走原 run 后检查 off 模式导出仍可打开显式截图/快照，不要求自动 Timeline/Trace/events。
- 新增 `run-fault-matrix.test.ts` 三个组合：断连+截图挂起+cleanup 抛错+collection 错误，以及 worker SIGKILL/AbortSignal 取消各叠加损坏快照、完整损坏日志行、截断尾行及导出截图缺失。原 runner 错误、partial 状态、已 flush 动作/步骤及可保留截图贯通 report/manifest/result/Timeline/Trace/移动导出；普通导出拒绝，显式 partial 导出列出缺失项。
- 修复父进程恢复 attempt 时漏写中断原因：只把 process/unhandled 错误补到未完成/中断 attempt，按 phase/message 去重；collection/suite 错误继续归 run，不附加给无关 attempt。

验证：全量 `pnpm build`、`pnpm test`、`pnpm lint` 通过（core 906、Vitest 60 + 3 expected fail、CLI 174、MCP 162、VS Code 347、TDD 126、Riverpod 16）。随后将模式矩阵扩展为有/无业务分组 6 例，定向测试通过；Vitest 定向 lint 及最新 CLI build 通过。按 `/document-features` 重建 400 个文档、校验 968 个链接；能力目录生成、Harness 与 diff check 通过。日志：`/tmp/fliwright-modes-matrix-{build,tests,lint,docs}.log`、`/tmp/fliwright-recording-modes-green.log`、`/tmp/fliwright-combined-faults-green.log`。受控 driver 的组合矩阵不替代真实 Flutter 断连、原生输入、移动设备或发布性能验收。

### 2026-10-17：真实 macOS fixture 环境复查

从已解析的 Flutter package root 找到 `/Users/leo/fvm/versions/3.41.9/bin/flutter`（SDK 不在当前 PATH），版本 Flutter 3.41.9 / Dart 3.11.5。原仓库外的临时 fixture 副本通过锁文件解析依赖并实际构建 macOS App，VM 连接、真实计数器动作、业务文本轮询断言和截图可用。发现录制主入口及 test_driver 入口缺少 Flutter widgets import，修复后两个入口 `flutter analyze --no-pub` 通过，fixture widget 回归 1 项通过。构建日志：`/tmp/fliwright-live-fixture-run.log`（包含本地运行信息，不提交）。

当前原生输入能力检查 `AXIsProcessTrusted=false`、`CGPreflightPostEventAccess=false`；尚不能提供原生鼠标/键盘、IME 或窗口交互验收。`flutter devices --machine` 只列 macOS 和 Chrome，无 Android/iOS 设备。指定 exio 目录 `/Users/leo.he/projects/exio/exio_app` 仍不存在。上述限制仅覆盖相应实机任务，不阻止继续执行真实 VM 操作与测量。

### 2026-10-17：真实 full 模式快照性能修复与三模式复验

真实 VM 的 full 模式先出现约 5.87 秒的采集 P95；完整 CLI/Vitest fixture 中，两个动作的起始快照均超过默认通道预算，业务结果虽通过，证据及导出只能标 partial。最小复现 `/tmp/fliwright-snapshot-latency.mjs` 对真实 `driver.page.snapshot()` 设置 1 秒断言，实际 5,422ms、19 refs，先得到红灯。

VM CPU profile（`/tmp/fliwright-snapshot-cpu.json`）51 个样本中 50 个落在 `findAncestorName` / `extractName`，其中 49 个涉及不存在 `.name` 的异常/堆栈。`SnapExtension` 因此先判定有效候选与已有标签，仅在需要兜底时读名称，再用当前快照内的 `Map<Element, String?>` 复用祖先结果；下一次请求重读，保留既有 Scaffold/WidgetsApp 边界。

- 测试优先：`snap_test.dart` 新增 3 项，先验证失败，再覆盖已有标签免查名称、祖先名称兜底及同次共享/下次刷新。
- 真实复现转绿：相同 19 refs 的快照从 5,422ms 降至 236ms。首次只延迟查找仍约 2,469ms，因此追加请求内缓存后再复验。
- 验证：snap 16 项、bridge 全量 172 项通过（2 项跳过）；snap 源码与测试定向 analyze 通过，Dart format 已执行。日志 `/tmp/fliwright-snapshot-{name,cache}-{red,green}.log`、`/tmp/fliwright-snapshot-bridge-tests.log`、`/tmp/fliwright-snapshot-analyze.log`。
- 原始场景复跑：真实 CLI/Vitest 三模式各执行两次 locator 点击、真实文本断言及显式 frame；off disabled、standard/full complete，portable export `partial=false`、缺失项为空。证据 `/tmp/fliwright-real-mode-fixture-evidence-after-snapshot-fix/acceptance.json`。
- 同机 core 小样本：Flutter 3.41.9 / Dart 3.11.5、Darwin 27.0.0 arm64，viewport 821×777@1；每模式 10 动作×3 轮，standard 采集 P95 88.343ms、full 265.485ms。证据 `/tmp/fliwright-real-vm-recording-evidence-bounded/benchmark.json`。测量包含证据回读计字节，不含 Vitest journal/progress 成本；不关闭 M4.6。

新增仓库入口 `scripts/benchmark-recording-vm.mjs` 将此受控 VM 基准固化；回读验证移到测量后，逐批校验最终业务计数及动作/证据数量，分别输出操作、采集和总体时间。M4.6 已继续细分为真实 core 规模、完整 Vitest 持久化规模、固定缓存预算、十分钟录制及发布汇总五项，保持原验收标准。

### 2026-10-17：M4.6a.1 真实 VM 千次动作与直接 Driver 清理

同一 macOS fixture 使用仓库基准入口，每模式 334 动作×3 轮，轮换执行顺序；每批真实文本断言验证业务计数，standard 1,002 张截图、full 2,004 张截图及 1,002 份快照全部 captured 并落盘回读。standard 采集总耗时 75.878s、P95 94.984ms、P99 102.407ms，包含操作的总体 81.846s；full 采集总耗时 214.122s、P95 261.469ms、P99 298.118ms，包含操作的总体 220.449s；off 总体 5.735s。结果见 `/tmp/fliwright-real-vm-recording-1002-verified/benchmark.json`，发布文档同步记录了全部口径。

这关闭 M4.6a.1 的受控 core 规模测量，不关闭整个 M4.6。此入口不包含 Vitest progress/journal、测试起止采集、原生录制和原始事件缓存；完整 Vitest 路径另行执行，十分钟与固定缓存预算仍待完成。

补充真实 VM cleanup 复现：`node /tmp/fliwright-real-vm-cleanup.mjs`。真实 Driver 连接 Flutter，挂起插件 onDispose，并同时保留一个 2 秒 settle RPC 和未完成 HTTP mock 请求；75ms 时取消，约 79.139ms 返回原取消原因。待处理 RPC 拒绝、实际 VM socket destroyed、HTTP peer 关闭、mock server URL 清空、AbortSignal 监听器归零，后续请求拒绝；独立 observer 重连验证 App 仍响应。脱敏报告 `/tmp/fliwright-real-vm-cleanup.json`。这是直接 Driver 在真实 VM 上的资源释放证据，不等同于真实 fixture 故障组合、App 强杀或原生录制验收。

### 2026-10-17：M3.6 录制入口清理取消接线

真实 Driver 清理复验后，增加 `captureRecording` 边界回归，发现原入口的 disposal `Promise.race` 只使调用方超时返回，未通知仍挂起的资源释放过程。先在 `RecordingCapture.test.ts` 用真实 WebSocket、挂起 plugin 和待处理 RPC 复现：录制结果虽 partial，cleanup 收不到取消信号，测试红灯。

`RecordingCaptureResource.dispose` 现接受可选 `{ signal }`，capture 为 disposal 创建独立取消控制器，预算到期时用同一个超时错误取消；`openRecordingCapture` 转交给 Driver。清理故障继续将已有录制标 partial，原始 start/wait/stop 错误保持优先。聚焦 7 项通过，新增用例验证实际 peer close、pending RPC disconnected、后续请求拒绝和 abort listener 移除。红绿日志 `/tmp/fliwright-capture-cleanup-{red,green}.log`。

### 2026-10-17：M4.6a.2 完整 CLI/Vitest 千次动作与导出

真实 VM 经公共 `runCommand` 执行 9 个 attempt（3 模式×3 轮、每轮 334 动作），按轮换顺序运行；每模式共 1,002 次动作，每批实际文本断言核验计数。每次动作计时包含采集与 progress/journal 持久化；另行记录整个运行及导出时间。

| 模式 | 累计动作时间 | 动作 P95 / P99 | 含测试起止图的证据数量 | 最终证据状态 |
| --- | --- | --- | --- | --- |
| off | 6.778s | 10.729 / 28.292ms | 0 | disabled |
| standard | 104.778s | 120.090 / 128.983ms | 1,008 | complete |
| full | 285.523s | 320.679 / 376.909ms | 3,012 | complete |

全部 result、Timeline、Trace 状态一致；非 off attempt 的 journal 非空，动作与证据数精确匹配。整个运行 400.102s，portable export 2.343s，`partial=false`、missing 为空。复现 `/tmp/fliwright-real-vm-vitest-scale.mjs`，报告 `/tmp/fliwright-real-vm-vitest-scale/acceptance.json`。此 6.7 分钟自动执行不属于十分钟人工录制稳定性，且不证明固定缓存预算。M4.6a.1/.2 已有真实规模证据，M4.6a.3/.4 及其余发布门槛保持未完成。

移开原始 runs 目录后的独立读取也通过：导出包 9 个 attempt、3,018 张 PNG、1,002 份 JSON 快照、6 份 journal 及对应 Timeline/Trace 均可读，证据路径均位于导出包内。报告 `/tmp/fliwright-real-vm-vitest-scale/portable-verification.json`；验证后原目录已恢复。自有 Flutter 工具与 App 已退出，没有保留运行中的 VM。

本轮最终验证：`pnpm build`、`pnpm test`、`pnpm lint`、能力目录再生成、`node scripts/verify-harness.mjs` 和 `git diff --check` 均通过。TypeScript：core 907、Vitest 63（另 3 个 expected fail）、CLI 174、MCP 162、VS Code 347、TDD 126、Riverpod 16；Dart bridge 172 通过、2 跳过。按 document-features 从当前源码再生成 11 个包、400 份 Markdown，968 个内部链接通过检查。日志 `/tmp/fliwright-snapshot-capture-{build,tests,lint,docs}.log`。整体目标仍未完成：原生输入与 IME、完整 Extension Host 流程、exio、移动设备/窗口稳定性、真实故障矩阵、固定缓存预算和十分钟录制继续保留验收任务。

### 2026-10-17：M4.6a.3 原始事件归档、有界聚合与截图任务预算

`RecorderController` 不再保留全部原始事件并反复重聚合：新增内部 `RecordingEventStore`，在接收有效唯一事件时同步增量追加独立 session 的 `events.jsonl`，聚合仅保留当前 gesture/edit 段与已完成操作。move 轨迹完整归档但不占热聚合窗口，连续同目标/焦点输入只保留当前最终值；text-before-up、清空、route/focus 边界及多指按批量聚合语义处理。

- `RecorderStartOptions.eventCache` 分别约束聚合与乱序 payload 数量/字节，默认各 128 事件、1 MiB；`RecordingResult.eventCache` 提供当前与峰值及归档计数。操作与 sequence 元数据可增长。超预算保留归档和可审阅操作，明确 partial，不能标可靠录制。
- `artifactDirectory` 可指定录制归档父目录，每个 session 使用独立子目录；默认写系统临时目录。`getRawEvents()` 是显式全量诊断读盘，`getRawEventsPath()` 返回实际本地归档，`getRawEventCount()` 用于进度；VS Code 实时更新已改为计数 API，避免每帧读取全部历史。
- 原始事件写入初始化/追加失败不丢已聚合的业务操作，记录 archive issue 与归档计数差异并标 partial。协议校验继续拒绝未掩码的敏感输入，不把它写入归档；有效掩码可以保存。
- 截图任务改用完成即移除的 Set，`maxPendingScreenshots` 默认 8；`RecordingResult.screenshotQueue` 暴露当前/峰值/上限。队列耗尽时受影响 frame 明确 error，结果 partial；不会用无证据的完整状态掩盖采集降级。

测试优先证据：`RecordingEventStore.test.ts` 先因缺失实现失败，再验证 1,000 手势/2,000 事件归档、2,001 次连续编辑最终清空、text-before-up/移动/focus/route 顺序、混合输入与批量聚合对照、多指/取消、预算耗尽、初始化/磁盘写失败。`RecorderCache.test.ts` 先证明集成 API 缺失及截图队列无预算，再验证完整 1,000 动作生成、乱序溢出、session 重启、非法预算、archive 故障及敏感数据拒绝；采集故障下 1,000 帧配置四任务上限，实际请求不超过初始采样加四个 frame，全部受影响帧为 error。聚焦/红绿日志 `/tmp/fliwright-event-store-{red,green}.log`、`/tmp/fliwright-recorder-cache-{red,green}.log`、`/tmp/fliwright-screenshot-queue-{red,green}.log`、`/tmp/fliwright-event-archive-final-green.log`。

synthetic 基准 `/tmp/fliwright-cache-budgets-benchmark.json`：完整归档 2,000 事件、保留 1,000 操作与代码；聚合峰值 2 事件/794 编码字节，乱序峰值 1 事件/483 字节，截图任务峰值 1、结束 0。仅证明当前受控输入的缓存统计与保留窗口预算，不证明真实 App heap 峰值。历史 base64 图片仍在 frames 中，binary budget 维持 false；默认临时归档的跨 CLI/MCP/IDE 便携迁移、历史图落盘与按需读取，以及十分钟真实录制仍待实现/验收，M4.6a.3 未关闭。

本轮验证通过 `pnpm build`、全量 `pnpm test`、`pnpm lint`；补充最终 core 全量为 922 项，Vitest 63（另 3 expected fail）、CLI 174、MCP 162、VS Code 347、TDD 126、Riverpod 16。feature docs 从当前源码重建 400 份、968 内部链接，能力目录和 Harness 校验通过。日志 `/tmp/fliwright-cache-budgets-{build,tests,lint,docs}.log`、`/tmp/fliwright-cache-budgets-core-final.log`。本轮没有新增 Flutter/原生输入验收，整体目标保持进行中。

### 2026-10-17：M4.6a.3 二进制落盘、共享清单与真实长录制反例

新增 `RecordingArtifacts.ts`：截图先校验默认 8 MiB decoded 上限，经临时文件/rename 落盘后发布相对 `path`、`byteLength` 和图片元数据。frame、最新采样和生成选项不再保留历史 base64；`binaryCache` 记录 decoded 峰值、上限和写入数。截图超时保持 capture issue，不被后续成功采样抹去；deadline/generation 检查阻止迟到图片写入已结束或新会话。磁盘错误中的本地录制目录在可持久化问题中替换为占位符。

`copyRecordingArtifacts` 按引用逐文件复制截图和原始事件，校验缺文件、大小和源/目标 symlink 越界。CLI/MCP 保存原始 capture 后再回放；回放归档移除 runtime artifact base 并复制证据。三端共享 `RecordingManifest` schemaVersion 2，保存 selectors、生成选项和确认检查点；旧 base64 清单不加兼容读取。VS Code 仅加载元数据，使用受控本地资源 URL 和可见节点/lazy 图片审阅。重新生成回归先发现确认断言丢失，再验证清单生成选项保留 checkpoints 后输出代码完全一致。

确定性规模回归生成 1,000 张不同、约 128 KiB 的有效 PNG，保留全部操作与生成点击；迁移后删除源目录，再逐张解压验证。另覆盖磁盘写失败、字节预算、超时后成功采样仍 partial、迟到响应、新会话、缺文件和双向 symlink 越界。CLI/MCP、replay 和 IDE 分别验证便携保存、来源移走后的读图、元数据加载和断言再生成。红绿证据包含 `/tmp/fliwright-binary-{late,replay,storage-paths}-red.log`、`/tmp/fliwright-manifest-regenerate-{cli,mcp}-{red,green}.log`，聚焦结果 `/tmp/fliwright-binary-{valid-png,path}-green.log`。

新增 `scripts/benchmark-recording-cache-vm.mjs` 作为真实 recorder soak 入口。在 Flutter 3.41.9 / Dart 3.11.5、macOS arm64、821 × 777@1 的受控 fixture 上，约十分钟（599,999.449ms）执行 1,000 个桥接指针点击，实际计数从 201 到 1,201。完整保留 1,000 operations/frames 和 2,001 连续事件，但 1 次截图超过 3 秒，11 个事件目标捕获超预算，生成 989 个可靠 selector 点击与 11 个坐标草稿。最终正确为 partial，**M4.6a.4 与可靠回放门槛未通过**。脚本已修正启动 route 事件计数与定时器提前结束的检查，后续仍需重跑。

真实聚合峰值 2 事件/2,706 编码字节，乱序 1/1,354；截图 decoded 峰值 23,935 字节，历史 retainedBytes=0，任务峰值 1、结束 0。进程周期采样峰值 RSS 121,389,056、heapUsed 39,581,432、external 4,765,184、ArrayBuffers 1,037,720 字节；不将周期样本冒充连续内存峰值。实际写入 411 张采样图，1,000 帧复用其中图片；迁移并移走源目录后，全部帧引用、事件顺序、PNG chunk CRC/解压及尺寸通过，包含 399 种图片内容。此实测不替代独特大 PNG 回归，也不替代原生输入。报告 `/tmp/fliwright-binary-real-vm-soak-verified/{acceptance,partial-verification,png-verification}.json`；工具进程与自有 Flutter App 已退出。

最终检查通过：workspace build/lint、全量 TypeScript 测试（core 最终复验 935、Vitest 63 + 3 expected fail、CLI 176、MCP 163、VS Code 348、TDD 126、Riverpod 16）、Harness 与 diff 校验。feature docs 按技能从源码生成 11 包/402 Markdown，972 内部链接通过。日志 `/tmp/fliwright-binary-delivery-{build,tests,lint,docs}.log`、`/tmp/fliwright-binary-core-delivery.log`、`/tmp/fliwright-binary-storage-final-{build,lint,docs}.log`。下一步隔离截图采集阶段和 before-dispatch 目标捕获的耗时，建立短复现，再重跑长录制；完整 Extension Host、原生输入/IME、exio、移动平台与剩余真实故障门槛继续保留。

### 2026-10-17：M4.6a.4 目标捕获与采样修复、十分钟复验

500 次动作短复现显示截图 RPC 一般小于 130ms，而持续操作时的 settle 最高 1,422ms。core 红灯用例让 settle 持续 pending、截图可用，原录制为 partial；采样改为直接获取最新合成帧后转绿，保留原截图预算和迟到响应守门，自动执行的证据策略独立保持。

bridge 回归先证明唯一 key 仍读取无关祖先 name；禁用动态 name 后，长录制仍有 2 个目标超预算，提前停止保存 `/tmp/fliwright-recording-soak-after-latency-fix/early-failure.json`。阶段诊断发现实际目标是 `InkWell`：控件评分漏掉 fixture 的 `FilledButton`。普通/tonal 两个分发测试先得到 InkWell，再验证补齐评分后冻结正确 key。另缩紧遍历次数回归，证明唯一性已验证后继续祖先遍历会丢弃可靠候选；现验证唯一 key/semantics 后立即返回基本元数据。原 12ms 时间预算、节点与访问上限不变；临时诊断日志已移除。

修复后 500 次真实点击全部可靠，93 次截图 RPC P95 103.341ms、最大 200.486ms。随后 `scripts/benchmark-recording-cache-vm.mjs` 在 Flutter 3.41.9 / Dart 3.11.5、macOS arm64、821×777@1 连续录制 600,000.343ms：实际计数 500→1,500，1,000 操作/生成点击/帧、2,001 连续事件全部保留，capture=captured、issues=[]、unresolved=0。

聚合峰值 2 事件/1,338 编码字节，乱序峰值 1/670，decoded 截图峰值 24,140 字节、retainedBytes=0；任务峰值 1、stop 后 0。写入 2,380 张采样图，历史帧引用 999 个文件/不同图片内容。移开源目录后，1,000 帧的 PNG CRC、解压、scanline filter 与尺寸及全部事件顺序通过。stop 后点击不再产生录制事件，采样停止且 transport 关闭。周期采样最大 RSS 132,300,800、heapUsed 35,780,656、external 6,781,006、ArrayBuffers 3,053,502 字节，仅声明周期样本最大值。

报告 `/tmp/fliwright-recording-soak-keyed-target/{acceptance,png-verification}.json`。M4.6a.4 的受控 VM 切片通过，补强 M4.6a.3；原生鼠标/键盘/IME 和其余 M4 门槛仍独立验收，不关闭整个 M4.6。

### 2026-10-17：M4.5b 真实双 worker、连接中断、强杀与取消

- 两个真实 Vitest worker 使用同一 Flutter VM，各点击 20 次；记录 RPC 单调时间，验证每次动作到对应截图完成之间无另一 worker 请求，两个同名测试身份独立。业务计数准确增加 40，result/Timeline/Trace 一致，44 张截图在移走原 run 后从 portable 读取。仅证明动作/证据级租约，不声明整个测试的业务状态隔离。报告 `/tmp/fliwright-real-vm-workers/acceptance.json`。
- 透明 WebSocket 代理将第二次点击交给真实 Flutter 后丢弃其响应并断开，两次业务点击实际发生；cleanup 插件挂起。默认 3 秒采集/5 秒收尾预算下约 5,492ms 结束，保留 `WebSocket connection closed` 原错误、failed/partial 投影和首个动作 PNG；所有代理 peer 关闭，App 仍可读取。初次过紧的 200ms 采集预算使首图 timeout，不作为通过；使用默认预算重跑通过。报告 `/tmp/fliwright-real-vm-disconnect/acceptance.json`。
- 真实动作与断言落盘后强杀 worker，interrupted/partial、未完成业务 step、原动作和移动导出正确。取消初次返回后发现 parent=1 的 fork worker 仍持有 VM 连接，保存原反例。确定性回归让 runner 后代持有 TCP 连接，先验证取消后进程与连接未释放，再修复为 POSIX 独立进程组：SIGINT/AbortSignal 发送整组信号，5 秒升级 SIGKILL；runner 关闭时杀死剩余成员。Windows 保持直接子进程信号，本次不声明该平台验收。
- 修复后的真实 worker-kill 和取消分别约 706ms/766ms 返回；worker 退出、实际计数、interrupted 状态、默认 export 拒绝、partial portable PNG 和 App 响应全部通过。报告 `/tmp/fliwright-real-vm-interruptions-after-group-fix/acceptance.json`，反例 `/tmp/fliwright-real-vm-interruptions/cancellation-orphan-red.json`，红绿 `/tmp/fliwright-cancel-connected-{red,green}.log`。

上述记录补强 M4.5b 的真实 VM 切片；当时 Flutter App 本身强杀、剩余真实故障组合、原生输入、完整 Extension Host、exio、窗口/移动平台仍未验收；后续新增证据见下文。

本轮最终验证：`pnpm build`、`pnpm test`、`pnpm lint` 通过；core 936、Vitest 63（另 3 expected fail）、CLI 177、MCP 163、VS Code 348、TDD 126、Riverpod 16。bridge 全量 175 通过、2 跳过，4 个修改文件定向 analyze 无问题，Dart format 通过。按 document-features 从源码重建 11 包/402 文档、972 内部链接，能力目录、Harness 和 diff check 通过。日志 `/tmp/fliwright-recording-final-{build,tests,lint,docs,harness,diff}.log`、`/tmp/fliwright-recording-latency-final-bridge-{tests,analyze}.log`。临时诊断日志已清除，自有 Flutter App/tool、soak 与故障验证进程均已退出。整体计划保持进行中。

### 2026-10-17：M4.1 真实宿主流程、配置打包与运行产物修复

VS Code 1.142.0 Extension Host 连接真实 Flutter 3.41.9 / Dart 3.11.5 macOS fixture，执行实际录制/确认/保存/导出对话框。输入通过 bridge 驱动；不作为原生鼠标、键盘或 IME 证明。

| 任务 | 修复与验证 |
| --- | --- |
| M2.4–M2.6、M4.1 | 扩展 bundle 使用当前已安装 jiti 的公开 static 入口，支持目标项目 TS 配置及其 TS 导入；CLI 从目标项目解析配套 runner/Vitest。真实 bundle 在外部临时目录加载、修改并重载 TS helper，以及执行真实 Vitest 的回归先红后绿；没有新增依赖。 |
| M3.7、M3.9 | 生成 tap 使用 `click({ waitForAnimations: true })`，避免导航后下一次 fill 早于新页出现。最小真实探针及执行生成代码的回归证明顺序；确定性代码生成断言同步更新。 |
| M2.8、M4.1 | ProjectTestRunner 读取 IDE runner 设置并保留 CLI canonical runId；直接 Vitest 也通过公共 `finalizeRunArtifacts` 写 run.json/report.json。collection/process 失败不再显示 0/0 通过。新增 Open Exported Run 文件夹入口；Open Failure 和失败通知从 canonical run 精确选择失败/中断 attempt。 |
| M2.8、M1.6 | 两个状态存储与测试发现统一解析文件系统路径别名，修复 `/tmp` 与 `/private/tmp` 造成的错误测试身份。更新最新索引时保留带 run.json 的历史运行；回归先证明此前会删除旧失败证据，再验证保留。 |
| M1.8、M4.5 | 直接 Vitest 在 POSIX 下拥有进程组，取消信号覆盖 fork worker/后代，2 秒后升级强杀；runner close 也终止残留成员。真实子进程回归验证普通及忽略 SIGTERM 的 TCP 后代退出，宿主取消另以真实 Flutter 动作验收。Windows 仍未验收。 |

截图视觉检查发现旧实现会选中不活跃 Navigator route 内的第一个 RepaintBoundary，得到旧首页和裁剪区域。bridge 改为合成 RenderView scene；嵌套边界回归先红后绿，真实 App 与 Viewer 均确认完整表单/Submitted 页面。无头 Flutter 引擎的 scene 像素仍透明，原像素测试保留跳过，不把边界测试当作像素内容验证。bridge 全量 176 通过、2 跳过，定向 analyze 无问题。日志 `/tmp/fliwright-screenshot-boundary-{red,green}.log`、`/tmp/fliwright-ide-bridge-{tests,analyze-final}.log`。

截图修复后重新录制 `recording-1792198994948`：打开表单、填入 scene-proof、提交销毁共 3 操作/12 事件，capture=captured、issues=[]；3 帧图片均可读，提交前帧实际显示填入值。确认 saved-value 检查点并绑定 fixture-home 后，未改生成代码的回放通过，verifiedRunId=`run-2026-10-17T01-05-52-604Z`。实际保存对话框生成 ide-scene.test.ts，保存文件/replay/清单源码一致；直接 Vitest `2026-10-17T01-06-38` 和 CLI `run-2026-10-17T01-07-09-175Z` 均通过，原 run 仍保留。

反例只改期望为 rejected-value，临时项目显式配置 30 秒测试超时；`2026-10-17T01-13-17` 明确因 toHaveText 期望/实际不符失败。此前默认 5 秒超时的反例不计入业务断言验收。实际 Open Failure 命令打开失败记录及 Submitted / Saved: scene-proof 截图；完整导出后移走源目录，再通过 Open Exported Run 对话框打开相同证据，8 张 PNG 与源逐字节一致。核验后源目录恢复。

真实宿主取消 `2026-10-17T01-09-14`：实际点击和断言落盘后在 flow step 挂起，再执行 Stop Tests，manifest/report/result/Timeline/Trace 均 interrupted，证据 partial，保留 PNG，worker 已退出。第一次取消尝试先达到默认 5 秒测试超时，不计通过；第二次使用 60 秒临时用例超时，在 worker 仍运行时派发取消。

汇总机器证据 `/tmp/fliwright-ide-acceptance/acceptance.json`，视觉记录为同目录 fresh-form.png、open-failure-command.png、portable-scene-failure-viewer.png。以上不关闭 M4.1：初始化/发现完整流程、原生输入、20 轮/两窗口、exio 及 Android/iOS 仍待验收。

另核对真实 App SIGKILL 报告 `/tmp/fliwright-real-app-kill/acceptance.json`：实际计数 0→1 并落盘后，挂起真实 settle RPC，强杀自有 Flutter App；约 42ms 返回原连接错误，failed/partial 投影一致，默认 export 拒绝不完整，移走源后 partial 包内 PNG 可读，worker 退出。该报告补充故障及存储证据；图片生成早于合成 scene 修复，不外推当前图像内容/性能。

本轮 workspace build/test/lint 通过，随后 Open Failure 改动再通过 VS Code build/lint 和 364 项测试。workspace 其他包：core 938、Vitest 63 + 3 expected fail、CLI 177、MCP 163、TDD 126、Riverpod 16。feature docs 按技能从当前源码生成 11 包/403 Markdown，975 内部链接通过。日志 `/tmp/fliwright-ide-final-{build,tests,lint,docs,harness}.log`、`/tmp/fliwright-ide-failure-{build,tests,lint}.log`。

旧截图路径下的千次动作及十分钟数据保留为历史结果；业务计数、事件/缓存和复制验证仍有参考价值，不能据此证明当前合成 scene 的截图保真或性能达标。完整 CLI/Vitest 与十分钟 recorder soak 仍需重新测量，整项 M4.6 保持未完成。

### 2026-10-17：M2.8 移除 Trace 独立控制、M2.2 动作后图等待新帧

M2.8 定向核对发现 VS Code 仍贡献 traceMode 设置，并向测试/脚本发送旧 FLIWRIGHT_TRACE/DIR/LAYOUT。先以 manifest 和 env 回归复现，再移除设置、RunParams/ScriptRunParams 字段及传参；测试通知动作依据共享 recording.mode。Viewer 缺图说明不再猜测旧配置。VS Code 365 项测试、build/lint 通过；日志 `/tmp/fliwright-ide-trace-config-{red,green,build,lint}.log`。

合成 scene 版本重新执行真实 core 三模式各 1,002 动作，业务计数及全部文件数量通过，standard 采集 P95 96.280ms；但抽查最后截图显示 Count: 3004，而最终业务值为 3006，macOS OCR 再确认。报告 `/tmp/fliwright-scene-core-1002/benchmark.json` 因图像时序不满足要求，**仅作诊断，不能关闭 M4.6a.1**。

新增 Flutter 回归先证明待重建状态下默认截图在绘制前返回旧 scene。默认截图现等待 WidgetsBinding.endOfFrame，取消原多次手动 handleDrawFrame/固定延迟；不等待动画全局 settle。录制 sampler 显式 waitForFrame=false 仍取最新可用 scene。确定性用例转绿，真实 macOS 连续 20 次点击后立即截图，不额外 settle；Vision OCR 逐张确认实际计数正确。证据 `/tmp/fliwright-frame-pixels/acceptance.json`、红绿 `/tmp/fliwright-screenshot-pending-frame-{red,green}.log`。

bridge 全量测试与 screenshot 源码/测试 analyze 通过；默认帧等待改变采集成本，因此当前版本的千次动作、完整 CLI/Vitest 和十分钟录制仍须独立复验，不能沿用此前数值。

当前带帧等待的小样本为每模式 10 动作×3 轮：standard 30 张图全部 captured，采集 P95 232.339ms，含操作 P95 240.322ms；full 60 张图/30 快照全部 captured，采集 P95 654.624ms，含操作 P95 665.518ms。报告 `/tmp/fliwright-frame-core-benchmark/benchmark.json`，不以 30 动作关闭千次规模门槛。最终 bridge 177 通过、2 跳过；feature docs 403 份/975 内部链接；Harness 与 diff 校验通过。后续按顺序推进当前截图路径的千次/完整 Vitest/十分钟复验、完整 init/discovery，并继续原生/窗口/平台验收。

### 2026-10-17：M2.8 脚本生命周期与源文件身份、M4.6a.1 当前规模复验

真实子进程先复现 IDE/terminal 脚本缺少 preset，timeline fixture 拒绝运行。脚本临时配置现使用目标项目公开 ESM preset，传递共享 recording、paths、runsRoot 和 named scenarios；配置保存在项目 `.fliwright` 下以便按项目解析模块。编辑器脚本共用 VitestRunner，保留输出流，结束写 canonical run.json/report.json；普通 Node 脚本保留既有行为。回归覆盖两种入口、自定义 scripts 路径、配置和实际 attempt 结果。

真实 Extension Host 进一步发现仅有 opaque Vitest taskId 无法把 Viewer 结果归属源文件。RunSession 结果新增可选 project-relative testFile 与 suite/title testPath，runner 在创建 attempt 时提供；Viewer 按该身份匹配 canonical test/attempt，不再按最新脚本或 basename 猜测。真实子进程先验证缺字段，再转绿；同名文件、suite、retry 及错误路径回归验证精确选择。没有为旧缺身份的脚本增加猜测兼容路径。初始化与真实宿主验收报告另行记录，不以单元回归关闭整项 M4.1。

当前 scene + endOfFrame 实现按每模式 334 动作×3 轮复验，三模式各 1,002 动作，实际最终计数 3,006。standard 采集 P95 222.859ms、含动作 P95 228.311ms；full 分别 487.378ms、493.848ms。全部证据 captured 且回读通过；Vision OCR 抽查每个 standard/full 批次首/中/末动作，包括 full 前后图，27 张实际计数全部正确。报告 `/tmp/fliwright-frame-core-1002/{benchmark,image-content}.json`，仅关闭 M4.6a.1 的当前受控 core 切片；完整 CLI/Vitest 和十分钟 recorder 仍独立复验。

扩大验证并行运行多个包时出现 core 规模用例超时和 Vitest 临时目录清理 ENOTEMPTY；分别聚焦及按包顺序重跑均通过，随后全仓 `pnpm test` 通过。workspace build/lint、CLI 177、MCP 163、TDD 126、core 938、Vitest 63 + 3 expected fail、VS Code 369 均通过。生成 feature docs 11 包/403 Markdown、975 内部链接，能力目录和 Harness 校验通过。日志 `/tmp/fliwright-source-workspace-{build,tests,lint}.log`、`/tmp/fliwright-source-{docs,harness}.log`；脚本与身份红绿日志 `/tmp/fliwright-{script-lifecycle,script-source,test-source}-{red,green}.log`。

真实 init 生成完整 TS 项目配置（跳过网络安装，临时项目提供本地依赖），Extension Host 实际发现 example.test.ts/example.script.ts。按模板注释替换 fixture 标题和 keyed 增量按钮，测试验证运行前后计数；生成的 fliwright.config.ts、vitest.config.ts 和 tsconfig.json 与初始化文件哈希一致。测试 `2026-10-17T01-54-09` 与脚本 `2026-10-17T01-55-07` passed/complete，实际 View Test Run / View Script Run 打开正确 canonical attempt 和图片。报告 `/tmp/fliwright-init-host-acceptance/acceptance.json`，截图 discovery-final.png、test-viewer-final.png、script-viewer-final.png。补齐 M4.1 初始化/发现切片；原生输入、窗口稳定性和平台门槛继续保留。

完整 CLI/Vitest 当前实现首轮规模运行中，9 个测试业务结果均通过，但 full 的两轮有证据超时并明确 partial，严格验收失败；standard 三轮证据完整。反例 `/tmp/fliwright-frame-vitest-1002/acceptance.json` 与对应 canonical attempts 保留，不能用业务 passed 代替证据验收。该运行与开发构建/测试并行；已启动无其他构建/测试负载的复验，预算和采集频率不变，结果另记。

无其他构建/测试负载的完整 CLI/Vitest 复验通过：9 attempt、每模式 1,002 动作，全部业务与证据完整。standard 含采集/持久化动作 P95 236.271ms、full 576.580ms；全运行 548,848.832ms，导出另 2,679.294ms。源目录移走后，portable 3,018 PNG 可读，27 张动作边界图 OCR 正确。报告 `/tmp/fliwright-frame-vitest-1002-isolated/{acceptance,image-content}.json`。同样预算和截图频率，无源码性能改动；不能仅凭重复成功认定首轮超时的唯一原因。

随后当前 recorder 连续录制 600,000.815ms，真实业务计数 6,018→7,018，1,000 操作/帧/生成点击及 2,001 连续事件完整，capture=captured、issues=[]、unresolved=0。聚合峰值 2 事件/1,338 bytes、乱序峰值 1/670，截图 decoded 峰值 27,711 bytes、历史 retainedBytes=0，任务峰值 1/结束 0。采样写入 2,384 图，帧引用 1,000 个不同 PNG。移走源后全部 CRC/解码/尺寸通过，21 张抽查帧 OCR 匹配实际动作前计数。stop 后输入不产生新事件或图片，dispose 关闭 transport。周期样本最大 RSS 133,398,528、heapUsed 36,983,240、external 7,513,981、ArrayBuffers 3,785,376 bytes，不冒充连续峰值。报告 `/tmp/fliwright-frame-recorder-soak/{acceptance,png-verification,image-content}.json`。M4.6a.4 当前受控切片通过，原生输入/平台门槛仍未验收。

当前真实 macOS 录制测试回放产物另注入一张缺失图片，默认 export 明确拒绝；allow-partial 的 export.json 同时列出 result/Timeline 中的引用缺项，移走源目录后其余 6 张 PNG 可读，源图片和目录在验证后恢复。初始验证器错误假设 missing 使用整文件路径，修正为清单的 document:reference 形式后通过，未修改产品代码。证据 `/tmp/fliwright-frame-missing-export-verified/acceptance.json`，补强 M4.5 的真实缺图导出切片。

### 2026-10-17：M4.3a 双窗口、重建与 40 轮原样回放

同一已录制生成的跨页填写/提交销毁 TypeScript 测试，源码 SHA256=`92207f84fe3237739bd95cb6979cb78336283592d4445dcf318cbf080aef804a`，在 821×777 与 640×720 两种实际 macOS 窗口各独立 CLI 回放 20 次，共 40 个 passed/complete run。每轮 beforeEach 返回首页，再创建/填写/提交销毁新表单；两种尺寸之间停止、重建并重新启动 App，不对同一未重置表单重复点击。每轮检查实际 PNG 尺寸；两组末轮 OCR 都显示 Submitted / Saved: scene-proof。

第二尺寸最初被窗口启动恢复覆盖，截图仍为 821×777，严格验证拒绝计入。只在临时 fixture 的 macOS 启动代码中，于 nib 恢复完成后设置窗口尺寸，原生窗口查询和截图均确认 640×720，再开始计数；生成测试代码没有修改，产品源代码没有新增 resize 能力。失败的尺寸报告独立保留，不计为通过轮次。

汇总 `/tmp/fliwright-frame-window-replays/acceptance.json`，每种尺寸目录内含 20 个 canonical run、原样源码和独立 acceptance.json。该切片验证当前生成测试在两窗口下的重建和回放；原录制输入由 bridge 驱动，不替代 M3.12a 的原生输入、IME、其他关键手势或移动平台。当前 AXIsProcessTrusted/CGPreflightPostEventAccess 仍 false，指定 exio 路径不存在，adb/simctl 无可用设备；剩余环境信息已请求，不关闭整体目标。

本轮自有 Flutter App、工具与 Extension Host 已退出。最终按 document-features 从源码生成 11 包/403 Markdown，975 个内部链接通过；12 份 Harness 能力文件已生成，Harness 与 diff check 通过。日志 `/tmp/fliwright-source-delivery-{docs,capabilities,harness,diff}.log`。全仓 build/test/lint 结果见前文，此后仅更新文档；没有提交工作区已有改动或清理外部工作。整体目标继续进行中，等待剩余环境验收。

### 2026-10-17：M3.11e Dart 失败证据守门、正确保存与证据生产工具

定向审计发现 `applyDartVerification` 对 `status=failed, issues=[]` 未添加阻塞原因，错误保留 verified；空白诊断也缺少可读原因。另一个纯 readiness 入口会接受传入的通用 verifiedRunId 给 Dart 晋级。先以 3 个失败回归证明，再修正：失败证据始终返回 draft、撤销 verifiedRunId/Dart 成功证据并保留失败 replayRunId；未完成独立 Dart 编译/运行的输出不能继承 TS 身份。覆盖缺省、空、空白和实际诊断，以及 CLI/MCP 消费和 IDE 持久化/重载/保存。

IDE 的 Dart 默认输出此前错误使用 `.script.ts`。回归先红后绿；保存对话框与默认目标现共用 RecorderService 的语言判断，Dart 使用 `.dart` 和 Dart 文件过滤，显式错误后缀拒绝。写出源码保持原样，不额外追加换行，避免保存文件与已验证内容指纹不同。失败 Dart run 经重载及再次保存仍保留草稿，不因重新生成撤销失败诊断。

`scripts/verify-dart-recording.mjs` 现从自身编译/运行结果生成共享格式 `verification.json` 与 `readiness.json`，带独立 run identity、源码指纹、app entrypoint、平台和相对证据路径。当前 Flutter 3.41.9 / Dart 3.11.5、macOS 再次完成 locked pub get、analyze、缺参失败、正例成功及配置业务反例失败；原样源码 SHA256=`da40f60af01ff159bed2ca695627f692e6e9e8732bd6c0a39f6574e4c0e33100`，readiness=verified。报告 `/tmp/fliwright-dart-evidence-producer/acceptance.json`。以失败工具命令注入启动失败，输出 failed evidence/draft，报告 `/tmp/fliwright-dart-evidence-producer-failed/acceptance.json`；后者不是实际编译失败的替代证明。

CLI/MCP API 使用生成器输入重建同一源码，实际消费上述真实编译/回放证据后晋级 verified；将相同证据状态改为 failed 并清空 diagnostics 后，两入口均保留 draft。严格核对源码指纹。报告 `/tmp/fliwright-dart-evidence-consumers/acceptance.json`；此项是实际编译证据的消费验证，捕获输入为受控重建，不冒充新的原生录制或真实 VM 捕获。

验证：core 943、CLI 177、MCP 163、VS Code 369 全包测试通过，全仓 build/lint 通过。按 document-features 从当前源码生成 11 包/403 Markdown，975 内部链接、能力目录和 Harness 校验通过。日志 `/tmp/fliwright-dart-{failed-evidence,ide-save,ide-dialog}-{red,green}.log`、`/tmp/fliwright-dart-evidence-{core,cli,mcp,vscode}-tests.log`、`/tmp/fliwright-dart-evidence-{build,lint,docs,harness}.log`。继续保留原生输入、exio、移动平台及剩余故障矩阵，不关闭整体计划。

继续补齐实际入口：CLI 新增 `record --dart-verification <file>`，VS Code 新增 Import Dart Verification 命令。两者使用 core `parseDartVerificationEvidence` 校验 JSON 的状态、run identity、内容指纹、合法 package app entrypoint、平台及诊断类型；错误文件在开始捕获或修改会话之前拒绝。先复现缺失参数、文件未消费、IDE 无导入接口和命令，再转绿；CLI 再次通过文件消费真实编译证据，MCP 继续消费同一对象。

真实 VS Code 1.142.0 宿主用 renderer CDP 操作实际 quick-pick、导入与保存对话框，打开保存的 Dart 录制、导入真实编译/运行证据、保存为默认 `.dart`，核验保存文件与实际编译代码的指纹相同；导入 failed/空 diagnostics 后，实际 canonical manifest 为 draft、无 verifiedRunId，录制面板显示原因并禁用保存。自动打开目标此前误送入 TS 可视化编辑器，显示无步骤；定向回归先红后绿，改为 Dart 默认源码编辑器，重启真实宿主再确认可见源码。报告 `/tmp/fliwright-dart-import-host/acceptance.json`，最终截图 saved-dart-source-final.png、failed-dart-evidence-final.png。

宿主测试最初尝试在测试模块替换对话框函数，未影响扩展实例，未计通过。首次 CDP 输入没有选中原路径，出现不存在路径；首次保存还遇到创建目录提示，均未计入最终通过。后续明确选择全路径、完成实际对话框并核验文件、canonical 状态和最终源码编辑器。复制目录 import-proof 中保留原导入快照，编辑后的 canonical 记录按 manifest id 写到共享 recordings 目录；验收读取实际更新的 canonical 清单。以上不冒充原生 Flutter 输入。

最终受影响包全量测试：core 944、CLI 178、MCP 163、VS Code 369 通过；全仓 build/lint 通过，最后 editor 路由修复再通过 VS Code test/build/lint。文档仍为 11 包/403 Markdown、975 内部链接，能力目录和 Harness 通过。文件导入红绿日志 `/tmp/fliwright-dart-evidence-{parser,file-cli,file-ide}-{red,green}.log`，editor 路由失败日志 `/tmp/fliwright-dart-editor-routing-red.log`，成功全包结果 `/tmp/fliwright-dart-evidence-vscode-tests.log`。自有 Flutter 验证进程和 Extension Host 已退出；无新增依赖或提交。M3.11e 当前受控 macOS 证据生产、入口消费及保存切片已补齐，完整原生/平台发布验收继续保留。

### 2026-10-17：M1.4b/c、M4.5b 真实收尾故障与父进程原错误保留

真实 macOS Flutter 3.41.9 / Dart 3.11.5、640×720@1 fixture 注入三种故障。最终报告 `/tmp/fliwright-real-finalization-matrix-verified/acceptance.json`，三项通过；每项使用命名 `fixture-home` scenario，经公共 ScenarioCoordinator 应用并检查 Timeline 中的成功场景节点。输入通过 bridge 驱动，不计原生输入验收。

| 故障 | 业务与终态证据 | 资源及便携验证 |
| --- | --- | --- |
| 截图响应丢失 + 挂起插件 cleanup | 实际计数 6→8，第三次及以后的 3 个截图响应经透明代理丢弃；6,751ms 返回 failed/partial，原业务错误保留，截图 timeout 与 cleanup budget issue 可查。report/manifest/result/Timeline/Trace 一致失败。 | 默认 export 拒绝 partial；显式 partial export 在源目录移走后读回 24,632 bytes PNG，OCR 为最后成功截图 Count: 7；代理连接关闭，App 响应正常。 |
| 项目 fixture cleanup 抛错 | 实际计数 8→9，1,345ms 返回 failed/complete；各投影保留 cleanup 原错误及失败终态，业务动作证据完整。 | 源目录移走后导出 PNG 24,792 bytes 可读，OCR 为 Count: 9；App 响应正常。 |
| 父进程 run 目录不可写 | 实际计数 9→10，worker 将 run 目录 chmod 0500 后抛出业务错误；1,202ms 捕获实际 EACCES，RunFinalizationError 保留 failed runnerResult、原业务错误、runId、outputDir 与 filesystem cause。 | 不返回成功运行；worker 已退出，App 响应正常，finally 恢复目录 0700。不能写入的 manifest/report 不宣称已持久化。 |

首次真实父进程故障仅返回裸 EACCES，遮住原业务失败。先以真实 Vitest 子进程分别令 canonical manifest、外部报告副本和 worker 恢复 Timeline 路径成为目录，三条失败回归证明同一错误保留缺口。CLI 公共 finalizer 及恢复写入边界现抛出公开 RunFinalizationError，保留已规范化的 runner 结果和原 filesystem cause；消息同时包含原业务/runner 错误。直接 Vitest 的 IDE 路径复用此 finalizer。修复后上述回归及原真实权限故障均通过。

更新验证器时，扩展 fixture 上调用不存在的 test.scenario 导致 collection failure，未计成功；最终改用公共 ScenarioCoordinator 应用命名 scenario，再检查真实动作与终态。该失败记录 `/tmp/fliwright-real-finalization-matrix-final/acceptance.json` 保留。最终两张图的 OCR 结果 `/tmp/fliwright-real-finalization-matrix-verified/image-content.jsonl`，不以 PNG 文件头代替内容核验。

验证：CLI 181、VS Code 369 全包测试通过，CLI build 与全仓 lint 通过。按 document-features 从源码重新生成 11 包/404 Markdown、978 内部链接；12 份 Harness 能力文件生成，Harness/diff check 通过。日志 `/tmp/fliwright-parent-finalization-{red,green,build,cli-tests,vscode-tests,lint,docs,capabilities,harness,diff}.log`，worker 恢复补充红绿日志 `/tmp/fliwright-parent-recovery-{red,green}.log`。自有 Flutter fixture 已以 q 正常退出；无新增依赖或提交。上述仅补齐当前 macOS 真实故障切片，原生输入、exio、移动平台及完整发布门槛继续保留。

### 2026-10-17：M2.5、M3.9 项目 fixture 的命名 scenario 组合

上轮真实 cleanup 验证暴露 `extendFliwrightTest` 返回值丢失 scenario。原入口以命名场景生成的测试无法直接组合项目 fixture。真实 Vitest 子进程先验证 `test.scenario is not a function`，再修复：提取共享的场景接入函数，记录基础 fixture 的配置解析器；扩展后继续提供具备项目 fixture 类型的 ScenarioEnabledFliwrightTest/ScenarioTest。场景准备通过自动 fixture 执行，原测试主体直接注册给 Vitest，避免固定参数包装漏掉项目 fixture，也不强制初始化未使用 fixture。场景在主体之前完成；项目 fixture setup 仍遵循 Vitest 的依赖顺序，不承诺一定晚于场景准备。

新增子进程验收覆盖项目 fixture、无项目依赖、两层扩展、cleanup 原错误及场景准备失败。五个真实测试结果为 passed/passed/passed/failed/failed；未使用 fixture 若初始化会直接抛错，实际保持惰性；准备失败的主体未执行。读取各 attempt 的持久化结果确认相同终态。补充带显式项目类型的本地 fixture 回归，并单独用 strict tsc 编译测试源，确认嵌套场景回调中的项目字段类型可用。没有新增框架或依赖。

当前真实 Flutter 3.41.9 / Dart 3.11.5、640×720@1 fixture 再通过公共 `test.scenario('fixture-home')` 执行：截图响应丢失+挂起 cleanup、扩展项目 cleanup 抛错、父进程目录不可写三项均符合前节错误与资源语义。实际计数 0→2→3→4；移走源目录后保留图片 OCR 分别为 Count: 1、Count: 3。检查三份实际 Timeline 的场景节点 passed，指纹等于 ScenarioResolver 解析后定义的指纹。报告 `/tmp/fliwright-scenario-real-matrix/{acceptance,scenario-fingerprints}.json`，OCR 为同目录 image-content.jsonl；该验证只补强受控 VM 与项目 fixture 集成，不替代原生输入。

验证脚本最初把未解析声明的指纹与实际 resolved scenario 比较，因 resolver 显式补出 ready 数组而拒绝，修正为公共 ScenarioResolver 后三项通过；产品指纹行为未修改。首轮 Vitest 全包检查与 build 并行时，一项 150ms 收尾预算测试缺少 trace/trace.json；其不调用 scenario，新功能定向回归及随后全包复验通过，尚不能据此断定首轮失败原因。保留该未确认现象，不将重跑成功表述为修复该故障。

最终 Vitest 65 通过、3 expected fail，CLI 181 通过；全仓 build/lint、两个测试源 strict 类型检查通过。按 document-features 生成 11 包/404 Markdown、978 内部链接，能力目录、Harness 与 diff check 通过。日志 `/tmp/fliwright-scenario-composition-{red,green,focused,vitest-tests,cli-tests,build,vitest-build,all-lint,test-types,docs,capabilities,harness,diff}.log`。自有 Flutter 已正常退出，无提交。重新查询仍为 AXIsProcessTrusted=false、CGPreflightPostEventAccess=false；指定 exio 路径不存在，SDK 中 adb 无设备、simctl 无可用设备。继续保留 M3.12a/M4.2a/M4.4a 等原生、业务及平台门槛，整体目标未完成。

### 2026-10-17：M2.8 项目 support 脚本路由与 Trace 复验

上轮偶发缺失 Trace 的原用例分别以 4 路、12 路并行执行，共 16 次运行、144 个真实 Vitest attempt，全部通过，未再次观察到 trace/trace.json 缺失。汇总 `/tmp/fliwright-trace-{repro,stress}.json`，各编号日志同前缀。曾临时为失败测试增加产物副本以保留现场，因本轮没有失败未产生该副本；临时代码已移除。此证据不能认定原偶发现象已修复，继续保留未确认状态，不据此修改收尾预算或持久化实现。

继续核对脚本入口发现：ScriptRunner 和 terminalScriptCommand 各自通过直接 import 正则判断 runner。标准 `.script.ts` 从项目 support 模块导入扩展 fixture 时不包含直接 `@fliwright/vitest`，被误送普通 Node，出现 `.js`→`.ts` 模块无法解析，且没有 canonical 运行身份。先以编辑器后端真实子进程和终端生成命令两条失败回归复现。

两入口现共用 VitestScriptConfig 的 usesVitestScript：标准 `.script.*` 命名明确选择 fixture runtime，覆盖 ts/js 及 c/m 模块后缀；其他名称仍可通过直接 fixture import 识别。不执行 support 模块来猜测脚本类型，不新增 dependency。项目配置、目录、recording mode 和命名 scenarios 继续由同一 preset 传递。

四条真实 Vitest 验收分别运行直接导入/项目 support 导入，经编辑器/终端两条路径执行。support 模块使用 extendFliwrightTest 注入项目字段，主体实际校验字段和值；编辑器结果具有 passed canonical manifest/report 和正确 source identity，终端实际执行 terminalScriptCommand 返回的完整命令，再读取 attempt 验证身份与结果。录制关闭下证据正确为 disabled。这是脚本 runner 集成验证，不宣称新的真实 Flutter 或 Extension Host 用户流程验收。

验证：VS Code 371 全包测试、build/lint 通过；document-features 再生成 11 包/404 Markdown、978 内部链接，12 份能力目录、Harness/diff check 通过。日志 `/tmp/fliwright-indirect-script-{red,green,vscode-tests,build,lint,docs,capabilities,harness,diff}.log`。无新增依赖或提交；原生输入、exio 和移动设备等剩余门槛继续保留。

### 2026-10-17：M1.5 同 App 整条测试串行补齐

复核设计 §3.2 发现既有租约只包围动作和截图，两个 worker 的 setup、主体、afterEach 和项目 fixture cleanup 仍会交错。真实子进程回归先复现这一差异；不同 endpoint 的对照用例继续要求并行。M1.5 完成条件已补上整条测试串行与跨工作目录协调，之前的动作级验收继续作为其局部证据。

- core 的 `EndpointLeaseManager.acquire` 返回跨独立回调持有的租约；其 `run` 串行调度独立动作，嵌套动作可重入，`release` 幂等；等待支持 AbortSignal，取消不会遗留待执行回调或阻断后续调用。
- Vitest 自动 fixture 在用户 setup 前取得租约，runner 保留到重试、teardown、fixture cleanup、最终证据与持久化完成。fixture/runner 通过 task 上的非序列化身份共享句柄，不依赖 fixture `use()` 传播异步上下文。
- 动态 skip 协调 runner 完成与 fixture 清理。额外红灯揭示 `aroundEach` setup 的 skip 不进入 attempt hook，且 Vitest 临时把 state 写成 fail、同时设置 pending；现在在外层 fixture 清理时识别该状态，保存 skipped attempt 并释放租约。后续测试、timeout、setup/cleanup 失败及 retry 均由同一真实 worker 验证可继续运行。
- 默认锁目录改为用户级 `~/.fliwright/endpoint-leases`，不同 cwd 的进程也共享占用。endpoint 复用既有 `normalizeVmServiceUrl`，将带 token 的 HTTP 与 WebSocket URL 归到同一 App。不同 App 连接按 endpoint/插件配置缓存，修复启动另一 App 会关闭当前测试 driver 的问题；有并发失败回归及通过对照。

真实 macOS Flutter 验收使用两个独立 worker：第一条测试主体计数 0→10，afterEach 到 11，项目 fixture cleanup 到 12；第二条随后从 12 开始，到 22→23→24。逐次断言精确业务计数，两个同名测试有独立 attempt，result/Timeline/Trace 均 passed、evidence complete，各 14 张截图。export 后移动原 run，再读取并解码包内全部 28 张 640×720 PNG。证据 `/tmp/fliwright-whole-test-live-acceptance.json`，临时工作区由该文件的 root 字段指向。输入经 bridge；不扩大原生输入验收声明。拥有的 Flutter 进程已经退出。

验证：core 949 项通过；Vitest 70 项通过、3 项预期失败；CLI 181 项、VS Code 371 项通过。core 的录制缓存压力用例在同时运行文档生成等任务时两次超时，单独运行及独立全包运行通过；未修改该压力用例或声称修复超时。workspace build/lint、生成式 feature docs、能力目录及 Harness 校验按本轮日志记录。重点日志 `/tmp/fliwright-whole-test-{core-final-isolated,vitest-final,cli-tests,vscode-tests,build-final,lint-final,docs-final,capabilities,harness,portable}.log`；红灯日志 `/tmp/fliwright-{whole-test-lease-red,endpoint-scope-red,endpoint-scope-concurrent-red,endpoint-cross-project-red,parallel-app-driver-red,around-skip-lease-red}.log`。无新增依赖或提交；M4 原生输入、exio 和移动设备等未验收门槛保持开放。

### 2026-10-17：M1.5 排队预算与 M3.9 aroundEach 重试隔离

整条测试租约进一步发现两个生命周期缺口，均先用真实 Vitest 子进程复现再修复。

| 切片 | 失败行为 | 当前实现与独立验收 |
| --- | --- | --- |
| M1.5 等待租约不消耗主体预算 | 无用户 hook 时，自动 fixture 在主体计时内排队；短测试尚未取得 App 就超时。 | TestRegistration 在注册时通过 worker 内 Symbol metadata 绑定准备回调，runner 在 onBeforeRunTask 中、主体计时前取得租约。主体函数保持原样，fixture 依赖由 Vitest 发现。确定性屏障下，600ms 的持有者与 250ms 的等待者均通过。 |
| M3.9 scenario + aroundEach + retry | aroundEach 在 onBeforeTryTask 之前解析自动 fixture，第二次场景准备错误使用前一 attempt recorder，报 cannot be rebound。 | AttemptContext.beforeFixtures 在自动 fixture 解析前完成上一 attempt 并建立新的 session；保持重试期间同 App 租约。首轮实际断言失败、第二轮成功，两个 attempt 各有一个 Scenario 节点。 |
| M2.5 注册方式保真 | 注册代理必须保留项目 fixture、重载与 fluent 行为。 | 真实子进程覆盖 each/for、skip.each、skipIf/runIf、fails、sequential、数字 timeout、直接 extend 及用户 metadata；12 个 task 为 9 passed、3 skipped，expected failure 保留 observed failed，Symbol callback 不出现在 JSON metadata 中。 |

红绿日志 `/tmp/fliwright-lease-body-budget-{red,green}.log`、`/tmp/fliwright-scenario-around-retry-{red,green}.log`；注册回归 `/tmp/fliwright-test-registration.log`。这些是既有 M1.5/M2.5/M3.9 的后续切片，不新增顶层任务。

注册代理复核另以两条子进程回归复现：Vitest 4 已移除的第三参数 options 对象，以及重复的两个 handler，均被代理静默接受。现在将非法调用原样交回 Vitest，保留其 TypeError 和诊断；红绿日志 `/tmp/fliwright-registration-invalid-{red,green}.log`。

真实 macOS Flutter fixture 再经公共 CLI 执行命名 home scenario、aroundEach、首轮失败及一次重试；实际计数 2→3→4，两个 attempt 的 observedOutcome 分别 failed/passed，最终 testOutcome=passed、flaky=true。result/Timeline/Trace 可读，各有一个场景节点和独立动作记录，证据 complete，截图分别 4/3 张。报告 `/tmp/fliwright-registration-live-acceptance.json`，其 root 指向完整产物。首轮运行的第一 attempt 最终截图超时，保留 partial 产物于 `/var/folders/d3/j8ft39dj37g7_cm083t6mqtm0000gn/T/fliwright-registration-live-WUJaep`；独立复验未修改源码或预算。未把重跑成功表述为解决截图超时，也未以 bridge 输入替代原生验收。自有 Flutter 已正常退出。

Vitest 独立全包 73 passed、3 expected fail；CLI 181、VS Code 371 全包通过，全仓 build/lint 通过。首次与其他构建及 Flutter 启动并行时，既有 150ms 收尾用例得到 running Timeline，定向及独立全包复验通过；保留未确认现象，未修改该用例预算或宣称修复。日志 `/tmp/fliwright-registration-{vitest-full,finalization-check,vitest-isolated,cli,vscode,build,workspace-lint}.log`。随后从当前源码重新生成 feature docs、能力目录并执行 Harness/diff 校验，结果见本轮交付日志。原生输入、指定 exio 和 Android/iOS 等完整验收门槛继续开放。

最后非法注册守门修复后，Vitest 全包再次通过：75 passed、3 expected fail，Vitest build/lint 通过。日志 `/tmp/fliwright-registration-{vitest-final,final-build,final-lint}.log`。生成式 feature docs 为 11 包/404 Markdown、978 内部链接；12 份能力文件、Harness 与 diff check 通过，日志 `/tmp/fliwright-registration-{docs-final,capabilities-final,harness-final,diff-final}.log`。无新增依赖或提交；整体目标未完成。

### 2026-10-17：M1.5 / M1.8 租约排队期间的取消

真实 Vitest 子进程先复现：runner 在 onBeforeRunTask 中等待被占用的 endpoint；取消时该 task 尚未加入 Vitest 的 running-test 列表，context.signal 未被中止。等待持续约 994ms，外部持有者释放之后主体仍执行，最终错误通过。红灯 `/tmp/fliwright-lease-cancel-red.log`。

runner 现在持有每轮文件运行独立的 preparation AbortController，cancel 继续调用原基类，并中止准备阶段。注册回调将该信号与 task.context.signal 组合后交给 EndpointLeaseManager.acquire。取消的等待者直接保存 interrupted attempt/task 和脱敏原因，跳过主体，释放已取得的句柄；不等待其他 App 使用者完成，也不释放其他持有者的租约。

进一步去掉环境中的 recording mode，仅使用 createFliwrightTest 的 off 配置，回归先得到 partial，证明提前取消遗漏 fixture 策略。现在准备阶段先解析录制策略及收尾预算，无需连接 App；off 保持 disabled，standard 明确 partial。策略红绿 `/tmp/fliwright-lease-cancel-policy-{red,green}.log`。

| 验收层 | 已验证行为 |
| --- | --- |
| 真实 Vitest worker，standard/off 两种模式 | 取消后 500ms 内返回，主体不执行；result finalized/interrupted，standard 的 Timeline/Trace 均 interrupted；保留 keyboard-input 取消原因；持有者正常释放后，同 endpoint 可再次取得租约。 |
| 公共 CLI 及真实子进程 | CLI 父进程实际持有 endpoint，worker 在准备阶段取消；canonical manifest/result/Timeline/Trace/report 为 interrupted，passed=false。默认 export 拒绝 partial；allow-partial 导出后移除原 run，仍能读取同一终态与报告。该用例不要求或伪造 App 图片。 |
| 既有生命周期与组合 | 租约、runner 组合、命名 scenario/aroundEach 重试、录制模式定向回归通过；不改变同 App 整条测试串行、不同 App 并行或 250ms 主体排队预算契约。 |

验证：Vitest 77 passed、3 expected fail，CLI 182 passed；全仓 build/lint 通过。日志 `/tmp/fliwright-lease-cancel-{green,focused,cli-focused,vitest-full,cli-full,workspace-build,workspace-lint}.log`。按 document-features 再生成当前源码实现参考和能力目录，Harness/diff 校验见 `/tmp/fliwright-lease-cancel-{docs,capabilities,harness,diff}.log`。

本轮重新查询环境：AXIsProcessTrusted=false、CGPreflightPostEventAccess=false；指定 `/Users/leo.he/projects/exio/exio_app` 不存在；adb 无设备，simctl 无可用设备。M3.12a 原生输入、M4.2a exio、M4.4a 移动平台与其他完整验收门槛保持开放。本轮为 runner/CLI 进程边界验证，没有新增真实 Flutter 输入声明、依赖或提交；整体目标继续进行。

### 2026-10-17：M1.3 / M1.5 / M1.9 准备失败的测试隔离

真实 Vitest 子进程注入 App 准备错误，先通过实际注册回调取得 endpoint 租约，再抛出 `original App preparation error`。此前该错误从 onBeforeRunTask 逸出，整份文件变为 Failed Suite，两个测试都未执行；当前 attempt 缺少终态，后续测试也被阻断。standard/off 两条失败回归见 `/tmp/fliwright-preparation-failure-red.log`。

runner 现在区分准备取消和准备失败。取消继续保存 interrupted；非取消错误进入当前测试的 early-failure 路径，调用既有 AttemptContext 失败归一化和有界证据/持久化流程，保存 failed 终态与原始错误，然后释放租约。Vitest 收到当前 task 的 failed result，后续测试可以继续；准备失败不会执行用户 beforeEach 或主体，也不会伪造成 suite error。

| 验收层 | 当前证据 |
| --- | --- |
| 真实 worker，standard/off | 一项 failed、一项 passed；只有后续测试进入用户 beforeEach，同 endpoint 租约可继续取得；两个结果 finalized。failed attempt 保留原始准备错误；standard 为 partial，Timeline/Trace failed；off 为 disabled。 |
| 公共 CLI + 便携导出 | totalTests=2、failedTests=1、passedTests=1、run failed；报告保留原错误且没有 suite error。manifest/result/Timeline/Trace/report 一致；默认拒绝 partial，显式导出后移走原 run，仍读回一败一过的独立测试身份和相同终态。 |

聚焦绿灯 `/tmp/fliwright-preparation-failure-green.log`，CLI 集成 `/tmp/fliwright-preparation-failure-cli-focused.log`。本轮为准备错误的故障注入及真实进程边界验收，不声称注入错误是一次真实磁盘或 App 故障。

最终验证：Vitest 79 passed、3 expected fail，CLI 183 passed；全仓 build/lint 通过。日志 `/tmp/fliwright-preparation-failure-{vitest-full,cli-full,workspace-build,workspace-lint}.log`。feature docs 按当前源码重新生成，能力目录、Harness/diff 校验日志 `/tmp/fliwright-preparation-failure-{docs,capabilities,harness,diff}.log`。没有新增依赖或提交；原生输入、指定 exio、移动平台及其他完整验收条件继续保留，整体目标未完成。

### 2026-10-17：M1.5 租约初始化清理与存活持有者保护

进一步审计跨进程锁的异常边界，两组回归先红后绿。

| 切片 | 失败证据 | 当前实现与验收 |
| --- | --- | --- |
| 持有者记录初始化失败 | mkdir 成功后，owner 临时文件写入或原子发布失败，当前实现抛出原错误但遗留新建 .lock，后续取得需等待 stale grace。红灯 `/tmp/fliwright-lease-owner-failure-red.log`。 | 区分本次已创建目录与 mkdir 的 EEXIST 竞争；初始化失败清理本次目录后抛出原错误。4 例覆盖 write/publish × ENOSPC/EEXIST；同一 manager 与独立 manager 均可立即再次取得，最后目录为空。日志 `/tmp/fliwright-lease-owner-failure-{green,variants}.log`。 |
| 存活进程心跳延迟 | 将实际持有者记录的 heartbeatAt 改旧，原实现忽略存活 PID、直接重新取得同一 endpoint。红灯 `/tmp/fliwright-lease-live-owner-red.log`。 | 有合法 owner 时，以进程存活判定继续占用；不因心跳年龄抢占存活进程。staleAfterMs 用于未发布/损坏 owner 的目录宽限期，已退出 PID 仍可回收。原持有者 token、执行和释放保持正确，等待者可取消；日志 `/tmp/fliwright-lease-live-owner-green.log`。 |

真实 Node 子进程实际取得锁后，使用同步 gate 阻塞自己的事件循环，直到父进程写入 release 文件；期间其心跳计时器不能运行。父进程以更短 staleAfterMs 尝试取得同 endpoint，等待被 AbortSignal 取消，未取得租约；持有租约的子进程保持存活。父进程随后明确允许释放，子进程 exit 0，新的 manager 成功取得并释放。该用例与既有真正退出/损坏记录回收回归一同通过，日志 `/tmp/fliwright-lease-integrity-focused.log`。没有用延长默认 stale grace 来掩盖抢占问题。

初始化错误为 fs 边界故障注入，实际临时目录/文件和后续取得均在本机文件系统完成；不是一次真实磁盘写满的声明。子进程试验验证租约协调，不引申为新的 Flutter、原生输入或移动平台验收。

最终验证：core 955 passed，Vitest 79 passed、3 expected fail，CLI 183 passed；全仓 build/lint 通过。日志 `/tmp/fliwright-lease-integrity-{core-full,vitest-full,cli-full,build,lint}.log`。按当前源码重新生成 feature docs 和能力目录，Harness/diff 日志 `/tmp/fliwright-lease-integrity-{docs,capabilities,harness,diff}.log`。未新增依赖或提交；完整原生输入、exio、移动平台等发布验收仍开放，整体目标未完成。

### 2026-10-17：M1.4 历史收尾偶发现象的现场保留

按 41 项验收核对继续处理历史重负载下 150ms 夹具偶发缺 Trace/running Timeline。原定向命令 `pnpm --filter @fliwright/vitest exec vitest run tests/finalization-outcomes.test.ts` 先通过。随后并行运行全仓 `pnpm build` 和 Vitest 全包测试，均通过；Vitest 为 79 passed、3 expected fail，本轮没有复现该现象。没有依据本次通过认定问题已修复，也未修改收尾预算、截图频率或产品代码。

此前该回归在失败后也会删除临时夹具，无法读取失败当轮的 journal、Timeline、Trace 和 result。现在子进程退出后先保存 `vitest-output.log`；断言或读取失败时保留原始临时目录，并在带原始 cause 的错误中报告路径；成功仍删除目录。后续复现可直接关联同一轮磁盘事实，避免只有 ENOENT 或状态断言、没有现场。此改动只增强测试诊断，不是产品行为修复。

最终定向测试及 Vitest `tsc --noEmit`、diff check 通过。日志 `/tmp/fliwright-finalization-audit-{baseline,load-build,load-vitest,focused,lint}.log`。没有稳定产品源码变化，本轮不重新生成 feature docs。

本轮实际查询并保存 `/tmp/fliwright-finalization-audit-environment.json`：AXIsProcessTrusted=false、CGPreflightPostEventAccess=false，指定 exio 路径不存在，adb 设备列表为空，simctl 可用设备为空。原生输入、指定业务 App 与移动平台仍是完整验收的外部前提；未绕过权限或用别的 App/bridge 输入代替。历史偶发现象继续记为未确定原因，整体目标未完成。

### 2026-10-17：M4.4 移动验收环境自动准备（进行中）

进一步检查发现，本机已有 Android emulator/SDK 管理工具和许可证、完整 Xcode 26.5 与 CocoaPods，仅缺模拟设备镜像。不能将“当前设备列表为空”等同于无法自主准备环境。

- 安装 `system-images;android-35;default;arm64-v8a` revision 2，并创建专用 `FliwrightRecordingApi35` AVD。emulator 36.6.11 已启动为 `emulator-5580`，确认 `sys.boot_completed=1`、Android 15、arm64-v8a、1080×2400、420 dpi。尚未完成 App 录制/回放，不计为 Android 能力通过。
- 使用 Flutter 3.41.9 在临时夹具副本生成 Android 工程，`pub get --enforce-lockfile` 通过；debug APK 首次构建正在下载 Android Flutter 运行库。构建日志 `/tmp/fliwright-android-build.log`；工作副本由 `/tmp/fliwright-android-environment.json` 定位，不在仓库新增设备配置或迁移文件。
- 原生录制验证脚本 `/tmp/fliwright-android-native.mjs` 已准备并通过语法检查。计划使用 `adb shell input` 发送 Android 系统触控/键盘事件，原样生成 TypeScript 测试后通过公共 CLI 回放，并检查实际保存值与命名 scenario；该脚本尚未完成执行，不作为通过证据。
- 开始安装匹配的 iOS 26.5 Simulator build 23F73 ARM64 runtime；下载日志 `/tmp/fliwright-ios-runtime-install.log`。同一临时夹具的 iOS 工程已生成；首次 `--no-pub` 构建报告 Podfile missing，随后对新增 iOS 平台重新执行锁定 pub get 并继续构建，日志 `/tmp/fliwright-ios-{pubget,build}.log`。未运行设备流程前保持 iOS 未验收。

锁定 pub get 后 CocoaPods install 通过，第二次 iOS 构建随后因缺少 iOS 26.5 可用平台目标而终止，未计为构建通过。等待同一 runtime 下载/安装进程完成后再构建，不在 runtime 缺失期间重复执行同一构建。

移动模拟器准备不需要 macOS 辅助功能/事件发送权限；没有通过 bridge 合成动作替代原生录制验收。macOS 原生输入权限和指定 exio 路径问题仍保留。宿主 SDK/临时工程准备没有修改仓库依赖或产品源码。

### 2026-10-17：M3.1 / M3.12 / M4.4 Android 系统输入录制与原样回放

Android API 35 ARM64 AVD 完成首条真实设备流程。首次 APK 构建从官方存储下载三种架构较慢；单 MiB 探针显示官方约 4.34s、匹配镜像约 0.57s，长度 170,904,810 和 ETag 相同。明确中断原构建并确认 Flutter/Gradle client PID 已退出后，使用相同 Flutter 3.41.9 和镜像、仅构建实际 Android ARM64 目标，135.4s 构建成功。未修改依赖或 SDK 版本。

原生录制由 `adb shell input` 发送系统触控/键盘事件；bridge 仅负责查询目标和观察，不发送录制中的动作。打开表单、系统输入 NativeAndroid35、关闭键盘、提交，实际显示 Saved: NativeAndroid35；表单 controller 随导航销毁。首次 stop 却返回 partial，全部 1–26 事件被拒绝。

最小原生单击探针保存原始 VM 事件，稳定复现：Android VM 在 extensionData 增加 `__destinationStream=Extension`，严格 v2 schema 将其视为未知字段。先写 connector 失败回归（12 过、1 失败），再在 VMServiceConnector 的接入层只剥离该传输字段；其他未知字段继续保留并被录制 schema 拒绝。schema 未放宽，也未添加旧协议兼容路径。聚焦 connector/协议回归通过，重新运行实际 Android 探针得到 captured、三个连续事件、无 issue。原始探针 `/tmp/fliwright-android-event-probe/events.json` 与红绿日志 `/tmp/fliwright-android-event-{red,green,probe,probe-green}.log`。

| 验收 | 结果与范围 |
| --- | --- |
| 系统输入录制 | captured，三项逻辑动作：打开表单、fill 最终值、提交。目标来自事件时冻结的稳定 key，输入先于提交；录制文件保存实际原始事件与帧。 |
| 原样生成并回放 | 公共 generator 生成 test.scenario('fixture-home')，绑定实际 navigation scenario 指纹与确认的 saved_value/toHaveText 检查点；公共 verifyRecordingReplay 执行同一源码，passed/complete，三项动作和实际断言通过，5 张 PNG。 |
| 保存未生效反例 | 仅临时夹具注入 FLIWRIGHT_FIXTURE_SAVE_FAIL，令提交丢弃文本；重新构建安装后运行完全相同生成文件，三项动作仍 passed，但业务断言及最终结果 failed，evidence complete，6 张 PNG。实际画面 Saved: 为空，不以任意错误退出代替反例。 |
| 便携证据 | 正反两份 export 默认成功；分别移走原 run 后读取 result/Timeline/Trace 和全部引用，终态 passed/failed 一致。11 张 PNG CRC/IDAT 解码通过；目视检查正例 Saved: NativeAndroid35、反例 Saved: 空。 |

全部证据位于 `/tmp/fliwright-android-environment.json` 中 root 的 acceptance 子目录：`acceptance.json`、`counterexample-acceptance.json`、`portable-acceptance.json`、`image-verification.json`、原始录制和生成源码。该定位文件不含 VM URL；端点仅在未提交的临时 runtime 文件中。首次修复后回放因临时工程缺少包解析别名而 collection failure，原失败 run 保留；补齐临时测试配置后重新录制/原样生成通过，没有人工修改生成文件以获得成功。

验证：core 956、CLI 183、Vitest 79 passed（另 3 expected fail），全仓 build/lint 通过；按 document-features 生成 11 包/404 Markdown、978 链接，能力目录与 Harness/diff check 通过。日志 `/tmp/fliwright-android-{core-tests,core-lint,cli-tests,vitest-tests,workspace-build,workspace-lint,docs,capabilities,harness}.log`。临时 App 的保存故障源码已恢复；仓库 fixture 源码未变。

该证据关闭 Android 模拟器的这一输入/跨页/提交及反例切片，不声明系统 IME composition、所有关键手势、物理设备、macOS 原生或 iOS 验收通过。iOS runtime 安装仍在原进程中进行，整体目标未完成。

### 2026-10-17：M3.12 / M4.4 iOS 系统输入录制、原样回放与保存值反例

iOS 26.5 build 23F73 ARM64 runtime 安装完成；专用 iPhone 15 模拟器 FliwrightRecordingIOS 启动。Flutter 3.41.9 临时夹具 iOS debug App 构建成功，CocoaPods 仅作用于临时工程。使用本机已有 Xcode 26.5 / XCTest / xcodeproj 1.27 创建临时 UI Test，没有增加仓库依赖或 iOS 工程文件。XCTest XCUIApplication 发送系统 tap/typeText，bridge 在录制中只查询/观察；公共 recorder、generator 与 CLI replay 使用当前构建。

| 验收 | 结果与边界 |
| --- | --- |
| 原生输入录制 | XCTest 激活已运行 App，打开表单、输入 NativeIOS265、提交并断言原生保存值；captured，无 issue，打开/输入/提交三项逻辑动作和稳定 key。表单/controller 随提交销毁，输入仍先于提交。 |
| 原样生成并执行 | generator 生成 test.scenario('fixture-home')，实际 navigation scenario 指纹和确认的 saved_value/toHaveText 检查点；verifyRecordingReplay 原样执行，passed/complete，5 张 PNG。生成代码 SHA256 为 2ec0f40a262524db4ef86de481d012095b9c905040c4044ef150ee9d4777ffd0。 |
| 业务失败反例 | 临时夹具注入 FLIWRIGHT_FIXTURE_SAVE_FAIL 丢弃提交值，构建/安装后原样运行同一生成测试；三个动作 passed，保存值断言失败，run/result/Timeline/Trace failed，证据 complete，6 张 PNG。失败画面实际为 Saved: 空值。 |
| 便携证据 | 两份默认 export 成功；分别移走原 run 后读回独立 manifest/result/Timeline/Trace，终态 passed/failed 一致，全部引用可读；11 张 393×852 PNG 的 CRC/IDAT 解码通过，正反保存页目视确认。 |

正例 run 为 run-2026-10-17T05-23-32-195Z，反例为 run-2026-10-17T05-25-26-030Z。证据位于 `/tmp/fliwright-android-environment.json` 中 root 的 ios-acceptance 子目录：acceptance.json、counterexample-acceptance.json、portable-acceptance.json、image-verification.json、capture、generated.test.ts、原生 XCTest xcresult 和 canonical runs。脚本 `/tmp/fliwright-ios-{native,replay-only,export}.mjs`、`/tmp/fliwright-ios-verify-images.py`；端点只保存在未提交的临时 runtime 文件。

保留失败事实：首次 XCTest 已到达提交页，但 Saved: 为空，原生断言失败；该次原因尚未确定，不将后续成功记为已修复。随后一轮录制实际收到 NativeIOS265 文本事件，临时诊断错误地要求 TextField 的 inspect.text（它不暴露 controller 文本），因此诊断 409 阻断提交；改为以 XCTest 字段值和提交结果断言。临时 UI Test 构建时意外包含 App terminate/launch，使已有 VM 连接断开；去除重启后最终闭环通过。这些失败 xcresult 保留，不计为产品通过证据。

本轮没有产品源码变更；临时 App 故障源码恢复后重建正向版本，再关闭自有模拟器。兼容性与 41 项核对按实际范围更新。Android/iOS 各至少一条原生输入/跨页/提交及反例切片现在都有证据；系统 IME、其他关键手势、macOS 原生、exio、设备故障矩阵和历史收尾偶发现象仍保留，整体目标未完成。

### 2026-10-17：M0.3 / M3.4 / M3.5 / M3.12 原生编辑与手势及两处桥接修复

继续在专用 iOS 26.5 ARM64 iPhone 15 模拟器使用 XCTest 系统输入，录制时 bridge 不合成动作。临时 UI Test 与夹具观察器均在临时工程，未修改仓库 fixture 行为或增加依赖。

| 切片 | 失败、修复与最终证据 |
| --- | --- |
| 600ms 长按、清空、选择替换 | 原生 XCTest press(0.6) 实际录制约 606.761ms，计数 +10；输入 First、删除到空值、Next 选词替换 Replacement。原样生成回放的空值和替换断言通过，但计数为 4 而非 13，揭示长按未生效。最小单长按探针约 12ms 返回、计数 +1。bridge 立即发送 up，只改未来 timestamp，且 int.tryParse 丢弃小数毫秒。先写两条真实 FilledButton 回归，均因 pointer 立即释放失败；修正为微秒精度 Duration 并真实 await 后发送 up。两条回归和实际设备最小探针变绿（约 639ms、+10）。修复前同一生成文件未经修改，完整回放三项检查点通过。 |
| 系统拼音 IME | 原生逐键点击 n/i/h/a/o；临时 controller listener 观察 n、ni、ni h、ni ha、ni hao 的非折叠 composing 区间，候选提交前 recorder 无 type 操作；点击系统候选“你好”，提交页实际 Saved: 你好。录制仅一个最终 fill('你好')，原样生成回放及业务断言通过。不是通过 typeText 注入汉字或测试注入 composing 值。 |
| 自动聚焦、系统粘贴 | 临时表单 autofocus 后不点击输入框，原生长按并点击系统 Paste，保存 NativePasteValue。首次原生成功但录制无 focus/text；导航自动聚焦 widget 回归复现。原因是焦点通知时过渡路由不在 onstage tree；改为从 primaryFocus.context 向祖先找到实际 EditableText。随后录入值已捕获，但候选沿用焦点时 matchCount=0，守门正确保持 draft；加强回归先红后绿，在文本编辑当下、原 element 仍 mounted 时刷新无效候选并缓存唯一匹配证据。最终原生重录后生成 longPress/fill/submit，未经人工修改回放通过 saved_value 断言。 |
| unsupported 多指手势 | 真实 XCTest 双指 pinch；capture partial，明确 Unsupported gesture: multi-pointer gesture；即使提供 scenario 和确认检查点，readiness 仍 draft，无 verified。此处 partial/draft 是预期守门结果，不作为可靠 pinch 回放。 |

证据定位仍为 `/tmp/fliwright-android-environment.json` 中 root，各目录独立：

- `ios-gestures-acceptance`：acceptance.json、原样 generated.test.ts、verification-red.json/verification-green.json、captured.json、原生 xcresult、两份 export 和 image-verification.json。修复前 run-2026-10-17T05-33-39-407Z failed，修复后 run-2026-10-17T05-39-11-669Z passed，源码 SHA256 一致为 5e6a887d7f575af89fb65bb4abb797d499aa813ff5ad4764642cc7f9613e20c6。12+11 张 PNG 均解码，目视计数 4→13。
- `ios-ime-acceptance`：composing-before-commit.json 包含真实系统 composing 值和当时操作，acceptance.json、captured.json、生成文件、原生 xcresult、export 与 image-verification.json。run-2026-10-17T05-41-17-766Z passed/complete，5 张 PNG 解码，目视 Saved: 你好。
- `ios-paste-acceptance`、`ios-paste-fixed-acceptance` 保留漏输入的失败回放和零匹配候选的 draft 中间态；`ios-paste-target-acceptance` 为最终通过记录，run-2026-10-17T05-51-26-148Z passed/complete，6 张 PNG 解码，移走原 run 后仍可读取 export 引用。
- `ios-pinch-acceptance`：原生 xcresult、captured.json、generated-readiness.json、acceptance.json，预期 partial/draft。

聚焦日志 `/tmp/fliwright-longpress-widget-{red,green,final}.log`、`/tmp/fliwright-ios-longpress-{red,integer,green}.log`、`/tmp/fliwright-autofocus-{widget-red,focused-context,candidate-red,candidate-green}.log`。最终 bridge 全包 180 passed、2 skipped，改动四文件分析无 issue；全包 analyze 仍有三个原有 unnecessary_import info（capture_frame_test.dart 两处、extension_registry_test.dart 一处），未将它报告为全包分析通过。日志 `/tmp/fliwright-native-input-bridge-final-tests.log`、`/tmp/fliwright-native-input-final-analyze.log`。feature docs 从当前源码生成 11 包/404 Markdown、978 链接，能力与 Harness 校验通过；最后一次生成/检查日志 `/tmp/fliwright-native-input-{docs,capabilities,harness}-final.log`。

临时夹具的 composing 日志观察器和 autofocus 变化已移除，保留当前产品修复并重建恢复版 App；完成后停止自有模拟器。当前证据增加 iOS 指定系统 IME 与编辑/手势切片，不关闭 macOS 原生双窗口每流程 20 次、指定 exio、其他原生手势/故障矩阵和历史收尾偶发现象。整体目标仍未完成。

### 2026-10-17：M3.6 / M4.5b iOS 原生录制中的中断与恢复

同一专用 iOS 26.5 ARM64 iPhone 15 模拟器，XCTest 激活已运行 App，通过原生按钮点击观察 Count: 1。录制期间 bridge 仅查询和接收事件，不合成操作。沿用公共 captureRecording 与实际 CLI，未改产品源码、依赖或夹具。

| 执行切片 | 验收与结果 |
| --- | --- |
| iOS App terminate | 原生点击和截图/事件接收后，以 simctl terminate 真实终止 App；公共 captureRecording 在约 105.642ms 内结束，status=failed，保留 Not connected 原因。stop 一次、自有 driver 已 dispose；保留 1 个动作、3 条归档事件、1 张已有截图，readiness=draft。 |
| iOS AbortSignal | 同样原生点击后取消；约 6.746ms 内返回 partial/cancelled，明确 Recording cancelled，stop 一次并 dispose。已有动作/事件/截图保留，readiness=draft；新 driver 在同 App 上开启不同 session 并正常 captured，证明录制所有权已释放。 |
| 实际 CLI OS SIGINT | 实际 CLI record 子进程先产出初始截图，再允许 XCTest 点击；观察到 CLI 记录 tap 后发送 OS SIGINT。它将信号作为请求停止，captured；显式 --verify 原样执行生成测试，命名 navigation scenario 与实际 Count: 1 断言通过，readiness=verified。停止、回放、进程退出约 2,566.232ms，退出码 0，无终止信号；随后新录制会话成功。 |
| 便携证据与稳定状态 | 三份录制引用均复制后移走原 capture，CLI 另移走持久化 recording；引用的动作/JSONL/截图仍可读。kill/abort 的公开帧和事件数在 stop 后 1.2 秒保持不变、截图待处理数为 0、二进制 retainedBytes=0。CLI verified run 默认 export，移走原 run 后 manifest/result/Timeline/Trace 均 passed、evidence complete，5 项证据引用可读。所有录制/运行共 8 张 393×852 PNG 的 CRC 与完整 IDAT 解码通过。 |

截图语义限制：录制帧是指针事件时已有采样，三份均显示 Count: 0；这是已保存的先前观察，不能宣称它们显示点击后的 Count: 1 或故障当时画面。原生 XCTest 的 Count: 1 断言和生成回放末帧分别验证动作结果；末帧已目视核验 Count: 1。不将复制成功转换成更强的图像时序声明。

证据目录为 `/tmp/fliwright-android-environment.json` 中 root：`ios-recording-kill-acceptance`、`ios-recording-abort-acceptance`、`ios-cli-record-sigint-acceptance`，各有 acceptance.json、native-xctest.log、xcresult、便携录制、readiness 与 image-verification.json。CLI run 为 run-2026-10-17T06-02-09-632Z，另有 cli.log、generated.test.ts、portable-run 与 portable-acceptance.json。脚本 `/tmp/fliwright-ios-faults.mjs`、`/tmp/fliwright-ios-cli-sigint.mjs`、`/tmp/fliwright-ios-fault-export.mjs`、`/tmp/fliwright-ios-fault-images.py`；本地端点未写入仓库。

M4.5b 后续按独立切片推进，不重复计入以上三项：

| 子任务 | 所有者 / 前置 | 交付与验收 | 当前状态 |
| --- | --- | --- | --- |
| M4.5b-ios.1 | core/CLI + iOS；原生输入环境 | App terminate、AbortSignal、OS SIGINT 三种终止路径，检查有界结束、原错误、已有证据、草稿/验证状态、退出和新会话 | 上述指定模拟器切片通过。 |
| M4.5b-android.1 | core/CLI + Android；既有原生输入夹具 | 在 Android 逐项执行同样三种路径，保存平台独立报告与资源/便携证据，不继承 iOS 结论 | 后续 Android 三项切片独立通过，详见下一节。 |
| M4.5b-mobile.2 | core/Vitest + 两平台；既有 endpoint lease/worker 故障回归 | 各平台真实同 endpoint 双 worker，覆盖整条测试至 cleanup 互斥、取消排队和持有者强杀；核对精确业务结果、attempt 历史、租约恢复及无后代进程残留 | 后续两平台双 worker、worker 强杀/取消、独立持有者强杀后恢复与排队取消切片通过，详见下一节；不外推任意进程树/故障排序。 |
| M4.5b-mobile.3 | core/CLI + 两平台；移动基础录制与故障证据 | 移动 VM 连接断开、截图超时/丢失、cleanup 失败与导出缺文件，逐项保留原错误/last-known 来源、partial 原因、缺失清单及有界退出 | 后续两平台透明代理断连、截图响应丢失/挂起 cleanup、项目 cleanup、宿主写盘及缺文件导出切片通过，详见下一节；宿主文件系统故障不当作设备文件系统验收。 |

本轮无产品源码变更，因此未重复运行已通过的包级实现测试或生成 feature docs。计划、逐项核对和兼容性声明仅按实际证据更新；上述临时本地文件不视为随仓库交付的发布附件。完整 M4.5、macOS 原生、exio 和整体发布门槛继续保留。

### 2026-10-17：M1.5 / M1.8 / M4.5b Android 原生录制故障与两平台运行故障矩阵

Android API 35 ARM64 专用模拟器复用已恢复的正常 APK，iOS 复用正常 App。两平台均独立运行，不继承另一平台结果。Flutter 3.41.9 / Dart 3.11.5；运行故障用例的业务操作由 bridge 驱动，原生录制三项仍由系统输入产生。Node worker/信号、目录权限与导出故障发生在 macOS 宿主，设备提供实际 Flutter 动作、业务值与证据，不作为设备本机文件系统或物理设备验收。

| 切片 | Android | iOS | 共同验收 |
| --- | --- | --- | --- |
| 原生输入后的 App 终止、AbortSignal、CLI SIGINT | App am force-stop 约 37.474ms，failed，原错误 Service has disappeared；取消约 11.416ms，partial/cancelled；CLI 停止+原样回放+正常退出约 1,234.822ms | 上一节三项独立证据 | stop 一次、自有 driver dispose、动作/3 条归档事件/已有图保留，失败/取消保持 draft；取消和 CLI 后新会话成功。Android CLI run-2026-10-17T06-06-43-133Z verified。各 8 张便携 PNG 解码；回放 Count: 1 末帧目视正确。 |
| 两个真实 Vitest worker 整测试租约 | 计数 1→13→25，两个 worker 各 +12 | 计数 0→12→24，两个 worker 各 +12 | 每个 worker 的 setup→body 十次→afterEach 一次→fixture cleanup 一次连续，无相互插入；两个 attempt 均 passed/complete，result/Timeline/Trace 一致。各 28 张 PNG，移走源 run 后 portable 读取。 |
| worker SIGKILL / 父进程 AbortSignal | 约 887ms / 685ms | 约 764ms / 610ms | 实际动作/断言先落盘，再强杀或取消；worker 确认退出，run/manifest/result/Timeline/Trace interrupted/partial；未完成业务 step 保留，默认 export 拒绝，allow-partial 移动回读保留动作图；App 仍响应，实际计数各 +1。 |
| VM 传输中断 + 挂起 cleanup | 约 5,715ms | 约 5,639ms | 透明代理将第二次 tap 交给真实 App 后丢弃响应并断开；实际业务 +2，操作结果 passed/failed；WebSocket connection closed 原错误保留，failed/partial 与 cleanup budget 原因一致，先前动作图可从移动导出包读取；代理 peers 全部关闭。 |
| 截图响应丢失 + 挂起 cleanup | 约 6,647ms；丢弃 3 个截图响应 | 约 6,718ms；丢弃 3 个截图响应 | 实际两个动作 +2，原业务 throw 保留；截图 timeout 与 cleanup budget 显式，failed/partial；默认 export 拒绝，allow-partial 不改变原证据状态；已有第一动作图可读取。 |
| 项目 fixture cleanup 抛错 | 约 867ms | 约 793ms | 实际动作与断言通过后，cleanup 错误成为 runner failed；manifest/result/Timeline/Trace failed，证据 complete，原错误与移动导出可读，代理 peers 关闭。 |
| 宿主父级 run 目录不可写 | 约 842ms | 约 1,033ms | 业务动作完成后实际 chmod 阻止父进程写盘；RunFinalizationError 保留业务原错误与 EACCES，未宣称产物写入成功；worker 已退出，随后恢复目录权限，App 实际 +1。 |
| 导出缺截图 | 两份正常移动 run 的独立副本各删除一张图 | 同左 | 默认 export 拒绝；显式 allowPartial 标 partial 并列出缺失文件；原 complete 运行与原 export 保持不变。此处测试宿主导出器消费移动证据。 |
| 排队取消及持有者强杀后租约恢复 | 等待者取消约 10.455ms；恢复约 873.105ms，Count: 36→37 | 约 9.623ms；恢复约 699.748ms，Count: 35→36 | 独立 Node 进程持有公共 endpoint lease 并完成真实动作；等待 Vitest worker 在 beforeAll 标记后取消，主体文件未产生、worker 已退出、持有者及 App 值未改变。SIGKILL 持有者后，新 CLI/Vitest 测试回收死进程租约并精确 +1。 |

资源/图像验收：两平台各 6 个 portable run、40 张 PNG（双 worker 28、截图/cleanup 两份 6、worker kill/cancel 两份 4、传输断连 2），总计 12 份/80 张，CRC 与完整 IDAT 解码通过。另有原生录制故障共 16 张，不重复计入 80 张。截图丢失用例保留的第一动作图已目视确认 Android Count: 26、iOS Count: 25，与各自首个动作一致，不冒充第二次操作失败时画面。

证据与复验入口：

- 原生 Android 录制故障目录位于 `/tmp/fliwright-android-environment.json` 的 root，分别为 `android-recording-kill-acceptance`、`android-recording-abort-acceptance`、`android-cli-record-sigint-acceptance`；脚本 `/tmp/fliwright-android-faults.mjs`、`/tmp/fliwright-android-cli-sigint.mjs`、`/tmp/fliwright-android-fault-export.mjs`、`/tmp/fliwright-android-fault-images.py`。
- 双 worker：`/tmp/fliwright-{android,ios}-whole-test-live-acceptance.json`；脚本 `/tmp/fliwright-mobile-whole-test-live.mjs <platform>`、`/tmp/fliwright-mobile-whole-test-portable.mjs <platform>`。
- 截图/cleanup/写盘：`/tmp/fliwright-{android,ios}-scenario-real-matrix/acceptance.json`；脚本 `/tmp/fliwright-mobile-scenario-real-matrix.mjs <platform>`。
- worker kill/cancel 和传输断开：`/tmp/fliwright-{android,ios}-vm-interruptions/acceptance.json`、`/tmp/fliwright-{android,ios}-vm-disconnect/acceptance.json`；脚本 `/tmp/fliwright-mobile-vm-interruptions.mjs <platform>`、`/tmp/fliwright-mobile-vm-disconnect.mjs <platform>`。
- 缺文件导出与租约恢复：`/tmp/fliwright-{android,ios}-missing-export/acceptance.json`、`/tmp/fliwright-{android,ios}-lease-recovery-polling/acceptance.json`；脚本 `/tmp/fliwright-mobile-missing-export.mjs <platform>`、`/tmp/fliwright-mobile-lease-recovery.mjs <platform>`。
- 完整 PNG 验证：`/tmp/fliwright-{android,ios}-matrix-image-verification.json`；脚本 `/tmp/fliwright-mobile-matrix-images.py`。

保留未通过试验：初次独立租约持有者在点击后立即 resolve 得到旧帧，比随后稳定值小 1；等待者主体文件未产生，因而未据此修改产品租约。改用公共 core createExpect 的实际值轮询后，两平台记录与后续值一致。中间临时脚本先误在裸 Node 中导入 Vitest fixture（suite context 不存在），再误把 createExpect 当工厂调用，均只属验收脚本加载/调用失败，未计通过。旧目录 `/tmp/fliwright-{android,ios}-lease-recovery`、`-asserted`、`-observed` 及输出保留；最终通过目录为 `-polling`。没有产品修复，也没有用重复通过宣称解决历史 iOS 空值或收尾偶发现象。

以上补齐列明移动模拟器故障切片，未覆盖任意故障排序/进程树或物理设备。macOS 原生权限、每条关键原生流程的双窗口 20 次、指定 exio、原生拖动/重复文案及历史未定位现象仍保留，完整目标未完成。本轮没有产品源码/依赖变化，不重复包级实现测试或生成 feature docs；文档与 Harness 校验另记最终结果。

最终文档核验：41 个唯一顶层任务、75 个本地 Markdown 链接存在，`git diff --check` 与 `node scripts/verify-harness.mjs` 通过（`/tmp/fliwright-mobile-fault-final-harness.log`）。本轮 Flutter run 已退出，专用 Android/iOS 模拟器已停止；没有遗留验收 Node/Vitest worker。正常 App 二进制保留，下轮复验需启动设备并重新发现端点。

### 后续切片：iOS 原生拖动、重复文案与严格回放（2026-10-17）

M3.5/M3.12 的新增证据位于 `/tmp/fliwright-android-environment.json` 指向的 root。历史报告不回写；以下结果只关闭列明切片。

| 切片 | 观察与修复 | 验收证据 |
| --- | --- | --- |
| 重复 Save 文案 | fixture 为两个按钮分别显示 primary/secondary 结果；XCTest 系统点击第二个 Save，冻结 selector 为 secondary_save。生成文件原样回放显示 Saved: secondary。临时让第二个回调不生效，同一文件在业务断言处失败；恢复后再次通过。 | `ios-repeated-acceptance/{acceptance,strict-restored-acceptance,counterexample-acceptance,portable-acceptance,image-verification}.json`；fixture widget 先红后绿，完整 2 项通过。 |
| 原生慢拖动 | XCTest 约 1,283.259ms、逻辑位移 (0,-240)，原生与修复后回放均显示 Item15。旧生成器丢失 containing 的嵌套 match，并丢弃 durationMs；前者导致目标错配，完整 query 探针暴露后者导致快速滑动越过目标。分别补回归后修复，TS/Flow/bridge 保留小数毫秒及实际等待。 | 原始失败 `ios-drag-acceptance` 保留；修复后 `ios-drag-fixed-acceptance/{acceptance,strict-restored-acceptance,counterexample-acceptance}.json`。禁用滚动时同文件失败，恢复后通过；没有改弱 Item15 检查点。 |
| 反例误通过 | 首次禁滚动反例画面只有 Item0–12，但默认 self-healing 将 scroll_item_15 换成任意 ListTile，约 5 秒后误报 passed。真实子进程回归先红后绿；显式录制验证在独立子进程传递严格回放标识，断言不接入 healing，保留源文件与原失败，不全局修改调用方环境。 | `ios-drag-fixed-acceptance/counterexample-healed-false-positive.json` 和对应旧 run 保留为误通过证据；严格反例 failed，正常恢复 passed。`record-replay.test.ts` 证明 tryHeal 未被调用。 |
| 便携与图像 | 三份录制归档及 8 个 run 导出后移走原目录，manifest 状态与结果一致；包括原始失败、误通过历史、严格正反例。41 张 PNG 全量 CRC/IDAT 解码，393×852；四张严格正反例终态截图目视核对。 | 各目录 `portable-acceptance.json`、`image-verification.json`；汇总 `/tmp/fliwright-ios-drag-image-verification.json`。误通过历史 run 的 passed 是历史事实，不计入验收成功。 |
| Dart 独立输出 | timedDrag 使用整数微秒；提供的无效拖动时长阻塞生成。真实调用发现 Text 与 RichText 同时匹配导致 find.ancestor 重复返回同一 InkWell；生成器按 element 去重，先红后绿。最终未修改生成文件，独立 analyze 及实际 macOS Flutter integration test 通过，验证 Item12 拖动前不可见、拖动后可见。 | `dart-timed-drag-acceptance/{acceptance.json,generated_test.dart,analyze.log,macos-replay.log}`。`dart-timed-drag-host-red` 保留重复 finder 失败，另两份 setup-red 保留临时宿主缺 macOS/Podfile 的环境失败；不计作原生输入或 TS verified。 |

当前验证：core 967 项通过；CLI 184 项通过；Vitest 79 项通过、3 项 expected fail；bridge 187 项通过、2 项跳过。完整 TypeScript build/lint 通过；bridge analyze 仍为既有 3 条 unnecessary_import info，未声称零诊断。feature docs 通过源代码枚举重新生成 11 包、404 文件、978 链接；Harness capability 文件重新生成并校验通过。最终新增 source 后的复验另记。

此切片不代表 macOS 原生输入/双窗口每流程 20 次、指定 exio、Android 同手势或物理设备通过；指定 exio 路径仍缺失。iOS 首轮空值与高负载收尾偶发现象仍未定位，整体目标未完成。

#### Android 同切片的后续发现

系统输入点击第二个 Save 已通过。原生列表拖动的前三次独立捕获均保留为 draft：`android-drag-budget-draft`、`android-drag-budget-draft2`、`android-drag-budget-probe-draft`。临时 bridge 日志只用于定位，触发的是 12ms 时间预算（约 12,277µs、2,705 visits），不是放宽协议后被接纳。`RecordingTargetCapture` 现先尝试无 key 控件的类型 + 稳定 keyed ancestor，证明唯一后停止较弱文案/tooltip 探索；最多三个合格 key、排除私有生成 key、Scaffold/WidgetsApp 边界，原预算保持不变。受访问预算约束的 ListTile/InkWell 回归先红后绿，完整 bridge 188 项通过、2 项跳过；临时 debug 日志已移除。

优化后的原生 adb slow swipe (0,-240) 捕获稳定 query `InkWell within scroll_item_6`，新生成文件未经修改的严格回放显示 Item15；这是修复后新捕获的证据，不把旧 draft 改成通过。Android 引擎默认源下载阻塞，离线尝试显示缓存源缺失；仅临时 shell 使用 Flutter 镜像后构建完成，未升级依赖或修改仓库框架配置。验证时新加 Scaffold 类型遗漏 material import 的一次编译失败也保留日志，修正 import 后完整 bridge、Android 构建和 analyze 完成；analyze 仍为原有 3 条 info。

Android 最终录制时长 1,370.2ms。`android-drag-acceptance` 与 `android-repeated-acceptance` 各自保留 `acceptance.json`、`counterexample-acceptance.json`、`strict-restored-acceptance.json`、`portable-acceptance.json`、`image-verification.json`：正常生成原样通过→禁滚动/第二 Save 不生效的同文件反例 failed→恢复正常 App 后同文件通过。6 个 run 和 5 份录制归档（含三份历史 draft）移动原目录后读回，33 张 PNG 全量 CRC/IDAT 解码，412×915；四张正反例终态图目视确认。汇总 `/tmp/fliwright-android-drag-image-verification.json`。脚本为 `/tmp/fliwright-android-drag-{repeated,negative,restored,portable}.mjs` 与 `/tmp/fliwright-android-drag-images.py`。

最终受影响包验证：core 967、CLI 184、MCP 163、VS Code 371 项通过；Vitest 79 项通过/3 项 expected fail；bridge 188 项通过/2 项跳过。全工作区 TypeScript build/lint、生成 feature docs（11 包/404 文件/978 链接）、capability 生成与 Harness 校验、diff whitespace 通过。没有改依赖、提交或清理用户工作区。macOS 原生权限仍 accessibility=false/eventPosting=false，指定 exio 路径仍缺失；此前剩余整体验收条件不关闭。

### M1.4 后续：直接运行入口的终态恢复（2026-10-17）

原定向命令先通过。8 路并发叠加 build 的 16 轮中，9 轮触发用例外层 6 秒进程超时，均保留原始临时目录与输出；此时部分测试尚未执行，不能视为收尾 bug，也未放宽用例或产品预算。随后降至 3 路并发，15 轮中的第 14 轮复现原 running Timeline：`body failure with hung flush` 的 result 已 finalized/failed、Trace failed、Timeline running，并记录 `Artifact persistence exceeded the 150ms test finalization budget.`。现场 `/var/folders/d3/j8ft39dj37g7_cm083t6mqtm0000gn/T/fliwright-finalization-5qmrNw`，汇总 `/tmp/fliwright-finalization-moderate-results.json`，日志 `/tmp/fliwright-finalization-moderate-13.log`。

最小真实子进程回归仅保留两个主体（通过/原始业务失败），在 worker 内让终态 Timeline 写入挂起；worker reporter metadata 已交付正确终态，但直接 `vitest run` 没有恢复，稳定得到 running。首轮夹具遗漏空 vmServiceUrl 导致准备失败，修正测试设置后才得到预期红灯；保留 `/tmp/fliwright-direct-recovery-red{,2}.log`。没有依据错误 setup 修改产品连接逻辑。

现在 core `restoreRunAttempts` 复用原 CLI 恢复语义，Vitest `FliwrightRecoveryReporter` 在父进程持久化 worker 的已脱敏终态；runner 同时交付实际 runsRoot，preset 保留项目 reporters 并追加恢复 reporter。CLI 调用同一 core 函数。IDE 的 JSON CLI 参数会替换 preset reporters，真实回归先得到 running 后，在该入口显式增加公共恢复 reporter，终态通过。恢复不重新请求 App，不改业务结果；证据继续 partial，off 继续 disabled，父进程写入错误照常抛出。未改默认预算或旧截图 reporter。

聚焦回归绿灯后，在相同 3 路并发下执行 15 轮，每轮原 9 attempt 收尾矩阵 + 新增 2 attempt 挂写盘回归，共 165 attempt 全部通过；汇总 `/tmp/fliwright-finalization-restored-results.json`。这证明本次可复现路径得到恢复，不证明所有历史缺 Trace 同因；历史首轮缺文件没有当轮现场，继续保留。8 路时的外层进程超时也独立保留。

验证日志采用 `/tmp/fliwright-direct-recovery-*`。core 首次全包与 CLI 并行时，既有千动作缓存用例触发 5 秒超时（968 passed/1 failed），原日志保留；独立全包 969 passed，没有借重跑宣称修复该超时。CLI 184 passed。Vitest 81 passed/3 expected fail。IDE 首次全包只因脚本 argv 预期尚未包含新增 reporter 而失败，更新该预期后复验另记。feature docs 从源码重新生成 11 包/406 文件/983 链接，能力目录生成 12 文件。全仓 build/lint、IDE 最终复验和 Harness/diff 结果见下段。

此切片不关闭 macOS 原生权限、每条关键原生流程双窗口各 20 次、指定 exio 业务验收及历史 iOS 首轮空值等门槛；整体目标仍未完成。

最终：VS Code 372 passed，全仓 TypeScript build/lint、Harness 与 diff whitespace 通过。日志 `/tmp/fliwright-direct-recovery-{vscode-final,final-build,final-lint,harness,diff}.log`。41 个唯一顶层任务及计划/审计的本地链接另行核对。未改框架/依赖版本，未提交，未启动 Flutter/设备，也未清理既有工作区或失败现场。

### 2026-10-17：另一台机器验收交接及新增 macOS 回放失败

用户确认 macOS 原生权限与 exio 真实验收需要在另一台电脑完成。执行范围、准备步骤、严格回放命令、反例及证据交付要求见[跨机器交接](./2026-10-16-automation-recording-completion-machine-handoff.md)。M3.12/M4.2/M4.3 对应门槛继续待验收，当前机器无需再请求权限或缺失的 exio 路径。

本机扩展 M4.3 使用六份 iOS 原生捕获生成的文件，在 macOS 640×720 原样回放；每测试执行具名 fixture-home 导航重建、无 retry、单 worker、严格 recordingReplay。第 14 轮首个长按失败：No widget found matching selector；随后 context dump 仍包含 counter_increment/Count:0，开始截图曾超时。其余五个测试通过。失败 run 为 run-2026-10-17T07-16-31-556Z，result/Timeline/Trace 均 failed，evidence partial；前 13 轮不计连续 20 次通过。

该 run 的默认 export 被正确拒绝；allow-partial 导出后临时移走原 run，独立读取 30 条 evidence 文件引用，保留 failed/partial 与 missing，之后恢复原路径。附件位于 `.codex/recording-completion-handoff-2026-10-17/`。100 次“scenario 重置→长按→Count:10”简化探针全部通过，尚未复现完整 runner/截图条件，不能据此声称修复。本轮没有产品源码改动，新的跨平台回放也不作为 macOS 原生录制通过证据；完整验收继续保留。

完整 runner 随后独立复跑相同六文件 30 轮，共 180 attempt 全部 passed/complete，1,050 张 PNG 全量 CRC/IDAT 解码及 640×720 尺寸验证通过，汇总 `/tmp/fliwright-native-files-macos-diagnosis/640x720/positive/acceptance.json`。原失败没有重现、没有产品修复；不能据重复通过关闭偶发现象、第二窗口或 macOS 原生门槛。附件携带复跑汇总，未宣称全部 30 轮 canonical runs 已便携归档。

附件严格回放 helper 另在真实 App 上执行一轮六文件，passed/complete；原失败 partial 便携包 28 张 PNG 完整解码。自有 Flutter/App/Node 已退出，临时窗口源恢复。未改产品源码、依赖或提交，因此未重复生成 feature docs；Harness、41 个唯一顶层任务、83 个计划/审计/交接本地链接及 diff whitespace 校验通过。跨机器交接包单独存放于忽略目录，需要与当前工作区一起另行复制。

### 2026-10-17：六份原生生成文件的双窗口回放与反例补证

延续上一轮 M4.3 跨平台切片，六份 iOS 原生捕获生成的 TS 保持原字节和 SHA256；macOS 上每测试通过具名 fixture-home 重置路由并重建控件树，单 worker、无 retry、严格 recordingReplay，不依靠 healing。640×720 沿用上一轮独立 30 轮，821×777 新完成连续 20 轮；两尺寸另分别各跑一轮六文件业务反例与恢复。合计 54 个 run、324 attempt，其中 300 个连续正例 attempt、12 个业务断言 failed、12 个恢复 passed；对应证据均 complete。此处原生来源为 iOS，不能关闭 macOS 原生捕获或 exio。

临时 fixture 反例及恢复均重建 App：跨页提交丢值、拼音生成文件收到错误文案、粘贴结果移除 saved_value key、长按不加十、列表禁滚动、第二 Save 回调不生效。原样测试在原确认业务断言处 failed，恢复后 passed；没有改弱断言、放宽预算或改生成内容。目标消失保持可见文案，故另外读取 snapshot 的 missing_saved_value 与 runner 的原 key 断言失败，不凭截图文字推断 key。

全部 54 个 run 默认 export 成功，各自移走原 run 后读取独立 manifest/result/Timeline/Trace 与所有 evidence 引用，再恢复源路径。便携包 1,902 张 PNG 全量 CRC/IDAT 解码及尺寸检查通过（640×720：1,126；821×777：776）。两张 contact sheet 共 36 个终态样本目视核对，包括每尺寸首轮正例、全部反例与恢复；值、计数、滚动目标及第二 Save 与断言一致。汇总 `/tmp/fliwright-native-files-macos-followup/{portable-acceptance,image-verification}.json`，便携目录同级 `portable/`。

保留未通过试验：两次 821×777 启动实际截图仍 640×720，尺寸检查正确中止（首个 followup 与 window-fixed 目录），不计入 20 轮。临时宿主在 main queue 0.5s 后设置尺寸才实际得到 821×777；该固定延时仅用于临时原生宿主配置，不进入产品/生成测试，也未据此证明窗口恢复覆盖尺寸的具体根因。正确尺寸的 20 轮完成后，首次故障版重启的六 attempt 均在首动作失败并截图超时，run-2026-10-17T07-59-35-000Z 为 failed/partial，无 captured 截图，不能当作业务反例。随后临时宿主显式激活窗口，独立目录 foreground 中的六反例和恢复才通过；未证明前台状态是此前失败的唯一原因。失败 run 和报告一并便携保存。

定位原长按偶发失败时，新增“首页→第二 Save→截图→重置→长按→Count:10”的低层诊断。首次无逐步记录的进程长时间未结束，主动终止并保留日志，不能断言卡点；加入阶段记录及与 runner 一致的截图 1 秒等待上限后 100 轮全过，仍未复现原失败。所有历史失败继续保留，不以本次正例替代根因定位。

本轮无产品源码、依赖或生成文件变更；临时 fixture 与 Swift 已按备份恢复，自有 Flutter/App/Node 已退出。计划/审计/兼容性和交接包按上述实测范围更新；完整 M3.12/M4.2/M4.3 仍需另一台电脑的 macOS 原生和 exio，以及未定位失败的后续核查。

### 2026-10-17：暂停帧时的 settle 误判修复

历史首动作失败继续保留，另以确定性回归定位到一个可独立修复的错误：Flutter 生命周期暂停帧调度后启动真实 MaterialPageRoute，`hasScheduledFrame=false` 但 `transientCallbackCount=1`；原 settle 仅观察前者，约 32ms 报稳定，新页面尚未构建。`packages/fliwright-bridge/test/settle_test.dart` 真实路由回归先红；取消/保留同一待执行回调的对照为 1 passed/2 failed，排除“暂停状态本身必然失败”的解释。该测试使用 runAsync 的真实计时，不能把误判归给 fake clock。

bridge settle 现要求“无待调度帧且无 transient callback”才累计稳定检查；暂停帧却有 ticker 时按 16ms 继续轮询，预算耗尽保留原协议 `success:true,timedOut:true`，core Page 导航默认据此抛错。不强制 App 前台、不手动绘帧、不改变生成文件或默认预算。三个聚焦回归变绿，恢复帧调度后真实路由可完成并正常 settle。

真实 macOS App 独立红绿：临时 App 自有诊断扩展发送合法 inactive→hidden→paused 序列。原 bridge 的 `page.resetRouteStack('/', { settleTimeout:160 })` 约 57.701ms 无错误返回，但首页按钮 hitTestable 数为 0，context 为 transientCallbacks=1/hasScheduledFrame=false。修复后同一探针约 172.618ms 抛 `settle timed out after 168ms`，按钮仍不可点击；恢复合法生命周期序列后长按 606.761ms，Count:10 断言与图像通过。证据 `/tmp/fliwright-settle-live-{red-sequence,green}/acceptance.json`。首次临时探针直接跳生命周期导致 VM Server error，保留 `/tmp/fliwright-settle-live-red`，不计为产品红灯。临时诊断扩展不进入仓库。

以上只证明可复现的暂停帧路径；历史第 14 轮没有当时 lifecycle/framesEnabled 数据，且 hasScheduledFrame 记录不同，不能宣称已证明同一根因。后续完整原样生成回放结果另记。

修改后的 bridge 再跑原六份生成文件：640×720 与 821×777 各连续 20 轮，共 40 run/240 attempt 全部 passed/complete，具名重建、无 retry、严格回放及源文件 SHA256 保持。40 run 全部默认导出后移走原 run，独立读取 manifest/result/Timeline/Trace 和引用再恢复源目录；1,400 张 PNG 完整 CRC/IDAT 解码及尺寸通过（每尺寸 700）。首末轮各六流程、两尺寸共 24 个末帧样本目视正确。汇总 `/tmp/fliwright-settle-fixed-matrix/{portable-acceptance,image-verification}.json`；该复验不替代原生 macOS、exio 或历史失败根因证明。

最终验证：bridge 191 passed/2 skipped；新增 settle 三项均通过；core Page/Scenario 44 passed；workspace TypeScript lint 通过。bridge analyze 保留原有 3 条 unnecessary_import info，首次由文档引用移除引发的 unused scheduler import warning 已删除，没有新增 warning。生成 feature docs 11 包/406 文件/983 链接；Harness 首次报告能力目录过期，按源码再生成 12 文件后通过；Dart format 和 diff whitespace 通过。日志 `/tmp/fliwright-settle-*`。自有 Flutter/App/复验 Node 退出，临时诊断扩展及窗口源码恢复，临时 bridge 留当前已修复版本用于下一轮；未改依赖、未提交。

### 2026-10-17：历史失败专项复核

详见[三次历史失败的专项诊断](./2026-10-17-recording-incident-review.md)。本轮使用真实 macOS 隐藏/最小化窗口事件，旧 settle 六次误报准备成功，当前实现六次正确在准备阶段超时，十二次恢复均成功；进一步在恢复后 `framesEnabled=true/hasScheduledFrame=true` 的时点，旧实现五次首动作失败，当前实现五次等待路由完成后成功。由此复现了两种历史诊断状态，但原历史现场缺少窗口/lifecycle 记录，仍不能证明具体触发事件。

iOS 原始 XCTest 录像与同期原始 session 交叉核对，首次 `typeText` 后输入框仍为空；失败 session 没有文字事件，成功 session 的十二条文字事件被当前聚合器正确合并。问题缩小到系统输入应用到 Flutter 的阶段，确切输入投递故障仍未确定。本轮只扩展 hidden 生命周期的路由回归，当前 settle 四项通过，旧实现对照一项通过/三项失败；未新增产品源码修改。诊断证据和更新后的源码同步入跨机器交接包，完整原生 macOS/exio 发布门槛保持未完成。

### 2026-10-17：iOS 输入边界继续采证

历史 unified log 进一步确认，失败轮 UIKit 收到十二个合成按键，XCTest 返回 typing complete；成功轮也有同一 shouldSend=0，故不能据此判断丢弃。补充临时只转发的 TextInput channel 探针及 EditableText controller/焦点读数，在录制开关、截图采集、显式键盘等待和全新独立模拟器首次输入下，共二十四轮原生输入与保存全过，十二个录制轮均 captured 且文字完整。三个 XCTest result bundle 均 Passed、无 retry；本轮不计为新增完整回放或平台验收。没有复现历史空值，问题仍保留在原生键盘处理到 Flutter 编辑值更新之间，不能宣布修复。详见[诊断报告](./2026-10-17-recording-incident-review.md)的后续章节。

产品源码和依赖没有变更；临时 main 恢复、运行进程退出、原模拟器恢复 shutdown、新建模拟器删除。参数化采证工具、系统原始日志、24 轮通道/controller/录制证据及 XCTest 附件同步进交接包；重新校验归档及源码恢复。另一台电脑的 macOS 原生/exio 及历史 iOS 空值故障仍为未完成项。

### 2026-10-17：提交顺序与采证干扰复核

进一步对齐历史日志：失败轮十二个 KeyEventComplete 通知全部晚于 Save 点击，成功轮全部早于 Save；该时点差异支持输入/提交竞态调查，但不能代替 controller 更新记录。前述 24 轮带有输入/Save 间的快照请求，不能用于排除原始时序问题。新增立即提交、被动指针/controller 观测及隔离模拟器 kbd/InputUI 各 2,400ms 延迟共 32 轮全部正确保存，16 个录制轮 captured；没有复现历史空值。立即提交和被动观测首轮各有一次 XCTest 内部焦点重试，保留活动树，不计为首次直接成功。

异机采证工具改为输入/Save 间不读取值、不发 HTTP 的立即提交对照，以及被动记录保存前 controller；后六轮另等待 value predicate。新增 interrupted.json 保留失败退出的状态/录制结果，用故意错误断言中止作工具负对照；不将其记作历史故障复现。修正上一版 ZIP 中固定回调地址被误脱敏的问题并检查归档内实际源文件。产品源码和依赖保持本轮无变更，历史 iOS 空值及异机发布门槛未关闭，详见专项报告新章节。
