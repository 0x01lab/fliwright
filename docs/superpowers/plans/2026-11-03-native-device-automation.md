# 原生元素与设备能力实施计划

日期：2026-11-03。状态：实施中；会话和 Adapter 基础已落地，完整原生测试能力尚未达到发布验收。

设计依据：[原生元素与设备能力接入设计](../specs/2026-11-03-native-device-automation-design.md)。

2026-11-04 更新：最近的实现证据见第 40—51 节；接下来的可执行交付、依赖和验收门槛见第 39、49、50、51 节。Runner 主动退出与恢复事务的新增目标契约见设计第 16 节。本文保留历次实施记录，旧节的“下一步”由较新的完成记录和第 39、49、50、51 节更新，不代表此前全部原语仍待实现。

当前交付与剩余工作：

| 能力 | 当前状态 | 下一项交付 |
| --- | --- | --- |
| 原生元素 | Android ADB / iOS 自研 XCTest 基础和 TypeScript fixture 已实现；iOS 原生确认/取消、系统麦克风允许/拒绝已通过真实混合用例 | Android 受治理宿主与 Debug APK 已构建（第 22 节），继续真实混合流程及输入/旋转/键盘与故障矩阵 |
| 运行生命周期 | CLI/Worker retained owner 已接独立构建、安装及每 attempt 无重装启动，验证 Bridge/VM PID，reset 前 quiesce；child 在正文前独立核验 APK/UID/PID/权限集合（第 27—30 节）；Worker timeline v2 已用编号父 span 归组 managed attempt 阶段（第 31 节） | Android 平台混合验收、完整跨 attempt/故障/残留矩阵及 Worker timeline 故障语义验收（第 31.4 节） |
| 权限 | Android camera/microphone 底层准备、完整声明替换、退出确认、独立观察、恢复与互斥已实现；普通 attempt 已接空声明和 child 单次 readback；父 owner 的 durable 原始值/写前记录与真实宿主崩溃证据已补齐；高层场景未开放 | 冻结声明传递与 child 实际语义核验已接通；补非空高层 retry/skip/取消恢复与真实 prompt/deny/grant 验收，见第 30 节 |
| 指纹 / Face ID | app-local 挑战观察、非终态拒绝序号和单次事件/回调验证已实现（第 32 节）；旧 baselineVerified 已拒绝；Android/iOS 注入均未完成平台验收 | 绑定设备/boot/OS 的录入证据、真实 pending challenge、match/reject/锁定恢复与受保护业务结果；真机由人工完成 |
| 相机固定结果 | app-owned cameraTest 与 demo 已通过 macOS、iOS Simulator 真实 CLI 业务验证（第 33.4 节） | 保留 app-test-seam 标识，Android 移动端、权限/系统相机流程另验 |
| 虚拟镜头 / 图库 | 尚未交付 | preboot cameraSource、实际帧验证；夹具导入/所有权/恢复 |
| 设备恢复 | 只读 inspect、iOS Runner-only `restoreIosRunner` 和 Android app/权限/forward `restoreAndroidApp` 已接入 CLI/API；真实专用 iOS Simulator 已验收 Runner 恢复；Android host recovery 覆盖 crash takeover 与证据归档（第 34—49 节） | Worker/Vitest 统一入口、剩余 Android ADB/readback/归档故障矩阵、真实 AVD inspect → restore → 新 lease → managed attempt、headless/双设备生产恢复。Runner-only restore 不代表整机恢复；Android host tests 不代表 Android supported |
| 发布 | 未达到完整原生测试能力发布条件 | 每平台 20 次独立混合 attempt、真机/并发/故障矩阵、延迟统计 |

第 2—10 节定义工作包与完成标准，第 11—17、19—22 节保存实际实现和验证记录，第 18 节列完整接线顺序。其中 CLI/Worker 准备通道见第 19 节，Android 停止确认与独立观察原语见第 20 节，iOS 真实混合用例及后续缺口见第 21 节，Android 宿主和 owner 总清理期限见第 22 节。第 23 节定义剩余完整目标 N1—N8，第 24—30 节逐项记录后续实现、验证与尚缺交付；Worker owner 时间轴遥测见第 31 节，生物识别观察见第 32 节，启动诊断及当前执行顺序见第 33 节，只读恢复检查和内部 claim 见第 34 节，正常安装 journal 完成与剩余恢复前置证据见第 35 节。表中的“已实现”不替代对应的平台业务验收。

## 1. 执行原则

- 不引入 Appium / WebDriverAgent，不修改已认可的 native/device 用例分工。
- 保留当前工作区已有改动。实施前按实际 HEAD 和 staged/unstaged 差异复核 Scenario、RunSession、CLI、Worker 等接口，不覆盖其他工作。
- 实现采用仓库 `fliwright-tdd`；涉及用例、fixture、timeline、真实 Flutter 验证同时使用 `write-fliwright-tests`。本文不创建不可运行的测试占位文件。
- 先完成平台技术验证，再声明 supported。现有 Simulator 人工功能不直接等同于稳定的 CI 接口。
- 每个工作包有独立验收和失败出口；不为未通过能力增加静默降级。文档阶段不修改依赖或生成实现文档。

## 2. P0：平台技术验证

交付位置：验证结论进入本设计的版本矩阵，临时实验不混入生产运行时。本机设备、端口、token 和编译产物不提交。

| 验证 | 必须证明 | 不通过的处理 |
| --- | --- | --- |
| Android ADB | dump 系统弹窗/选择器、唯一定位、点击、截图；空树/动态页面/输入的真实行为 | 缺失能力标 unverified；必要时将常驻 Runner 提前，不写伪成功 |
| Android 指纹 | 专用 AVD 录入配方，match/未录入 ID reject，app 挑战与结果；锁定及恢复 | 不宣称 ready，不把 finger 命令退出码当作认证成功 |
| iOS Runner | XCTest 查询/点击/输入/截图、SpringBoard/系统选择器、Flutter VM 不被重启 | 修订受支持范围；保留已有 page 流程 |
| iOS 通信 | 主机 loopback broker、Runner 主动取命令、UI 执行上下文、取消/退出 | 固化可复现替代传输设计后才能进入 P1 |
| iOS 生物识别 | 设备定向、录入、match/reject、无界面 CI 和多模拟器 | 只保留人工或显式桌面模式；能力不列 CI supported |
| 权限 | 每平台 camera/photos/microphone 的 prompt/granted/denied 实际准备方式、是否杀 app | 逐项 unsupported；需重启的准备只能 managed-start |
| 相机/图库 | app-owned 固定图片接缝、夹具分发、图库标签及清理；Android 官方 imagefile/videofile 启动来源的实际支持版本 | 不承诺通用运行时 camera.setImage，图库与镜头分别报告 |

退出条件：Android 原生基本流程和 iOS Simulator Runner 基本流程各有最小可复现实验；未知项、工具链版本、前置配置有明确结论。某项扩展失败不阻断其他能力的开发。P0 结果如果改变已提出的接口或范围，先更新设计再实现。

## 3. P1：公共模型、包治理和会话骨架

涉及：core 新增 `native/`、`device/`；新建 `packages/fliwright-native`；调整 architecture/stack 契约、工作区构建和发布配置。

交付：

1. NativePage / NativeLocator / DeviceController、能力状态、规范化节点和快照、错误码。
2. NativeSessionAdapter / DeviceSessionAdapter 契约；实际 Android 与 iOS Adapter 使用同一 Interface，平台工具细节保持内部。
3. core 导出模型；native → core/devices，vitest → native/core，CLI → native 的声明先入 `dependency-rules.json` 和 `framework.json`。新增 Swift/XCTest 工程纳入 stack 及 checker，Android Runner 依赖仅在实际引入阶段登记。
4. 会话 generation、请求 ID、deadline、串行队列、能力协商、lazy 初始化；关闭 native 的普通调用不启动进程。
5. 独立设备租约，明确与 endpoint 租约、Worker owner 的委托和固定获取顺序；先实现跨进程互斥，避免只用进程内锁。

回归：两平台 Adapter 的共同契约；能力未验证/未就绪；scope 唯一匹配；跨设备请求拒绝；同设备串行/跨设备独立；取消和超时；关闭时没有工具启动；包 import 无副作用。使用真实临时子进程验证锁和退出，不能仅检查 mock 调用次数。

退出条件：公共 Interface 可由两平台实现，设备和 app 身份错误在操作前失败，治理检查通过。

## 4. P2A：Android ADB 原生操作

建议文件：native 的 `android/AdbSession.ts`、`AndroidSnapshot.ts`、内部 `ToolExecutor.ts`；源代码遵守所属包规则，避免一个大文件汇集所有平台。

交付：

1. 设备定向的命令执行、路径/远端 shell 参数处理、总预算、取消、唯一 dump 文件及 finally 清理。
2. XML 解析与规范化；资源 ID、label、text、window/package、bounds 和可交互状态。解析器依赖先审核并登记。
3. 查询、严格点击、滑动、返回、整屏截图；明确基础输入的允许范围、清空策略和读回验证。
4. doctor 输出工具可用性、ADB 授权、版本与能力原因；不把授权失败显示成“没有设备”。

回归：多设备 serial 不串用；重复文字；非暴露节点；不完整/超大 XML；旋转/键盘/多窗口；shell 元字符和 Unicode；子进程超时、取消与输出上限；dump 失败不当空树。动态页面上的快照/点击竞态要有可解释诊断。

退出条件：Android 示例应用完成 Flutter → 权限/原生选择器 → Flutter；allow/deny/cancel 分支有真实业务断言。

## 5. P2B：iOS Simulator 自研 XCTest Runner

依赖 P0/P1，可与 P2A 独立实现；计划不要求创建新的 Codex 聊天或委派代理。

交付：

1. 独立 UI Test 工程、只读 doctor、显式 prepare/build、按源码/协议/Xcode/SDK/架构输入缓存构建。
2. loopback broker + Runner 主动连接，有限命令协议及版本握手；日志不泄露凭据；请求大小和身份校验。
3. XCTest 支持上下文中执行 UI 操作，接入 app 与已验证系统 UI 范围，网络等待不阻塞 UI 调度。
4. ready/heartbeat/shutdown/crash 监督，取消时停止属于该 session 的 Runner 和 broker；不重启已运行 Flutter app。
5. 查询、点击、填充、滑动、截图；iOS back 明确 unsupported；基础/中文输入分别验证后声明支持。

回归：协议版本/身份错误；延迟和重复响应；收到响应前断线的点击不重发；读操作重查保留总预算；启动/运行/退出超时；Runner 重启 generation 失效；系统弹窗和多模拟器隔离；XCTest 端真实命令映射测试与 TypeScript 合约测试。

退出条件：iOS Simulator 混合流程可由同一 test 执行，Flutter VM 会话保持，失败和取消没有遗留进程。iOS 真机仍为后续工作。

## 6. P3：Fixture、断言、场景与运行生命周期

涉及：core `Assertion.ts`、`Scenario.ts`、`RunSession.ts`、运行配置；vitest fixture / preset / retry；CLI run / script；Worker 的设备所有权传递。

交付：

1. 注入 `native` / `device`，attempt 生命周期绑定相同操作队列与租约。managed 复用选中设备；attach 要求验证过的设备映射。
2. 提取最小可断言观察 Interface，原生 matcher 自己提供原生快照/值；不使用类型强转继承 Flutter Locator 假设，不启用系统按钮自动 healing。
3. 扩展 device layer 及 schema、序列化、fingerprint、单例冲突检查；设备准备先于 app launch/Bridge，之后维持现有场景顺序。retry 重新准备。
4. CLI `native doctor`、`native snapshot` 与 run/script 配置和 JSON；命令 catalog、帮助、schema 和生成命令 reference 同步。
5. 测试缺必要能力时明确 setup failure；探索模式的 skip 必须显式指定并记录。CLI/fixture/Worker 共用能力判断。

回归：现有场景/无 native 用例不变；混合流程切换无需上下文指令；native expect 的 .not 遇到断线不误通过；未支持 matcher；attach 不执行破坏性准备；scenario 重试不继承污染；配置在 CLI→Vitest 子进程传输后完整；同设备不同 endpoint 不并发。

退出条件：用户认可的语法有类型检查通过的正式示例，示例只使用真实 app 标识和已实现方法。

## 7. P4：生物识别、权限与相机测试环境

交付分为可独立发布的小块：

- Android 指纹：device.biometrics.match/reject，专用 AVD 基线引用和挑战观察；match/reject/未录入/锁定恢复的行为测试。真机自动模拟明确 unsupported。
- iOS 生物识别：仅根据 P0 成功路径实现；CI 与桌面交互能力分开，若依赖宿主机 UI 必须另有宿主机锁。不通过则保留人工流程示例，不伪造 SDK。
- 权限：逐项 permission/state 能力和准备配方；验证 deny 与 prompt 的差别、重启影响和每次 attempt 恢复。不得硬编码不存在的 camera privacy 命令。
- 固定相机结果：给目标 app 定义 cameraTest capability 契约与夹具 ID 分发，成功/取消/错误三分支。测试入口注册、每 attempt 重置，生产入口不包含替代行为。
- Android 固定镜头来源：P0 验证通过则将 imagefile/videofile 接入 device scenario 的 cameraSource，准备和分发夹具，在 emulator boot 前应用配置；核验镜头实际画面与重启/恢复。attach 已启动且来源不符时拒绝，不暗中关闭设备。
- 图库：导入并定位测试图片、记录拥有的资源；确认定向清理能力，否则用专用设备基线恢复。图像不包含用户真实数据。

退出条件：模拟识别事件后有实际 app 业务断言；固定图片与真实硬件覆盖在报告中可辨别；无无法恢复的状态串扰。第三方活体只验证官方测试模式或人工结果。

## 8. P5：证据、报告和稳定性验收

证据基础需随 P2/P3 一起接入，本阶段完成所有消费者与故障覆盖，不推迟错误可诊断性。

交付：

1. native 动作和断言进入已有 timeline，标记 surface/backend/scope/requestId；原生截图/树/前台窗口分别保存，不污染 Flutter snapshot schema。
2. 证据 provider 的预算/取消、manifest、导出、CLI/Cloud/VS Code 显示和离线阅读同步；证据 partial 不覆盖业务错误。
3. 输入日志掩码和证据策略；截图未脱敏的限制可见，按项目配置禁用/遮罩。
4. 故障矩阵：找不到、重复匹配、无节点、工具缺失、驱动故障、Runner 崩溃、断线未知结果、取消、租约丢失、恢复失败。
5. 独立示例 Flutter 应用或经治理批准的现有 demo 扩展，提供原生弹窗/选择器/生物识别/相机接缝；不修改 Exio 业务实现来制造通过。

设备验证：Android Emulator、至少一台授权 Android 真机、iOS Simulator；每项记录实际 OS/SDK/工具链与 pass/unsupported/unverified。各模拟器执行 20 次独立混合 attempt，记录无重试成功率、查询/动作 p50/p95、启动时间、清理结果。两设备并发与同设备争用单独验证。

退出条件：设计验收条目全部有证据；未开放项保留明确限制；已支持能力不存在静默跳过/重发写动作/错误通过。

## 9. P6：后续扩展

1. 以测量结果决定是否替换 Android ADB backend 为常驻 UIAutomator Runner，补 Unicode 输入、查询延迟和可交互性检查；会话显式选择 backend。
2. iOS 真机：签名/Developer Mode、设备身份、USB 通信与监督、安装清理、真实系统 UI 支持；不包含自动通过真实 Face ID/指纹。
3. Android 复杂虚拟相机场景、运行中换帧和媒体流：在 P4 的官方静态启动来源基础上扩展，明确外部资源依赖、无头环境和恢复；验证后才设计通用媒体流 Interface。
4. 原生录制/代码生成：schema、混合时间线、原生选择器、replay 与缺口提示一起实现。首期只消费已手写原生操作，不声称 Flutter recorder 已记录它们。

## 10. 检查与文档闭环

- 每个工作包先运行所涉包的 focused tests 与类型/构建检查；selector、协议、CLI、代码生成变更必须有行为回归。平台 Runner 需各自的编译和设备验证，不能用 TypeScript mock 代替。
- 涉及依赖或边界时更新契约并运行 `node scripts/verify-harness.mjs`；新增依赖后 `pnpm install`。按影响执行 `pnpm build`、`pnpm test`、`pnpm lint`；Dart 改动执行对应 analyze/test 和 format。
- 使用真实 Fliwright 用例的验证文件放在示例/目标项目 `.fliwright/tests/*.test.ts`，可复用环境必须是命名 TestScenario。
- E2E 接受本机运行时配置，不提交 VM URL、设备 serial、签名凭据和 Runner 产物。没有可用设备的检查记录为未验证，不能声称设备测试通过。
- 稳定实现后运行 `/document-features` 更新受影响包和跨流程文档，并生成 capability catalog；新增 CLI command reference 使用仓库生成器。本文保留设计上下文并标注实际完成状态。

首个可交付切片为 P0 → P1 → P2A → P3 的 Android 原生混合流程；iOS Simulator 在 P2B/P3 后交付；生物识别与相机分别通过 P4 验收，不等待后续真机 iOS 或完整录制功能。

## 11. 实际进度与新增实施约束

以下是当前源码和平台实验的事实，不能将基础包可调用解释为完整集成已完成。

| 阶段 | 当前进度 | 尚缺的关键验收 |
| --- | --- | --- |
| P0 | Android Settings 查询/点击/返回/截图；iOS Settings 唯一 ID 查询/点击/页面结果查询/截图与正常退出 | Flutter 混合流程、系统权限/选择器、输入、旋转/键盘、硬件能力探测 |
| P1 | core 模型、strict locator、原生断言、串行/取消/总预算；native 包、设备租约和隔离；配置 schema/跨进程序列化；Swift 工程治理；fixture/CLI 依赖接入及当前 VM PID 的设备归属验证 | 设备基线准备与租约丢失后的完整 mixed-flow 故障验收 |
| P2A | ADB 定向执行、完整 XML 解析、安全输入范围、owned dump 清理重试和失败隔离；只读 doctor | 真机、混合流程，以及实际输入验证 |
| P2B | 自研 XCTest 工程、认证 broker、过滤查询、点击/截图；显式 prepare 和构建缓存、监督退出；CLI prepare/doctor/snapshot | Swift 端行为回归、系统 UI、实际填充/滑动验收 |
| P3 | native/device fixtures、原生 expect overload、task 设备所有权与 attempt Adapter 分离；真实 worker 生命周期回归；CLI 原生命令与共享配置；device layer 模型/schema/单例冲突/fingerprint、managed 启动前和每 attempt 的 requiredCapabilities 检查 | 破坏性 device baseline 准备及 retry 重启；真实设备的混合 fixture 验收 |
| P4 | Android 指纹事件实现带显式基线前置条件；相机固定结果 capability/controller/fixture 与真实 macOS CLI 业务示例（第 14 节） | 尚无生物识别业务验证；权限、图库、虚拟镜头及移动端相机 UI 待实现/验证；iOS 生物识别保持 unverified |
| P5 | 基础单元/协议/子进程测试与平台实验；原生证据 provider、surface 路由、独立采集预算、原始错误保留；VS Code/Cloud 区分原生证据，CLI 离线导出保留 schema/metadata；相机接缝正式示例 | 移动端混合原生示例、设备矩阵、20 次 attempt 和跨进程并发验收 |

### 11.1 租约与 retry 的具体实现出口

当前 fixture 已区分 task 设备所有权与 attempt Adapter。attach task 先取得设备租约，再取得 endpoint 租约，直到所有 retry 和最终证据完成才释放；managed CLI 则由父进程在 app 启动前取得租约，再通过专用环境变量将 grant 传给测试子进程。attempt 失败后重建 Adapter/generation，但保留 task 的设备所有权。设备基线的重新准备仍依赖尚未完成的 device scenario。不能先释放设备、保留 endpoint，再在 retry 中反向抢设备，否则另一个“设备 → endpoint”的等待者会形成死锁。

Runner、fixture 跨 Vitest module graph 的资源句柄沿用 Symbol.for task 状态。准备失败、aroundEach skip、timeout、retry、最终 teardown 和进程取消分别需要真实 worker 回归；正常路径与 fallback 清理均须幂等。启动等待不占用测试 body 的 timeout；启动与清理仍各有总预算。动态 skip 的 handoff 必须等待 fixture 和 runner 两阶段完成以及所有权释放，设备清理失败清除 pending skip 并报告 failed；Adapter/owner 两个错误分别保留。

Cloud Worker supervisor 持有 native owner，executor 通过一次有界 IPC 取得当前 checkout/project 的委托；凭据不写入 job journal、timeline 或报告。supervisor 在 executor 退出后仍保留设备独占，直到 owned process group 停止且最终 reset 完成。子 task 的 claim 串行化，父进程不能在活跃 claim 存在时删除宿主锁；代次/活性验证失败取消操作并停止 owned Adapter。真实子进程回归覆盖 grant 传递、独立 owner 排斥及 IPC 不落盘。

### 11.2 设备与 VM 的可信绑定

`AppInstance.info().id` 是 app-owned 标识，不保证等于 Android package/iOS bundle ID。workspace 的 device/app/VM 元数据也可能过期，不能只凭字符串相等认定绑定完成。应取得当前 VM 的进程身份，再由平台确认该进程属于选定设备上的目标 app；managed owner 的代次/租约同时校验。attach 不能完成独立确认时在 setup 失败，不允许“显式写了 deviceId”替代验证。加入旧 runtime config、相同端口复用和两台设备同名 app 的反例。

### 11.3 证据路由与死锁回归

RunSession 在 action 完成之前触发截图采集。原生 provider 若再调用同一 NativeRuntime 的排队 `screenshot()`，会等待当前 action 释放队列，造成自锁。实现需将 surface/query/generation 传递到采集请求，使用当前操作内的受控 Adapter 采集入口；预算独立于已失败的动作，但仍受 finalization 上限限制。以真实 RunSession + 假 Adapter 的组合测试证明 full/start、standard/finish 和 failure 三条路径没有递归记录或死锁，再验证真实设备。

当前已使用 RunSession surface provider 注册和 Adapter 只读采集实现上述分流。Flutter provider 可在 native 操作之后随 page fixture 注册，不修改已经固定的 recording policy。动作 body 与采集使用独立预算；证据超时会取消其上下文并阻止继续复用可能有未完成读取的原生会话。原生断言失败同样保存截图/树；runner checkpoint 继承最近失败操作的 surface。原生树使用独立 wrapper 和 artifact metadata，不套用 Flutter snapshot schema。共享 endpoint 在原生证据完成前阻止并发 Flutter action。

### 11.4 技术验证记录与支持声明

- Android：Emulator 36.6.11，Android 17 beta image；Settings 原生导航和 PNG 截图已执行。尚不构成 Flutter 混合流程或正式支持矩阵验收。
- iOS：Xcode 26.6（17F113）、iOS 26.5 Simulator；主机 loopback 与 XCTest async UI 上下文已连通。`General` 文字同时匹配父子节点；观察到的稳定 ID `com.apple.settings.general` 唯一匹配，点击后查询得到 About 页面节点。证明 strict 模式必须保留，不能自动选择第一个。
- hostless Runner 的 `UIScreen.bounds` 曾报告与实际屏幕不符的 320×480；已改用 XCUIScreen 截图像素和 scale，实际得到 402×874 points、scale 3。仍需旋转/多窗口验收。
- 实际 CLI 验证：iOS `native doctor --strict --json` 在只读环境检查后返回 ready，Runner 能力保持未握手；`native snapshot` 启动 Runner、按 General 稳定 ID 返回唯一节点及 402×874 points/scale 3，并正常清理退出。该结果仍不代替 Flutter 混合用例验收。
- 全树逐属性遍历超过过一次 30 秒预算；过滤查询在已观测页面上可完成。因此定位采用查询下推且主机复核 scope/matches；完整树仍可能超时，证据不能依赖无界限 dump。
- 指纹命令、Face ID、权限、camera/media 的支持声明必须等待各自的业务结果验证；不能从“工具命令存在”或“单测通过”推断设备支持。

### 11.5 前序基础切片检查记录

以下记录来自 managed/Worker 基础切片；后续相机与场景改动的最终检查见第 14 节，不将这些计数当作最新总数。

- 本轮 managed/Worker 委托改动后的全仓 `pnpm build`、`pnpm lint`、`node scripts/verify-harness.mjs` 和 `git diff --check` 均通过。最后 skip 清理修复后再次构建 Vitest 包并运行全量测试通过。
- 最新 core 全量 104 个文件、1,023 项通过；CLI 全量 36 个文件、311 项通过。native 最终全量 65 项通过。Vitest 最终全量 84 项通过、3 项预期失败；包含 body/aroundEach skip、Adapter 单独失败和 Adapter/owner 双重失败的真实 worker 回归。
- Worker 全量 21 个文件、81 项通过；随后新增真实 supervisor/child ownership IPC 回归通过。CLI managed ownership/launch 顺序、Worker 准备失败阻止启动、最终 reset 持有和失败隔离均有独立测试。
- 先前高负载全量失败保留：core 曾 1,020 项通过、2 项计时失败；Vitest 曾 70 项通过、14 项失败，低并发曾剩 1 个 child timeout。主机 load 曾约 73、swap 约 28 GB；没有提高 timeout 或删除失败测试。后续本轮 core/CLI/Vitest 低并发结果如上，不将先前超时解释为硬件支持证据。
- iOS prepare 已在 Xcode 26.6 / SDK build 23F81a 实际构建并二次命中缓存；专用 Simulator 和 Android Emulator 已关闭，没有本轮拥有的常驻 Runner。
- 已使用 `document-features` 生成器刷新实现参考和 native session pipeline，并生成 capabilities；Harness、Swift 工程治理回归和 CLI docs check 均通过（70 guides / 101 parsed examples，source/plugin 一致）。生成文档只描述已实现接口，不把尚未实现的设备准备或未验证硬件写成已支持。

## 12. 剩余实施的具体契约

### 12.1 设备场景的两个执行阶段

模型/schema 和只读 requiredCapabilities 切片已经实现，细节见第 13 节。以下涉及设备 mutation、分发和 relaunch 的条目仍是剩余目标。

1. 解析命名场景继承，device layer 是单例资源；schema、跨进程 JSON 与 fingerprint 同时更新。字段使用可移植的 baseline/fixture ID，不携带主机路径、设备 serial 或凭据。
2. 先由 managed owner 解析能力、分发所需主机夹具，验证专用设备 baseline。需要 cameraSource 的准备必须提前到 emulator boot 前；当前仅在线设备的会话 API 不能承担该步骤。
3. 在 app 启动/Bridge 连接前应用会杀进程的权限状态。attach 只能验证现有状态或执行明确证明不影响 app 的准备；无法保证时 fail setup。
4. app 启动后校验 VM PID 与设备目标进程，再按 mocks → storage → auth → state → app → navigation 执行已有阶段。禁止在 ScenarioCoordinator 连接 Bridge 后偷偷补做设备重置。
5. 每次 retry 需恢复同一声明基线。managed CLI/Worker 的每 attempt stop/relaunch/verify 已实现，见第 16 节；仍需在该边界接入设备准备、readback 与恢复，再开放会杀 app 的 mutation 场景。无法恢复时 setup failure，不能仅凭上一 attempt 的完成标记继续。
6. 报告保留声明 fingerprint、设备摘要、准备代次和各项验证结果；不能把“已发送命令”当作准备生效。

### 12.2 权限与支持探测

权限以 platform/service/state 分项实现，首先验证 Android camera、microphone 运行时权限和 iOS 工具明确列出的 privacy 服务。Android prompt、denied、永久拒绝不是同一状态；必须核验用户标志和实际弹窗。iOS 当前工具帮助没有 camera 服务，不添加虚构命令。每个组合同时有准备、readback、app 生效及 retry 恢复证据后才声明 supported。

### 12.3 相机接缝与夹具生命周期

本小节的固定结果接缝已经实现并完成 macOS 业务验证，见第 14 节；移动端权限/镜头来源仍需独立验收。

app-owned `cameraTest` 在测试入口注册 `reset`、`enqueueResult` 和消费状态查询；image/cancel/error 是不同结果，每次相机调用最多消费一项。fixtureId 必须映射到 app 可读资源且校验存在/格式；不把主机绝对路径传给移动 app。attempt 开始 reset，结束检查剩余队列并清理，retry 使用新代次；生产入口不注册。

固定结果专项用例分别断言预览/上传、取消保持业务状态、错误提示、重拍消费顺序和跨 attempt 无残留。报告标记 `app-test-seam`；permission UI、camera UI、虚拟镜头和真机镜头分别统计。Android imagefile/videofile 必须经真实相机画面验证，再接入 boot 配方；iOS Simulator 无通用 setImage 承诺。

### 12.4 生物识别和正式验收

Android baseline 需包含已录入/未录入 ID、挑战 pending 观察和锁定恢复配方，match/reject 返回后仍断言 app 业务结果。iOS headless 接口维持 unverified，真机注入维持 unsupported；人工流程使用现有 `flow.manual` 并以业务结果恢复。普通登录场景继续使用 app-owned auth seed。

正式示例须可移植且消费公开 API；补齐 iOS/Android 工程的治理声明后再使用 demo。两平台分别覆盖系统 UI allow/deny/cancel、严格匹配、旋转/键盘、失联/取消、同设备两进程及两设备并发。20 次独立 attempt 不使用 retry 掩盖失败，记录无重试成功率、p50/p95 查询/动作耗时、启动和清理；真机未连接的项目保留未验证。

## 13. 设备场景第一实施切片

已交付的行为：

- `ScenarioDeviceLayer` 包含 requiredCapabilities、baseline、biometricBaseline、permissions、media、cameraSource。严格配置拒绝未知字段、主机路径夹具、重复权限和空 cameraSource；整个 device layer 是继承单例。JSON 跨进程传输保留声明和 fingerprint。
- `prepareScenarioDevice()` 对 requiredCapabilities 同时检查 supported 与 ready；unsupported、unverified、缺失及未就绪均为 setup failure。准备前后核验 identity。准备凭据绑定完整场景 fingerprint、mode、attempt 与 Adapter generation，单次消费且不支持 JSON 序列化复用；消费时再次核验身份与能力。
- Vitest 通过 worker-only Symbol 元数据识别显式场景，defaultScenario 和 `extendFliwrightTest()` 路径一致；初次检查在 Bridge/endpoint 连接之前，retry 使用新 attempt 与 Adapter 重新检查。应用阶段仍保持原有 layers 顺序，先消费准备凭据再执行 Bridge 操作。
- setup 的原生能力读取共享队列、截止时间、取消和租约检查，但在 timeline 初始化前不启动 RunSession operation；防止过早冻结 recorder/policy/endpoint 配置。应用阶段的复核是正常记录操作。成功场景节点包含设备摘要、generation、要求能力和声明 fingerprint，不包含原始设备 ID。
- managed CLI 根据显式选择或项目 defaultScenario，在 launch 前取得 owner、检查只读能力、关闭临时 Adapter 后才委托子进程。Worker 按 request 的 scenario 选择执行；direct run 传入 null，不能误用仓库默认场景。父进程检查结果不作为子 attempt 的旧凭据。
- permissions、媒体、镜头、生物识别 baseline 和通用 baseline 尚未获得可恢复的启动生命周期，运行时提前拒绝。它们没有被静默跳过。app-only 的 `scenario.apply/reset` 同样在连接 Bridge 前拒绝 device layer。

对应测试包括 core `ScenarioDevicePreparation.test.ts` / `NativeRuntime.test.ts`、真实 worker `device-scenarios.test.ts`、CLI managed preparation/launch 和 Worker scenario selection 回归。需要继续实现的工作仍是第 12 节的 mutation/relaunch 及平台业务验收；相机接缝实施见第 14 节。

## 14. 相机固定结果接缝与真实业务验证

已交付：

- bridge 导出 `FliwrightCameraTestCapability` 和 image/cancel/error 结果类型；测试入口显式注册 app-owned loader，release 模式拒绝启用。capability 不自动替换真实相机插件。
- `reset/enqueueResult/getStatus` 与 app 侧 `capture(generation: ...)` 均校验代次。旧 capture、异步 loader 和旧 teardown 不得消费或清空新 attempt 队列。每次 capture 消费一项，空队列失败；每代最多 32 项。图片必须是可解码 PNG/JPEG，loader 限时 5 秒、字节最多 10 MB、解码后最多 16 MP。
- core `CameraTestController` 校验结果与状态协议，通过 app capability 通道执行；请求默认 5 秒。写结果未知后拒绝新 enqueue，不重发。幂等 dispose 同时检查残留和清理，保留原始业务/清理错误；过期的清理 signal 阻止后续 reset 请求。
- Vitest 惰性 `cameraTest` fixture 每 attempt 新建代次，清理纳入 attempt finalization 预算。未消费结果使 attempt 失败，包含 body skip；清除 pending skip 投影以确保 endpoint 释放，后续 peer 可执行。真实 worker 覆盖 retry、body failure、skip 和残留。
- timeline 的操作标记 `surface: flutter`、`coverage: app-test-seam`、`testSeam: camera`；消费节点记录 pending/consumed/enqueued。报告不包含图片字节或主机路径。
- `examples/form_demo/lib/camera_fixture_main.dart` 为独立测试入口，使用 bundled portrait/retake 图片和公开 bridge API。`cameraDemo.reset` 作为 app-owned 场景准备；上传只调用本地接收器，不声称验证网络后端。
- `e2e/.fliwright/tests/camera.test.ts` 和命名 `camera.empty` 场景覆盖预览、取消保留原图、错误提示、重拍替换及本地上传；从治理过的 E2E 包执行，不给 demo 新增 Node 依赖。

真实 CLI 验证：Flutter 3.47.8 / macOS，启动独立 camera 入口后，通过 CLI `run --test .fliwright/tests/camera.test.ts --scenario camera.empty --json --deadline 90000` 执行成功；1 项测试、约 4.7 秒 run / 3.55 秒 test、7 张截图，消费 4 项且 pending=0，evidence=complete。本机临时证据目录为 `/tmp/fliwright-camera-seam-acceptance/run-2026-11-03T06-24-43-720Z`；它是本机验收记录，不是跨机器可分发的仓库产物。已停止本轮 app/Flutter 进程，未保留 VM URL、设备配置或 Flutter/Xcode 自动迁移文件。

该通过结果仅证明 app-test-seam。Android/iOS 权限 UI、真实拍摄 UI、模拟器镜头来源、物理镜头和网络上传均未由此验收。仍需按第 12 节顺序补齐：managed 每 attempt prepare/relaunch/rebind → 权限基线/readback/恢复 → 移动端混合 UI 用例 → 生物识别专项与虚拟相机 → 两设备/20 次独立 attempt 及延迟统计。首版支持声明按每项证据更新，不把后续阶段统称已实现。

最终检查：全仓 `pnpm build` / `pnpm lint` 通过；core 106 个文件、1,067 项通过；Vitest 20 个文件、86 项通过和 3 项预期失败；bridge 211 项通过、2 项跳过，相机源码/测试专项 analyze 无问题；demo 相机 widget 1 项通过。生成器刷新 611 份实现参考（包含 camera pipeline）和 17 份 capability 文件；Harness、CLI 文档检查（70 guides / 101 parsed examples）及 `git diff --check` 通过。平台基础测试的较早记录保留在第 11 节，这些静态/单元检查不替代移动端硬件验收。

## 15. 后续交付顺序与开放条件

| 工作包 | 依赖与具体交付 | 开放条件 |
| --- | --- | --- |
| A：每 attempt 设备准备 | stop/relaunch/verify 控制通道与新 endpoint/VM PID rebind 已实现（第 16 节）；继续接入 owner 下的设备准备/readback/恢复；retry 仍持有相同设备 owner | 首次、retry、取消及准备失败均有真实子进程回归；app 被终止后不能沿用旧 endpoint；attach 拒绝破坏性准备；移动端真实重启链路仍待验收 |
| B：权限 | Android camera/microphone 底层原语与 owner mutex 已实现（第 17 节）；继续在 A 中接线并验收，再做 iOS 当前工具真实支持的服务 | prompt/denied/granted 分别有准备和恢复证据；每次 attempt 可还原；不开放工具未提供的服务 |
| C：移动端混合示例 | 提供受治理的 Android/iOS demo 工程和 app-owned 场景；同一测试从 Flutter 打开真实系统流程，再返回业务 UI | allow/deny/cancel 有业务断言；严格定位、旋转、键盘、系统覆盖及原生失败证据分别验收；不借相机接缝代替系统 UI |
| D：生物识别专项 | Android 专用 AVD 的录入/未录入基线、pending 挑战、match/reject 和锁定恢复；iOS 仅做公开、可定向的自动化接口验证 | 必须验证实际业务成功/失败；iOS headless 未通过保持 unverified；真机事件注入保持 unsupported，人工通过 flow.manual 恢复业务检查 |
| E：虚拟相机与图库 | 在 preboot 接入 Android 官方 imagefile/videofile 启动配置并验证实际画面；图库只导入自有夹具并记录清理归属 | 指定图片实际进入相机管线；方向/分辨率/headless 验证；恢复失败隔离设备；iOS 不承诺任意镜头输入 |
| F：发布验收 | C/D/E 各按已开放能力执行故障矩阵、授权 Android 真机、同设备争用、两设备并发与 20 次独立混合 attempt | 发布报告列 OS/SDK/Xcode/Emulator 版本、无重试成功率、查询/动作 p50/p95、启动/清理结果；缺设备的条目保留未验证 |

相机 app-test-seam 已可独立使用；原生操作基础已可做受控验证，完整原生测试能力继续实施。当前没有“一条命令自动通过真实 Face ID/指纹”或“任意平台注入相机画面”的支持承诺。业务测试应明确选择固定结果、模拟器事件、真实系统 UI 或真实硬件覆盖，并在同一报告中保留各自证据。

## 16. 每 attempt 的 managed app 生命周期

已交付代码与协议：

- core `ManagedAppLifecycle` 仅绑定 127.0.0.1，使用独立 bearer token、session/protocol 和 32 KB 消息上限；单次 attempt key 不重发，场景 name/fingerprint 成对校验，并发、重复和失效会话拒绝。默认准备预算 120 秒、关闭等待 15 秒，均有上限；客户端断开或取消传播到准备信号。超时后保留未完成工作，关闭不能把未确认结果报为成功。
- CLI `startManagedAppControl` 与 Worker 共用解析/校验：有场景时先核验 supervisor 配置的完整 fingerprint，再 stop → launch/verify。只有私有环境变量携带控制凭据；无显式 supervisor 时清除继承值，凭据不进入共享配置、job journal、timeline 或报告。设备 mutation 仍在 stop 之前拒绝。
- native-enabled managed run 的每个 attempt 都重启 app，包括没有场景、只有 app layer 的用例和 retry。只给 device layer 重启会使后续普通用例沿用已关闭的首次 URL；该反例已进入真实 Vitest worker 回归。
- Vitest 持有 task 设备 owner，先清理前一 attempt 的 Adapter/driver，仅释放旧 endpoint，再请求重启。当前 attempt 使用独立 driver 和新 endpoint，重新验证 VM PID；保留 owner 直到所有 retry、诊断与清理结束。device 场景报告附带 managed app generation。
- driver 在被动诊断之后、有界 finalization 内关闭，skip 同样执行。关闭失败/超时记录原始错误、使 attempt failed、清除 pending skip 并 quarantine；不能在旧连接清理未知时继续 retry 或启动 peer。
- CLI 与 Worker 均为每次 launch 新建 daemon/transport。owned Flutter 进程先 SIGTERM，必要时 SIGKILL，再确认 exit；未确认退出时失败，不把 kill 请求成功当作退出完成。控制通道先关闭，随后终止 launcher，最后才归还 native owner。

自动化证据：core 控制通道覆盖真实 Node 子进程、无场景请求、无效成对身份、并发、重复、断开/超时及未完成准备的关闭；CLI 覆盖场景校验先于 stop、取消不再 launch，以及真实 runner 的私有环境传递/报告无凭据；Vitest worker 覆盖显式设备场景 retry → 普通 peer → body skip → peer（5 个新 endpoint，4 次 task owner 获取/释放），以及连接清理失败后隔离且不再 launch；Worker 覆盖每次重建 process/source，旧进程退出后才允许新 launch，且 supervisor 仍持有设备。

移动端验收尝试：使用独立临时 AVD 和临时 Flutter Android scaffold，Android Emulator 36.6.11.0、现有 android-37.2-beta3 arm64 image；headless 和隐藏窗口且显式 `-accel on` 均停在 device offline。日志报告 `hvf is not enabled` 与 `mprotect failed: Permission denied`。因此本轮没有执行真实移动端 managed 测试，也没有记录为 passed；已确认 owned emulator 退出并移除临时 AVD/scaffold，未改个人 AVD。环境结果保存在本机 `/tmp/fliwright-native-lifecycle-platform-check.json`。该阻塞不改变既有原生查询能力证据，也不能用单元/worker 测试代替移动端重启验收。

剩余最小切片：先恢复可启动的专用平台环境，验证真实 Flutter endpoint/PID 的多 attempt 更换和状态隔离；随后在同一 owner 内增加设备 preparation 接口。不得在 supervisor 中重新取得已经委托给 child 的同一设备租约。权限准备必须在 stop 确认后、launch 前执行，具备 capability 探测、readback、取消后恢复和 quarantine 失败出口；实现并验收这些条件前，`permissions` 等声明继续提前拒绝。Android camera/microphone 的 prompt/granted/denied 分别建立真实业务断言，再推进其他平台与硬件矩阵。

本切片检查：全仓 `pnpm build` / `pnpm lint` 通过；core 单并发全量 107 个文件、1,073 项通过；Vitest 全量 21 个文件、88 项通过和 3 项预期失败；Worker 单并发全量 21 个文件、84 项通过；native 全量 65 项、TDD 全量 132 项通过；CLI 原生/managed 专项 5 个文件、27 项通过。较早并行运行的录制、doctor 和 Worker 诊断时序失败已由独立或单并发复查通过；没有提高 timeout。当前工作区 CLI 单并发全量为 339 项通过、1 项 init-agent JavaScript Vitest 配置保留测试失败，该非原生功能正在其他改动中，未在本切片修改。实现参考已刷新为 613 份（16 个包，含 managed app pipeline），capability 文件 17 份；Harness、CLI 文档检查与 `git diff --check` 通过。

## 17. Android 权限准备原语与跨进程操作互斥

此阶段交付底层准备能力，尚未开放高层权限声明。新增 `packages/fliwright-native/src/android/AndroidPermissionPreparation.ts`，由 `NativeDeviceSession.preparePermissions` 在 retained owner 内调用。`ScenarioDevicePreparation` 与 `device.permissions.set` 仍拒绝权限 mutation；没有从 mock/单元结果提升为平台 supported。

| 边界 | 已实现行为 | 验收限制 |
| --- | --- | --- |
| 设备与应用 | 显式 Android Emulator、主用户 0、targetSdk ≥ 23、无共享 UID；配置使用 schema 克隆快照，调用方后续修改不能重定向设备/包/tool path | 物理 Android、iOS、attach 均不走此 mutation 接口 |
| 停止前置条件 | 目标 package 的 User 0 必须 force-stopped；按整个 UID 检查进程表，可识别不以包名开头的自定义进程 | 不在准备函数内擅自杀 app；managed launcher 必须先确认 stop |
| 原始状态 | 严格选择目标 package/User 0，读取 grant、USER_SET/USER_FIXED 与允许的 user-sensitive flags；整批校验后才写 | 固定/策略/一次性/未知 flags、未安装/隐藏用户拒绝；不猜测系统格式 |
| app-op | 写前/写后均要求默认 package app-op，允许 `No operations.` 或对应的 default 输出 | 自定义与 UID-wide mode 拒绝，不重置 app-op；现代 Android 默认策略是否满足须实机验证 |
| 目标状态 | granted：授予并清除两项 mutable flags；prompt：撤销并清除；denied：撤销、USER_SET=true、USER_FIXED=false | denied 是曾拒绝，未实现“不再询问”；grant/flags 不等于 app 实际获得镜头访问 |
| 替换与恢复 | 首次捕获每项原始状态；每次请求替换前次声明，省略项恢复原始值；owner dispose 用独立预算恢复/readback 后归还设备 | 高层每 attempt 无声明时的调用尚未接线；恢复必须处于 app 已停止状态 |
| 写结果未知 | 派发前设置 unknown，完整 readback 后才清除；失败/取消后不重发、不盲目 restore，隔离设备 | 未确认退出的工具工作保留，不能用调用方收到取消作为已停止证据 |

`DeviceLease.runExclusive` 在设备锁目录提供跨进程 operation mutex，parent preparation 和 delegated Adapter 请求共用它，不重新获取 child claim。整批准备/恢复持锁；Adapter 的 capabilities/snapshot/execute/screenshot 及 owner 的 VM 进程绑定读取均进入互斥。VM 绑定等待计入总预算；owner 关闭会取消并等待其底层读取。父租约释放遇到活跃操作时保留锁/quarantine。操作与锁清理、初始化与 Adapter 清理、owner 清理与隔离/释放的多重失败均保留，不能让 finally 的异常抹掉原错。

新增证据：`tests/android/AndroidPermissionPreparation.test.ts` 覆盖三种状态、完整声明替换、恢复、UID/force-stop、未知 flags/app-op 和未知写；`tests/DeviceLeaseOperation.test.ts` 覆盖取消等待、未完成释放及错误保留；`tests/DeviceLeaseDelegation.test.ts` 用真实 Node child 持有 operation mutex，证明 supervisor 不越过 child 平台操作。`tests/NativeDeviceSession.test.ts` 覆盖 owner 下准备、配置快照、取消后保留底层工作、隔离、Adapter/VM 读取互斥和多重清理错误；`tests/NativeSession.test.ts` 覆盖初始化错误与清理/释放错误并存。

平台验证本轮再次尝试了全新临时 Pixel AVD，并显式启用 `-feature HVF`（ARM 上 `-accel` 不控制该路径），仍为 `hvf is not enabled` / `mprotect failed: Permission denied`、设备 offline。已确认 owned Emulator 退出并删除临时 AVD/scaffold；未修改个人 AVD、签名或主机安全设置。本机记录 `/tmp/fliwright-native-permission-platform-check.json` 不作为仓库设备配置提交。没有真实权限业务通过记录；仍需可启动的专用 Emulator 才能决定 app-op 范围和发布状态。

本切片验证：native 单并发全量 15 个文件、79 项通过；CLI 原生/managed 专项 5 个文件、27 项通过；Worker 原生所有权/IPC/launch/timeline 专项 4 个文件、24 项通过；Vitest 原生/device scenario/managed 专项 4 个文件、5 项通过。全仓 `pnpm build`、`pnpm lint`、Harness、CLI 文档检查与 `git diff --check` 通过。生成式实现参考为 614 份（16 包），新增权限准备 pipeline；capability 文件 17 份。完整移动端权限/重启验收仍未通过，不计入这些测试结果。

## 18. 后续接线与完整验收任务

按以下顺序继续，每项独立收集证据；未通过项保留明确状态，不能用相机 app 接缝或原生命令返回替代验收。

1. **恢复平台环境并记录原始格式。** 专用 AVD 启动后安装受治理 demo，保存脱敏的目标包权限/flags、UID、ps、app-op 输出和工具版本。先验证 pm 修改是否引入 UID app-op，再决定是否扩展可恢复策略；若需要，先补失败回归和设计，不能放松为接受任意输出。iOS 另做 Simulator 混合流程，不从 Android 推断支持。
2. **CLI 接入完整 attempt 准备。** `ManagedNativeRun` 持有的 owner 暴露受控准备入口，`ManagedAppRun` 在校验 name/fingerprint、确认 stop 之后调用，再 launch/verify。使用 supervisor 重新解析的完整场景，不接受 child 提交任意 pm 指令或 host path。每个 attempt 都执行替换/恢复，包括无场景、app-only、skip 后 peer 与 retry；首次初始 launch 和最终 dispose 的 stop 顺序同样覆盖。
3. **Worker 接入 supervisor 执行。** 当前权限 owner 在 `WorkerNativeOwnership`，重启控制位于 executor；增加有界、白名单且绑定当前任务/project/device/attempt/fingerprint 的 IPC 请求与取消。supervisor 执行准备并保留未完成工作，不把 owner 移到 executor、不重新获取已委托 claim。拒绝重复/并发/旧代次；executor 消失后仍等退出与最终 reset。超时、断开和未知写统一 fence/quarantine，保留原始错误。
4. **复核后再开放场景权限。** 扩展 core 只读观察/报告，使 child 在新 endpoint、VM PID 和 Adapter generation 下独立复核 grants/flags 与能力 readiness，再创建单次 live receipt。supervisor 的 JSON 仅是诊断，不能当可信凭据复用。只有相应平台/服务/状态通过业务验收后，才放开 `ScenarioDevicePreparation` 的对应字段。会杀 app 的运行中 `device.permissions.set` 继续拒绝或明确要求新 managed attempt，不能伪装成普通 action。
5. **真实混合权限流程。** demo 显式声明 camera/microphone 原生权限和稳定标识，测试从 Flutter 触发请求，使用 native 操作真实 allow/deny/cancel，再断言 Flutter 业务结果。分别覆盖 prompt、已有拒绝、已授予、retry、取消、普通 peer、恢复失败、命令断线和错误设备；每次结束证明 baseline 恢复。iOS 只开放本机 privacy help 实际列出的服务，camera 不编造命令。
6. **指纹与 Face ID 专项。** 建立版本化的专用录入/未录入 baseline；app 提供仅观察的 pending challenge 信号，不设置认证成功。Android 只向正确设备注入已录入/未录入 ID，match/reject/取消/锁定与恢复各断言业务结果。iOS 先证明公开接口的设备定向、录入、事件、headless 和多模拟器隔离，再开放能力；未通过保持 unverified。物理设备事件注入 unsupported，以显式 `flow.manual` 等待真人并继续业务断言。
7. **图库与虚拟相机独立交付。** media fixture 从可移植名字解析到本次分发资源，记录所有权、可见标签和定向清理；不能清空用户图库。Android cameraSource 在 Emulator boot 前应用并确认实际读到指定图片/视频，覆盖方向、分辨率、前后镜头与 headless；attach 来源不符则拒绝。iOS 图库导入与镜头输入分别报告。现有 cameraTest 继续标注 app-test-seam。
8. **发布与文档闭环。** Android/iOS 各运行 20 次独立混合 attempt，保留每次原始结果，不依赖重试计算通过率；记录 OS/SDK/Xcode/Emulator/Adapter 版本、查询/动作 p50/p95、stop/launch/restore 耗时及残留检查。另验授权 Android 真机、同设备两个进程争用和两设备并发、系统覆盖/旋转/键盘与证据离线查看。更新实际支持矩阵、CLI schema/help/Skills、生成式实现参考和发布清单；无 native 用例不得启动原生工具。

最终交付按能力逐项发布，不以整个 native 包存在作为验收。当前可复用的是原生会话基础和 app 相机固定结果；权限场景、生物识别业务及镜头管线仍有上述未完成任务。

## 19. Retained owner 的每 attempt 准备与 Worker IPC

已实现第 18 节步骤 2/3 的准备通道，不开放尚未验收的权限 mutation：

- `ManagedNativeRun.prepareAttempt` 校验严格 attempt identity、成对场景 name/fingerprint 和 owner 获取时的场景配置；重复、并发、超限、关闭及准备失败后均拒绝。每个 device scenario 创建新的准备 Adapter，复查 requiredCapabilities，并在 launch 前关闭。无场景或仅 app 场景仍经过回调但不创建准备 Adapter；不回落 defaultScenario。初始 prelaunch 检查继续保留。
- `ManagedAppRun` 顺序变为验证场景 → stop 确认 → retained owner prepareAttempt → launch/verify，取消/准备失败不继续 launch。CLI 复用已有 owner；不重新获取设备或 child claim。child 在新 endpoint/VM PID 下的能力检查与单次 live receipt 仍独立执行，supervisor 的成功回复不替代它。
- Worker executor 通过 `requestNativePreparation` 发送 project、attemptKey、可选场景 name/fingerprint；supervisor 的 `NativePreparationIpc` 仅接受当前 checkout project、有限字段和长度，拒绝平台命令。默认 120 秒预算，executor 留 1 秒接收失败回复；取消发送单独 id，超时或取消不重发写请求。仅匹配且成功的 reply 可继续 launch；未匹配 reply 忽略。
- supervisor 的 `WorkerNativeOwnership` 验证已持有当前 project 的 owner，执行准备。IPC 取消/断开先取消 signal、可提前回复失败，但 active 状态保留到真实工作结束；失败后通道不可继续用。最终 reset 先取消并等待准备，15 秒仍未结束则不执行 reset、以 cleanupConfirmed=false 关闭 owner、阻止后续复用。reset 与 owner release 双重失败保留；无 native 的 reset 流程继续可用。
- 最终 reset 对尚未完成的 owner acquisition 同样取消并限制等待，避免 executor 已退出而 supervisor 永久等待租约。迟到的设备授权以 cleanupConfirmed=false 清理，不采纳为新 owner；超时后不允许再次 acquire。回归包含忽略取消的 acquisition，不依赖工具正常响应才能证明围栏。
- Adapter/Runner 初始化纳入 operation mutex。仅保护 Adapter 请求会遗漏 Runner 构造阶段，它也可能操作设备；新增回归证明 supervisor 持有准备锁时 delegated child 不启动 Adapter，释放后才继续。

确定性/真实进程证据：CLI `managed-app.test.ts`、`managed-native.test.ts`、`managed-native-launch.test.ts` 覆盖 stop/prepare/launch 顺序、每次复查、无场景 peer、失效 fingerprint 和失败围栏；Worker `native-preparation-ipc.test.ts`、`native-ownership-ipc.test.ts`、`worker-native-ownership.test.ts` 覆盖字段/project/重放/并发、取消/超时/断开、未结束准备阻止 reset/reuse 和错误保留。`processes.test.ts` 使用真实 Node executor，通过文件事件确认 supervisor 已进入准备后发送取消，证明实际 IPC 取消抵达且后续请求不执行；`executor-timeline.test.ts` 分别覆盖 direct owner 和 supervisor IPC 的两次 attempt。native `NativeSession.test.ts` 验证初始化互斥。

本切片没有真实移动端准备或权限业务通过记录。下一步将 Android 权限原语接到此通道：需要 owner 下的 force-stop/UID 退出确认、每 attempt 完整声明替换/无声明恢复、启动后的独立 grants/flags 观察和最终恢复；只有真实平台 prompt/deny/grant 验收完成后才开放高层声明。当前 `permissions`、baseline、media、cameraSource、biometricBaseline 仍在平台动作前拒绝。iOS 专用 Simulator 可继续独立验证混合 UI，不依赖 Android 启动环境恢复。

本切片验证：Worker 单并发全量 22 文件、95 项通过；native 全量 15 文件、80 项通过；CLI 原生/managed 专项 5 文件、32 项通过；Vitest 原生/device scenario/managed 专项 4 文件、5 项通过。全仓 build/lint 通过，最终改动的 native、CLI、Worker 再构建通过；Harness、CLI 文档与 diff 检查通过。生成式实现参考 615 份（16 包，新增 managed native preparation pipeline），capability 文件 17 份。上述检查均不替代移动端业务验收。

## 20. Android 停止确认与启动后独立观察原语

本切片继续补齐第 18 节步骤 2/4 的底层前置条件，尚未开放高层权限声明或接通真实权限业务流程。

| owner API | 当前实现 | 限制 |
| --- | --- | --- |
| `stopApp({ mode: 'managed-start', timeout?, signal? })` | 写前验证 package、主用户与隔离 UID；派发一次 force-stop 后复核 stopped 与整个 UID 无进程 | 专用 Android Emulator；调用前关闭本 owner 的 Adapter；取消/丢失回复/残留进程保留 unknown，隔离且不重发 |
| `inspectPermissions(names, { timeout?, signal? })` | 在 app/Adapter 运行时独立读取 camera/microphone grants/flags 和默认 app-op | 只读且不捕获恢复基线；仍拒绝未知/不可恢复 flags 和自定义 app-op；不证明权限弹窗或硬件访问 |
| 共用执行边界 | 停止、权限准备与观察使用 retained owner 的同一操作互斥和总 deadline | 等锁计入预算；取消后跟踪真实底层工作；未结束时不归还设备、不允许下一次准备 |

回归证明 parent 停止 → 准备 grant → launched child 建 Adapter 并独立观察 → child dispose 不恢复 parent 状态 → parent 最终停止并恢复原始权限。另覆盖错误包/共享或歧义 UID/不可用 User 0 的写前拒绝、成功 stop 回复但自定义 UID 进程残留、已派发 stop 的取消与不重发、观察等待 operation mutex 的超时预算。

后续接线必须保留如下顺序：

1. supervisor 校验当前 attempt 与完整场景声明，关闭旧连接和 Adapter，确认 launcher 退出。
2. retained Android owner 执行一次 `stopApp` 并取得 UID 退出证明，再 `preparePermissions` 替换本次完整声明；无权限声明也要恢复前次声明省略项。初始 launch 的安装与停止阶段须单独定义，不能对尚未安装的包盲目 force-stop。
3. launch 并绑定新 endpoint/VM PID/Adapter generation。child 在自己的会话下 `inspectPermissions`，校验声明与 readiness 后才构造单次 live receipt；supervisor 成功 JSON 不替代独立复核。
4. 无场景 peer、app-only、retry、skip 后 peer 全部经过同样的声明替换规则。最终确认 app 停止后再 dispose mutating owner，使用独立预算恢复/readback；dispose 不隐式杀 app。执行或恢复未知时保持隔离并报告原始错误。
5. 在可启动专用平台上完成 prompt/granted/denied 真实业务断言与最终恢复，再按已验收的平台/权限/状态逐项开放入口；运行中会杀 app 的 `device.permissions.set` 继续拒绝。

当前实际证据为确定性回归，未新增真实 Android 权限、Face ID/指纹或相机管线的通过记录。已有 Android 专用 AVD 启动阻塞仍保留；iOS 混合 UI 和其他独立工作可继续。不能把本表的原语标为完整权限场景已支持。

N4 接线状态补充：安装式 Android managed control 已在每次 `stopApp` 成功之后调用 retained owner 的 `preparePermissions`，输入取自 supervisor 冻结并重新解析的场景；无权限声明传空数组，使前次 attempt 省略的权限回到原始状态。返回的权限状态仅作为 `nativeApp` supervisor expectation 随当前 attempt endpoint 传给 child。Vitest child 在新 VM PID、managed generation 与 Adapter generation 下调用 owner 的 `inspectAppState`，独立观察 APK/UID/PID、permission grants/flags 和受限的默认 package app-op；通过后才消费单次 live readback。managed control 的 wire request 只含 attempt key、scenario name 和 fingerprint，不接收 child 提交的权限名、目标状态、ADB 命令或主机路径；supervisor 通过冻结配置解析完整声明。

此路径仍受公开 gate 限制：`validateScenarioDevicePreparation` 对非空 `permissions`、baseline、媒体和 camera source 声明在任何设备操作前失败。因此当前可执行路径只会准备空权限声明；非空声明不会走到 stop、权限写入或 launch。已有 core 与 Vitest 回归覆盖声明和 owner expectation 不一致、声明在异步 readback 中变化、平台观察与 owner expectation 不一致、旧 attempt/generation 和 malformed metadata；但这些测试不能冒充“非空声明通过公开 gate 后的 Vitest worker 全链路及真实设备验收”。下一步继续保持 gate，先补其余确定性故障矩阵；待平台权限业务闭环通过、准备开放具体状态时，再增加公开入口的 worker 级非空声明测试。只有专用 Android AVD 的 prompt/granted/denied 业务闭环及最终恢复均通过后，才逐项开放对应权限状态。

本切片 native 全量 15 文件、87 项通过，专项 2 文件、23 项通过；全仓 `pnpm build`、`pnpm lint` 通过。生成式实现参考刷新为 615 份（16 包），capability 文件 17 份；Harness、CLI 文档与 `git diff --check` 通过。本轮未更改依赖，未启动或改动个人设备，未提交构建产物或本机设备配置。

## 21. iOS Simulator 真实混合用例与维护宿主

第 18 节的 iOS 独立验收已有最小业务证据；它不解除权限 mutation、生物识别或镜头管线的门槛。

### 21.1 交付与修复

- `examples/form_demo/lib/native_fixture_main.dart` 与 `native_fixture.dart` 提供独立 bridge 入口、稳定 Key 和 app-owned `nativeDemo.reset`。Flutter 显示原生实际返回的确认/取消、麦克风 granted/denied；通道缺失、无效响应和失败均显示错误，不伪造结果。
- `native_fixtures/ios/AppDelegate.swift` 是受 stack 治理的源码覆盖层，使用 UIKit 真实确认框与 AVFoundation 系统权限请求。`scripts/prepare-native-demo.mjs` 在新临时目录生成 Flutter iOS 宿主，复制维护源码、麦克风 usage description、E2E 用例及本 checkout 的依赖；不把生成的 Xcode 工程加入仓库，也不操作设备。
- 真实排障发现生成的 Flutter Runner Debug 未定义 Swift `DEBUG`，最初条件编译导致通道未注册。宿主改为在 Debug.xcconfig 显式增加 `FLIWRIGHT_NATIVE_FIXTURE`，源码还要求 `targetEnvironment(simulator)`；Release/物理设备宿主不注册测试通道。staging 回归覆盖此配置。
- 真实 iOS 26 `launchctl list` 返回 `UIKitApplication:<bundle>[hex][rb-legacy]`，原有绑定只识别 `application.<bundle>.<suffix>`。`NativeBinding` 新增完整格式解析、精确 bundle 与当前 PID 核验；回归覆盖旧 PID、相似包名、后缀垃圾和畸形标签拒绝。
- `e2e/native.project.ts` 要求显式设备/app/Runner 环境配置，系统作用域只声明 SpringBoard。命名 `native.ready` 场景只要求 query/click 并 reset app UI，不负责权限基线。公开 `page`、`native`、`expect` 在同一用例内完成两个 surface 的操作与业务断言。

### 21.2 实际运行与证据

工具链：Flutter 3.47.8、Xcode 26.6 / build 17F113、iOS Simulator 26.5 / SDK 23F81a、英文专用 Simulator。使用仓库 managed CLI，未使用 Appium/WDA。

| 用例 | 原生动作与业务结果 | 结果 |
| --- | --- | --- |
| 确认 | Flutter 打开 UIKit；app scope 点击 `Confirm native`；Flutter 断言 `Native: confirmed` | passed |
| 取消 | Flutter 打开 UIKit；app scope 点击 `Cancel native`；Flutter 断言 `Native: cancelled` | passed |
| 允许麦克风 | Flutter 请求真实权限；system scope 点击 `Allow`；Flutter 断言 `Microphone: granted` | passed |
| 拒绝麦克风 | 独立 prompt baseline；system scope 点击 `Don’t Allow`；Flutter 断言 `Microphone: denied` | passed |

确认/取消在同一 managed run 中执行，两用例的 managed app generation 与 Adapter generation 分别不同；都通过当前 VM PID 绑定。麦克风用例分别运行，先由外部 `simctl privacy reset microphone <app>` 恢复该自有 app 的 prompt。报告的过滤用例是 skipped，不能计为 passed。每个通过用例的 canonical timeline 均包含 Flutter tap、原生 click、Flutter 业务断言及截图。

本机证据保留在 `/tmp/fliwright-ios-mixed.YCWuoK/acceptance.json` 及同目录 `runs/`。通过记录为 `run-2026-11-03T09-57-21-347Z`（两用例）、`run-2026-11-03T10-00-04-381Z`（允许）和 `run-2026-11-03T10-02-28-171Z`（拒绝）。前两轮各两项失败也完整保留：进程标签绑定失败、原生通道未注册导致 click deadline。八项实际执行中四项失败、修复后四项通过；这是排障和 smoke 记录，不是 20 次独立 attempt 稳定性验收，不据此计算发布成功率或 p95。

清理已确认：CLI/Flutter 与 owned XCTest 无残留，重置该自有 app 的麦克风权限并卸载 fixture，专用 Simulator 恢复 Shutdown；生成宿主已删除，canonical 证据保留。个人与 Worker 设备未操作。复现步骤见 [demo README](../../../examples/form_demo/README.md#mixed-flutter-and-native-ios-fixture)。

### 21.3 缺少的交付及执行顺序

1. **完整权限 attempt 管线。** 继续第 20 节的 stop → 完整声明替换/省略恢复 → relaunch/PID rebind → child 独立 readback → 最终 stop/restore。补首次安装、普通 peer、retry、skip、取消、恢复失败的集成证据；平台业务未验收前保持入口拒绝。上述外部 microphone reset 不是此管线的实现。
2. **Android 平台恢复与混合示例。** 专用 Emulator 仍被 HVF/mprotect 启动错误阻塞；不修改个人 AVD 或主机安全设置。恢复后先采集真实 grants/flags/app-op 格式，再验证权限 UI、业务结果和原始状态恢复。iOS 通过不替代 Android 验收。
3. **Face ID/指纹独立专项。** 明确录入/未录入配方，观察真实 pending challenge，再验证 match/reject/取消/锁定及恢复；iOS 公开定向、headless、多设备隔离通过前保持 unverified。物理设备事件注入 unsupported，人工通过 `flow.manual` 后恢复业务检查。
4. **相机与图库。** 固定结果只证明 app-test-seam；继续独立实现自有媒体夹具的分发/归属/清理、Android preboot imagefile/videofile 与实际帧验证。图库导入、拍摄 UI、虚拟镜头、物理镜头分别验收；iOS 不虚构 camera privacy 或任意镜头输入命令。
5. **发布矩阵。** 每平台 20 次独立混合 attempt；授权 Android 真机、两设备并发、同设备争用、旋转/键盘/遮挡与取消/失联/崩溃故障矩阵。记录原始结果、无重试通过率、查询/动作 p50/p95 和启动/恢复/清理成本。当前四个 smoke 用例不足以完成这些条件。

本切片验证：native 全量 15 文件、88 项通过；宿主 staging 与 native stack 脚本回归 3 项通过；demo native widget 4 项通过，针对新增 Dart 源码/测试的 analyze 通过；E2E 配置和用例 strict TypeScript 检查通过。全仓 `pnpm build` / `pnpm lint`、Harness、CLI 文档检查（70 guides / 102 parsed examples）和 `git diff --check` 通过。生成器刷新 618 份实现参考（16 包，新增 iOS mixed fixture pipeline）及 17 份 capability 文件。以上静态/回归检查不替代第 21.3 节未完成的平台验收。

## 22. Android 维护宿主、真实 APK 构建与 owner 总清理期限

已交付 Android 混合用例的可复现宿主，尚未通过 Android 设备业务验收：

- 维护 `examples/form_demo/native_fixtures/android/MainActivity.java`，只在 debuggable app 中注册 fixture 通道。Android AlertDialog 实际返回确认/取消；camera/microphone 使用系统 requestPermissions，完成后独立 checkSelfPermission 再回传。空/不匹配回调失败，不把取消伪造为 denied；Activity 销毁时失败结束 pending 请求。
- app-owned `nativeDemo.readPermissions` 仅查询 Android 的 granted/rationale，不发起请求；Dart 校验完整观察形状。rationale=false 不能区分尚未请求与永久拒绝，不以此替代 package-manager grants/flags 或权限准备凭据。Flutter camera 按钮只在 Android 入口启用。
- `prepare-native-demo --platform android` 在新临时目录生成 Java Flutter 工程，复制维护源码、CAMERA/RECORD_AUDIO manifest 声明、Android 配置及六个混合用例；不操作设备。未选择平台仍为已有 iOS 工作流；非法平台在目录创建/工具执行前拒绝。
- Android 配置要求显式设备/app/permission-controller package；allow/deny 的 resource ID 必须对照该 OS 的真实 snapshot 核验。确认/取消可一起运行，camera/microphone allow/deny 四项分别使用独立外部 prompt baseline。每项权限用例断言 Flutter 结果，再通过 app capability 查询真实授权值；尚未把这些用例计为 passed。
- stack 检查增加 Java/Kotlin source roster、精确 import（含 static、wildcard、同一行语句）检查，拒绝维护源码中夹带 Gradle 工程/依赖 manifest。没有新增第三方 Android 自动化依赖。

真实构建：Flutter 3.47.8 生成宿主并完成 `flutter build apk --debug --target lib/native_fixture_main.dart`，Gradle 332.4 秒，APK 构建成功。随后 apkanalyzer 核验 application-id 为 `dev.fliwright.form_demo`、debuggable=true、minSdk=24、targetSdk=36，且含 CAMERA/RECORD_AUDIO。编译与 manifest 检查不证明系统 UI 或权限恢复。

平台重试：全新临时 Pixel 6 AVD、Emulator 36.6.11.0、android-37.2-beta3 arm64 image，显式 `-feature HVF`。尽管主机 accel-check 和 kern.hv_support 显示 Hypervisor 可用，Emulator 仍报告 hvf not enabled 与 mprotect Permission denied，ADB offline。该次探测失败日志保留；未重复启动同一未结束进程。已确认 owned Emulator 与直接子进程退出，移除临时 AVD/生成宿主，未改个人 AVD、签名或主机安全设置。APK、构建/启动日志、源码 hashes、manifest 与清理结果保存在本机 `/tmp/fliwright-native-android-validation-3x8xthuc/source-check.json` 及同目录；这些本机产物不是仓库源码或设备配置。

同时修复 owner 清理预算：此前 outstanding work / Adapter dispose 消耗时间后，permission restore 会重新取得完整 cleanupTimeout，可能越过总期限。回归先证明 40 ms 总预算下等待 Adapter 20 ms 后，旧实现却给 restore 60 ms 的 deadline；修复后所有阶段共用一个截止时间和取消 signal。超时取消恢复，晚到读回/等锁不能继续派发新的 restore 命令；已经派发且不响应取消的命令仍按 unknown 保留隔离，不能声称撤销已发生的写。单项回归同时断言 deadline、signal、无后续写及 quarantine。

当前仍须完成第 20/21 节的 managed permission mutation、child 独立复核与最终恢复接线，尤其首次安装与初次 launch 的权限状态归属。现有 Flutter daemon 初次 startApp 会构建/安装并启动，不能据此承诺 App 启动之前已应用权限；在定义并验证 install → stop → prepare → launch 边界之前，不开放高层 permissions 声明。Android 业务验收还需可运行的专用设备；Face ID/指纹、相机帧、图库及发布矩阵继续按原范围推进。

本切片验证：native 全量 15 文件、89 项通过；demo native fixture 7 项、宿主/stack 脚本 6 项通过；针对三项 Dart 源码/测试的 analyze 和两平台 E2E strict TypeScript 检查通过。全仓 `pnpm build` / `pnpm lint`、Harness、CLI 文档检查（70 guides / 104 parsed examples）、本地文档链接与 `git diff --check` 通过。生成式实现参考刷新为 619 份（16 包，新增 Android mixed fixture pipeline），capability 文件 17 份。上述结果包含真实 APK 构建，但不包含真实 Android 业务通过。

## 23. 补充方案：首次安装、无重装启动及剩余专项

本节是待实施方案；本轮补充设计与任务，没有新增平台通过记录。保留无 Appium/WDA、`page` / `native` / `device` 分工及原有能力开放门槛。

### 23.1 已核实的启动问题与技术选择

核对当前 Flutter 3.47.8，源码 revision `737ba8f885dc774b53b442759999a312c9461e4e`：

| 来源 | 实际行为 | 对实现的约束 |
| --- | --- | --- |
| [AndroidDevice.startApp](https://github.com/flutter/flutter/blob/737ba8f885dc774b53b442759999a312c9461e4e/packages/flutter_tools/lib/src/android/android_device.dart#L525) | prebuilt 仅影响构建；后面仍 stop/install/launch；install 失败可能卸载重试 | `flutter run --use-application-binary` 不能承担权限准备后的启动 |
| [installApp](https://github.com/flutter/flutter/blob/737ba8f885dc774b53b442759999a312c9461e4e/packages/flutter_tools/lib/src/commands/install.dart#L109) | 默认 uninstall=true，可能先卸载旧 app | 不用默认 flutter install 保存已有 auth/权限基线 |
| [AttachCommand](https://github.com/flutter/flutter/blob/737ba8f885dc774b53b442759999a312c9461e4e/packages/flutter_tools/lib/src/commands/attach.dart#L323) | 支持 machine attach，执行 runner.attach；debug-url/app-id 可显式指定 | 是后续热重载候选；仍需验证协议、进程与取消，不能仅凭存在 flag 声称跑通 |
| 本仓 `finite.ts` / Worker `executor.ts` | 初始先 startApp 取 endpoint，再建立每 attempt 控制；随后 launch 又用 startApp | 初次与后续路径都要替换，不能只在 stop/launch 间加 preparePermissions |

采用“构建安装一次，逐 attempt 启动已安装 app，直接验证当前 VM endpoint”的有限运行路径。构建由 CLI/Worker 监督，平台安装/启动/转发由 native owner 封装，core 继续负责 endpoint/Bridge 协议；devices 不增加写操作。首个实现不引入常驻 Flutter attach，也不自动切换 backend。后续 TDD 热重载若需要 attach，应作为独立工作包验证。

初始支持范围：单个 Debug APK、专用 Android Emulator、User 0、camera/microphone；可接受本次新安装或摘要匹配的同一既有安装。不同产物的升级、split APK、物理设备权限 mutation 和 iOS 安装分离后续独立处理，不以卸载重装兜底。

### 23.2 实施顺序与交付物

以下每行按行为测试红 → 最小实现绿 → 所属包检查推进；真实设备验收是独立退出条件。先完成 N1—N4 的完整路径，避免继续增加无法调用的权限原语。

| 顺序 | 所属 Module / 改动位置 | 具体交付及退出条件 |
| --- | --- | --- |
| N1：产物与安装 | CLI/Worker 构建监督；native owner 的 Android 安装实现 | shell-free 构建、独立预算/取消/输出上限、确认 owned process group 退出；产物记录 APK 摘要、package、debuggable、SDK、签名和入口 Activity。持设备租约后查询安装：相同产物不安装，不同/无法验证的既有产物失败；新安装只派发一次，不用 `-g` 自动授予全部权限。保存安装归属并核验 UID、实际安装产物及权限声明，失败/取消不启动 app |
| N2：无重装启动 | native 内部 Android launch/endpoint 发现；复用 `NativeDeviceSession` | 预先建立本次日志观察，再启动已核验 Activity；从本次当前 PID 的日志发现带认证 URI，创建拥有的设备定向转发，并由 core 验证 VM/Bridge 后再做 PID 绑定。新代次不使用旧日志/URL，不清空全设备日志；转发仅清理本次拥有项。超时/进程退出/未知 launch 不重发，dispose 有界确认收尾 |
| N3：统一首次与每 attempt | CLI `ManagedNativeRun` / `ManagedAppRun` / `registry/finite.ts`；Worker `executor.ts` / ownership IPC；Vitest `TaskManagedApp` | 首次不为 bootstrap 偷跑 app；控制通道可在无初始 endpoint 时建立，task 仅建立设备所有权/选择用例，首个 attempt 请求准备后取得 endpoint。每次都 stop → prepare complete declaration → launch installed → verify/rebind。Worker supervisor 保留平台 owner，executor 传 attempt/scenario identity，不能通过 IPC 传任意命令或主机路径 |
| N4：权限准备与凭据 | native 权限原语；CLI `InstalledAndroidRun` / `ManagedAppRun`；core `ScenarioDevicePreparation`；Vitest `TaskScenarioPreparation` / `TaskNativeSession` | **部分接线，公开 gate 保持关闭。** installed Android 每 attempt 在 stop 后按 supervisor 冻结场景调用 owner `preparePermissions`，空声明也执行以恢复省略项；endpoint 只携带严格校验的 supervisor expectation，child 在自己的 runtime 独立观察并形成一次性 readback。managed IPC 只携带 attempt/name/fingerprint，不允许 child 传平台写入参数。声明变化、声明与 expectation 不符、平台读回不符、attempt/generation 错配和 metadata 伪造已有 core/Vitest 确定性回归；仍需在 gate 打开后验证非空声明的公开 worker 全链路，以及完整首次安装/首次启动与最终 restore/quarantine。非空权限 scenario 继续在平台操作前被 core gate 拒绝。只有专用 AVD 的 prompt/granted/denied 业务与恢复验收通过后，才逐平台/权限/状态打开对应字段 |
| N5：权限开放与平台业务 | demo、E2E、能力/场景校验 | 在真实专用设备执行 prompt/granted/denied 与 allow/deny/cancel，断言系统观察和 Flutter 业务结果、最终基线。按验证过的平台/权限/状态逐项放开场景；测试前仍关闭高层入口。运行中会杀 app 的 permissions.set 不开放 |
| N6：生物识别 | native 基线准备/事件；app 观察 fixture；E2E | 完成 23.5 的挑战状态机和真实业务矩阵；消除调用方布尔值自证 ready。Android 指纹先交付；iOS Face ID/Touch ID 通过独立 P0 后交付，否则明确 unverified，物理注入 unsupported |
| N7：图库与虚拟镜头 | native 媒体归属与预启动配置；设备准备；demo/E2E | 版本化夹具清单、摘要验证、分发/清理证明；cameraSource 在 boot 前应用。实际镜头帧、方向/镜像、视频与 headless 通过后才声明支持；无定向清理的平台要求拥有的可恢复专用模拟器 |
| N8：发布闭环 | CLI/Worker、Cloud/VS Code artifacts 消费端、生成式文档 | 完成 23.7 的稳定性与故障验收，逐能力维护证据和支持状态。更新 CLI schema/help、skills、生成文档及包发布检查；普通 Flutter suite 无原生进程或依赖初始化副作用 |

N3 需要复核 `TaskEndpointLease` / endpoint resolver 的实际调用顺序，不能只给 `runCommand` 塞一个空 URL 或假的 endpoint。新增 launch handle 应同时拥有当前进程、发现器、转发和 generation；调用方只学习“准备/启动/停止/关闭”的生命周期，不暴露 ADB 命令列表。现有只读 native 路径可保留既有已验证启动方式；权限场景不能失败后静默回落到它。

### 23.3 状态、所有权与恢复规则

首个 attempt：验证冻结配置/支持范围 → 构建与验证 APK → 获取设备 owner → 核验或新安装 → 确认 app stopped/UID 无进程 → 捕获原始权限 → 准备 → 无重装启动 → 验证 endpoint/Bridge/PID → child 复核 → app scenario → test body。

后续 attempt：完成前次诊断并关闭 driver/Adapter → 结束旧 endpoint/启动观察 → stop 并确认 UID 无进程 → 替换完整权限声明/恢复省略项 → 启动同一产物 → 新 endpoint/PID/generation → child 复核。retry、普通 peer、body skip 后 peer 都走此顺序。

结束：停止接收新 attempt → 取消并等待平台工作 → 关闭当前 child/Adapter → stop 并确认 UID 无进程 → 恢复原始权限并 readback → 清理拥有的转发/文件/本次新安装 → 释放 owner。既有安装不能卸载；安装身份发生变化时停止恢复并 quarantine。

- 权限基线在安装核验后捕获。首版不更新既有不同产物，故不需要虚构跨升级的权限/用户数据回滚。
- 存在 mutation/基线恢复声明时，`keepAppAlive` 在设备写前失败；supervisor 按冻结配置预检可能选中的声明，不依赖 child 保证稍后会清理。
- 构建、install、launch、每 attempt、最终 cleanup 使用各自明确的总预算；外层取消可收紧预算，不能因分阶段重新获得无限等待。最终清理使用一个独立总 deadline，沿用第 22 节修复的规则。
- 写前保存本机恢复记录；未知或执行中状态在宿主重启后阻止自动复用。中断恢复不自动重放 install/launch/权限写；保留原始业务错、平台错和清理错。日志、记录及报告不保存 token、完整 VM URI 或敏感输入。

### 23.4 权限管线必须保护的测试

| 行为 | 确定性回归 | 实际设备验收 |
| --- | --- | --- |
| 首次新安装 | 事件顺序为 install → stop confirmation → prepare → launch；prepare 后安装调用为零；构建/安装失败不启动 | 新安装 prompt 触发真实权限框，grant 不出框，业务结果正确 |
| 已有安装 | 完整产物摘要一致跳过 install；不同摘要/签名/UID、多个入口歧义、split 未支持在写前失败 | 既有 app 数据与原始权限保留，最终未被卸载 |
| 多 attempt | camera grant → microphone deny → 无场景 → app-only → retry → skip 后 peer；省略项逐次恢复；旧 receipt/PID/URL 失效 | 系统权限和 app capability 双重观察，业务结果和恢复相符 |
| 取消与未知结果 | build/install/stop/prepare/launch/forward/readback/cleanup 各阶段取消；真实临时子进程验证退出；已派发写无自动重发 | 断开设备、终止 launcher、Runner 崩溃；不误通过、不残留可复用 dirty 设备 |
| 失败与重启 | 安装成功但回复丢失、恢复记录残留、恢复写失败、保活冲突、app 启动即改权限均拒绝继续 | 最终原始权限恢复，或明确 quarantine；不能把无法核验报告为清理成功 |
| 并发与传输 | parent/child mutex、supervisor IPC、身份错配/重放/断开、凭据无公开泄露 | 同设备两个进程互斥；两台专用设备各自 endpoint/权限不串用 |

N1—N4 未验收前继续拒绝用户高层 permissions 声明。确定性集成通过后，可用 native owner 的低层接口加真实 demo 先验 N5；业务通过后再打开场景校验并跑公共入口 E2E，不引入公开的绕过开关。

### 23.5 Face ID / 指纹补全

维护专项 app 观察契约：challenge identity、pending、失败事件序号、终态和平台错误。观察通道只读，不提供认证成功写入口；challenge 绑定当前 app generation。使用平台真实回调作为来源，不能在测试端注入后自行标记 consumed。

| 分支 | 必须观察和断言 | 恢复 |
| --- | --- | --- |
| 已录入 + match | 确认当前挑战 pending → 单次已录入 ID 事件 → 实际成功终态 → Flutter 受保护业务页面 | 关闭挑战，普通 peer 不继承认证流程 |
| 已录入 + reject | 当前挑战收到真实失败事件；若仍 pending，不要求 authenticate 已返回失败 | 用真实 Cancel 控件结束，断言取消；后续新挑战可正常成功 |
| 无录入/无安全锁 | 平台不可用原因；注入前失败，或 app 明确 fallback | 恢复版本化专用录入基线并复查 |
| 用户取消/应用取消 | 区分真实取消与不匹配；取消后迟到事件不得进入新挑战 | 新建 challenge identity 后再测 |
| 锁定/恢复/凭据 fallback | 依当前 OS 的实际策略记录 temporary/permanent lockout 和错误；fallback 单独断言 | 使用专用基线/已验证解锁流程，读回 readiness，不用固定 sleep 代替 |

录入状态凭据绑定设备、boot、OS、基线版本、已录入/未录入 ID；调用方传 `baselineVerified: true` 不足以认证。实现时替换现有自证逻辑，不加旧布尔值兼容通道。iOS P0 必须先证明当前版本有合适的公开自动化路径；若只能桌面菜单，单列 desktop/manual，不能列入 headless CI。Android 指纹不能替代 Android 人脸或第三方活体测试。

### 23.6 相机补全

1. **固定结果业务。** 沿用 cameraTest，补移动端图片、取消、错误和重拍/上传业务验收；fixture 内容摘要与资源分发可验证。维持 app-test-seam 覆盖标识。
2. **权限与拍摄 UI。** 使用 N5 权限基线，从 Flutter 打开真实原生拍摄页，分别操作快门/确认/重拍/取消，检查回到 Flutter 的实际结果。demo 必须真的调用相机，现有 requestPermissions 按钮只证明权限流程。
3. **图库。** 清单包含 fixture ID、摘要、MIME、字节/像素限制、预期可见标识；记录本次资产 ID 和清理归属。iOS addmedia 等只导入的工具不能据此声称支持定向删除，需专用可恢复环境。
4. **Android 虚拟镜头。** 以实际版本支持的 imagefile/videofile backend 为准，在拥有的 AVD boot 前设置；启动中来源不同明确要求重新准备。通过拍摄输出的标记/像素特征验证指定帧，覆盖前后镜头、旋转/镜像、分辨率、视频时间进展与 headless。不能用 app 接缝返回同一图片冒充管线验证。
5. **真实镜头与 SDK。** 单列受控物理场景/人工操作；Face ID 光学硬件、第三方活体与普通拍照不合并。iOS Simulator 没有已验证镜头注入接口时保持 unsupported/unverified 的实际状态。

### 23.7 验收报告与执行次序

报告逐项记录：能力、覆盖层次、平台/设备类型与工具版本、产物/夹具摘要、用例与原始 attempt 结果、业务断言、权限/资源前后观察、耗时样本、清理或 quarantine 结果及可离线查看的证据。报告不能包含机器凭据或个人设备配置。

Android Emulator 和 iOS Simulator 分别运行 20 次独立混合 attempt，保留失败样本和重试；无重试成功率的分母为实际首次执行数，重试结果单列。查询/动作各计算 p50/p95，并报告样本数、计算方法及 stop/launch/prepare/restore/cleanup 成本；设备未就绪未执行的记录作为 setup failure 单列，不计为通过。另做两设备并发、同设备争用、授权 Android 真机的只读/原生 UI、旋转/键盘/遮挡和故障矩阵。iOS 四个 smoke 用例与 Android APK 构建记录不替代这些样本。

当前主线进入 N4 的权限接线验收，而不是重新启动已记录在后续章节的 N1/N2 owner 生命周期实现。先维持非空权限声明的公开 gate，补齐跨包/worker 故障边界与首次安装、首次启动、最终恢复的确定性覆盖；Android HVF/mprotect 阻塞没有新假设前不重复同一 AVD 启动实验。恢复可用的专用 AVD 后，再执行 prompt/granted/denied 的真实系统与 Flutter 业务断言、最终 baseline readback，按通过的权限状态逐项开放。iOS 生物识别公开接口验证、媒体清理可行性可作为独立工作项推进，不据此绕过 Android 权限验收。

本节仅更新目标设计与实施方案，未更改源代码、依赖、设备或生成式实现参考；执行时按受影响包完成测试、build/lint、Harness 及生成文档闭环。

## 24. Android owner 安装、无重装启动与恢复记录

本切片实现第 23 节 N1/N2 的 native owner 平台生命周期；CLI/Worker 的首次 endpoint 和构建监督仍未替换，不能把它视为完整权限场景已开放。

### 24.1 已实现

- `NativeDeviceSession.installApp({ apkPath, apkAnalyzerPath }, { mode: 'managed-start', timeout?, signal? })` 仅允许 Android Emulator retained parent owner。暂存本地主机 APK、限制 512 MiB、计算内容 SHA-256，通过 Android SDK APK analyzer 输出解析受限 XML，禁用 DTD；核对包名、Debug、runtime SDK、唯一 exported launcher 和默认应用/入口进程。既有安装只接受匹配的单一 base.apk 和 User 0 隔离 UID；拒绝 split、不同产物或不可验证的安装，不自动替换。新安装还要求设备仅有 User 0，发送一次不带 replace/grant-all 的 install，写前保存并 sync 恢复记录，再独立读取安装 hash/UID。此方法不启动 app、不授予权限。
- `launchApp({ mode: 'managed-start', timeout?, signal? })` 检查同一安装、stopped 标志和整个 UID 无进程，取得当前设备日志游标，再直接启动已安装 Activity。仅使用新于游标、属于当前主进程 PID 的 VM service 日志；要求带认证路径的 loopback URI，建立/核验本次拥有的 ADB 转发，再确认 PID 仍存活，返回 URL/PID/新 generation。不调用 flutter run/install、不清空 logcat、不关闭认证；调用方仍须完成 core VM/Bridge 验证及现有 native PID 绑定。
- `stopApp` 与权限 mutation 在已拥有安装时先核对 artifact/UID，避免操作替换的 app。停止后检查本次转发映射，只有仍指向当前设备/端口才移除。最终 owner 清理先确认同一安装已停止，再恢复原始权限，最后仅卸载本次新装的 app；既有安装保留。新装之后出现其他 Android user 时拒绝全局卸载。
- 安装、启动、观察、停止、权限与清理共用 owner 操作互斥、总 deadline 和底层 work 跟踪。delegated child 没有 parent-only recoveryPath，不能取得安装归属。安装/启动/转发等未知写不重发、不盲目卸载；取消后忽略 signal 的工具仍保留 operation lock。真实 parent lease 在 quarantine 且存在 app 恢复记录时保留记录与锁，不在 release 中删除。记录仅保存安装/资源归属，没有 VM 认证 URI；完整权限基线的崩溃恢复尚未交付。
- 本地 APK 验证失败且没有设备 mutation 时，owner 可正常关闭归还，不把纯本地输入错误误判成 dirty 设备。安装前已有权限恢复 baseline 时拒绝事后接管安装归属。

### 24.2 验证与限制

`AndroidManagedApp.test.ts` 新增 16 项行为回归，覆盖单次新安装/同产物跳过、different/split/非法 manifest 拒绝、安装回复丢失/失败不重试、不重装的多次启动、日志代次、认证与地址拒绝、转发被替换不删除、其他用户保护、安装身份变化、owner 下 install → stop → permission → launch → stop → restore → uninstall，以及取消后无响应平台工作阻止复用。缺失 owner 方法、无写输入错误误 quarantine、恢复记录被 release 删除和多用户全局卸载均先观察失败再修复；恢复记录保留另有真实设备租约文件回归。

真实主机通过新 APK 暂存/摘要/manifest 解析路径，核验已有受治理 Debug APK：`dev.fliwright.form_demo`、入口 `dev.fliwright.form_demo.MainActivity`、minSdk 24、targetSdk 36，含 CAMERA/RECORD_AUDIO。主机证据保存到本机临时目录 `fliwright-installed-app-source-E7BC3o/artifact.json`，暂存 APK 在回调完成后删除。此记录不证明 Android 安装、VM 日志格式、转发、权限 UI 或业务成功。

当前 ADB devices 仍无在线设备，未重复启动已知 HVF/mprotect 失败的 AVD，也未操作个人/Worker 设备。新 launch 路径的真实 Android 工具输出与业务仍待设备验收；受控回归不提升高层 permissions 支持状态。没有新增依赖或编译产物入库。

本切片检查：native 全量 16 文件、106 项通过；新增测试 strict TypeScript 检查通过；全仓 build/lint、Harness、CLI 文档检查（70 guides / 104 parsed examples）通过。使用生成器更新 620 份实现参考（16 包，新增 Android installed app pipeline）及 17 份 capability 文件。

### 24.3 下一项完整接线

继续 N3/N4：在 CLI/Worker 监督独立构建并选择/验证 APK，建立无初始 endpoint 的 managed control，让第一个 attempt 才取得 launchApp 的当前 URL。supervisor 持有安装 owner，child 只请求单次 attempt；每次确认停止、替换完整权限声明、启动同一产物、验证 VM/Bridge/PID，再由 child 独立读取权限形成 live receipt。补 keepAppAlive 冲突与最终停止/恢复、安装/权限恢复记录的整合，禁止回落到 flutter run 重新安装。随后真实平台验 N5，再打开相应场景字段；生物识别、相机、媒体与完整发布矩阵继续按原范围完成。


## 25. 原生 managed 测试移除预先启动

本切片完成 N3 中控制通道与初始 endpoint 的接线。N3 的已安装 app 启动及 N4 权限 mutation/独立 readback 仍未完成，不提升高层设备能力支持状态。

### 25.1 已实现

- CLI 获取 retained native owner 后先建立 managed control，不执行用于初始 URL 的 Flutter 启动。首个实际 attempt 才通过原控制协议执行旧 managed 进程清理 → owner 准备 → 启动 → VM/Bridge 验证；重试、普通 peer 和动态 skip 后 peer 复用此顺序。
- `runCommand` 仅在 `managed-start`、native enabled、显式 control、显式 owner delegation 同时存在并通过结构校验时延后 VM 发现。私有协议不增加任意命令、产物路径或执行参数。继承的 control 环境变量不能启用此路径；attach、关闭 native 或缺少 owner 仍须取得初始 endpoint。无 endpoint 是内部可选状态，不构造假的 VM URI，不触发 `onVmResolved`。
- runner 环境同时清空旧的 `FLIWRIGHT_VM_URL` / `FLIWRIGHT_VM_SERVICE_URL`，避免别名或工作区配置把测试导向旧 app。Vitest 现有 managed fixture 在连接 driver 前请求当前 attempt 的 URL；本切片用空初始 URL 实际运行 child Vitest，覆盖 retry、普通 peer、动态 skip 与静态 skip。
- Worker 的 direct owner 和 supervisor delegation 路径同样延后首次 acquire。没有 attempt 时不产生 app.launch/app.verify 阶段。每次停止前 dispose 旧 endpoint lease，保存本次最新 lease；正常结束、runner 异常和最终 cleanup 都关闭最新 lease，随后完成 daemon 与 owner 清理。启动/验证失败封闭后续准备，不重发启动请求。
- 普通 Flutter managed 启动与 attach 的 endpoint 获取行为保留。首次 stop 对未启动的 owned daemon 只做本机清理；这不构成对设备上既有 app stopped 状态的证明，后续权限接线仍须走 owner 的 stop/UID 确认。

### 25.2 验证与范围

回归覆盖无 attempt 不启动、首个 attempt 无初始 URL、两种旧 URL 环境别名、缺失/非法 control 与 delegation、旧 managed 进程退出后才启动新进程、每次 endpoint 关闭、启动/验证失败阻止正文与重发。真实 child Vitest 保留新 endpoint/PID 绑定和清理不确定时 quarantine 的测试。

检查结果：CLI 聚焦 5 文件 86 项、Worker 聚焦 5 文件 37 项、Vitest fixture 聚焦 4 文件 5 项均通过；变更测试 strict TypeScript 检查及全仓 build/lint 通过。CLI 文档检查 70 guides / 104 parsed examples 通过；已重新生成 620 份实现参考与 17 份 Harness capability 文件，并同步 portable Skills，Harness 检查通过。

本次未进行新的模拟器/真机业务验收，未重试已知 Android HVF/mprotect 失败，也未操作个人或 Worker 设备。已有 iOS 混合流程证据维持第 21 节的覆盖范围，不能推断新生命周期已在平台验收。高层 permissions、biometric baseline、media、cameraSource 继续拒绝。

### 25.3 下一项完整交付

接通独立构建与第 24 节的 owner 安装/启动：由 CLI/Worker 的受控配置解析 Flutter 包、entry 和构建参数，构建不安装、不启动，受总 deadline、输出上限与 owned process group 退出确认约束；验证并暂存实际 Debug APK，再由 retained owner 接管。Flutter build apk 不支持通用 output-dir，产物位置/新鲜度须按实际版本确认，不能使用虚构参数。supervisor 持有产物与安装归属，executor 仅传 attempt/scenario identity。

在该路径上接每次 stop/UID 确认 → 完整权限声明替换 → 同产物无重装启动 → 新 endpoint/Bridge/PID 绑定 → child 独立观察/live receipt，补保活冲突与最终停止/原始权限恢复。不能在准备后回落到 flutter run/install。完成真实 N5 验收后再逐项开放权限；N6—N8 的生物识别、相机、图库和发布验收仍按原范围推进。


## 26. 独立 Android Debug 构建监督

本切片实现 N1 的共享构建原语；尚未切换 managed CLI/Worker 的平台启动后端，不构成权限声明开放或 Android 设备验收。

### 26.1 已实现

`withFlutterAndroidApk(options, consume)` 从 CLI 主入口及 `@fliwright/cli/run` 导出。项目根、目标、Flutter 可执行路径和构建参数由拥有方提供；接口不接受设备命令。真实 Dart entry 必须属于配置项目内的 Flutter 包，并存在 Android host。嵌套 workspace 以 entry 最近的 pubspec 为构建目录。只接受已核实的 flavor、Dart define、目标架构、版本及 pub/track-widget-creation 选项；profile/release、split、config-only、重复 target、设备参数和虚构 output-dir 在 spawn 前拒绝。

先执行 `flutter config --machine` 读取实际相对 build-dir，再执行 `flutter build apk --debug --target=...`。构建目录不越出 app、不经过符号链接，不修改 Flutter 全局配置。比对构建前后的输出 inode/mtime/ctime/size，只接受一个新鲜 regular 单 APK；支持 pubspec 默认 flavor 的实际输出，拒绝多个新变体、旧结果、符号链接和超过 512 MiB 的产物。通过 no-follow/nonblocking 文件描述符暂存并复查源身份/修改，计算 SHA-256。回调仅拿到独立私有副本；输出被下一轮替换不改变本次安装字节。回调成功或失败都移除副本。

以规范 Flutter 包路径的摘要建立跨进程构建锁，避免配置根或符号链接别名绕开同一输出目录的互斥。锁只覆盖读取配置、构建和暂存，暂存后可让后续构建与本次 consumer 并行。记录 owner PID、随机 token、当前子进程 PID，原子替换并 sync。缺少 owner 的刚创建目录短暂等待；死 owner 或无法确认清理的记录阻止自动复用，不凭 PID 不存在直接删除恢复记录。

每条 Flutter 命令用 shell-free argv 和独立 Unix process group。配置查询、构建与暂存共享总预算；输出合计 4 MiB，错误不含原始输出/参数。通过 Gradle system property 禁止 reusable daemon。正常退出、非零退出、取消、超时和输出超限均确认 leader/pipes/group 结束，TERM 不退出时升为 KILL；清理另有有界总期限。清理不确定保留锁和 checkpoint，后续调用失败。Windows 暂不支持此构建监督路径，不静默退化为只结束父进程。

### 26.2 证据与限制

新增真实子进程行为回归覆盖嵌套包、字面 shell 特殊字符、参数预检、路径越界、构建目录、默认 flavor/多变体、缺失/旧/符号链接/超大 APK、consumer 失败、取消/超时/输出上限、TERM 升级、leader 先退出后的 descendant、并发/别名以及不确定清理的 durable checkpoint。平台工具输出不作为业务结果。

本切片构建器 29 项行为回归通过；与 managed owner/control/launch 的 CLI 聚焦验证合计 5 文件 63 项通过。新增测试 strict TypeScript 检查、全仓 build/lint 与 CLI 文档检查（70 guides / 104 parsed examples）通过。已用生成器更新实现参考和 17 份 Harness capability 文件；未新增依赖。

真实主机使用 Flutter 3.47.8 为临时生成的 Android fixture 执行生产构建器；随后生产 native APK parser 核对摘要、包名与入口。40.881 秒（含 host 准备）通过，APK 91,123,939 bytes，SHA-256 `894eedb8afb96028e284e14b993d8fae55ed3d318f569a165c358abb083f99b4`，包 `dev.fliwright.form_demo`，入口 `dev.fliwright.form_demo.MainActivity`，minSdk 24 / targetSdk 36，含 CAMERA/RECORD_AUDIO。主机证据保存在本机临时目录 `fliwright-owned-build-validation-exXvIb/result.json`；生成宿主已删除，APK 与结果保留在仓库外。此操作未连接设备，未 install、launch、修改权限或启动 Emulator。

### 26.3 后续完整接线

由 managed owner 冻结 project/entry/Flutter 路径/构建参数，消费本原语的 APK 到 `installApp`，再持有同一安装身份跨 attempt。Android SDK analyzer 路径须通过本机工具配置解析/校验，不能由 executor 的任意 IPC path 传入。首次新安装与已有同产物核验完成后再捕获权限基线。每次使用 stop/UID 确认 → prepare complete declaration → launch installed → core 验证/VM PID 绑定 → child 独立 readback；最终先 stop 再恢复/清理，不回落到 flutter run 重装。构建工作、安装工作和 Worker reset 的取消/错误保留必须在实际接线回归中验证。随后继续原 N5—N8 的平台权限、生物识别、相机/媒体和发布矩阵。


## 27. Android 已安装 App 的 managed 接线与 reset 前清理

本节实现第 26.3 节的启动接线，并补充前序计划未明确拆分的“清理 App 与释放设备”边界。它完成一段可测试的运行时链路，不将 N4—N8 的平台与硬件验收标记完成。

### 27.1 owner 接管构建、安装与每次启动

- `prepareNativeRun` 立即快照 supervisor 提供的 target、Flutter 路径、build args、required capabilities 与 keepalive 设置，再解析项目配置。实际 discovery 的 `NativeDeviceSession.deviceKind` 决定 Android emulator 后端，调用方不能通过 readiness boolean 选择它。物理 Android 与 iOS 保留各自已有 launcher。
- `native.tools.apkAnalyzer` 是严格配置中的显式本机工具路径，跨配置边界保留并验证；不接受 executor 通过任意 IPC path 指定 analyzer 或 APK。缺失 analyzer 或 installed-session keepalive 冲突在构建/安装前报错并释放 owner。
- owner 先建立私有控制通道，不构建、不安装、不启动。第一个实际 attempt 消费第 26 节的 builder，将私有 APK 交给 `installApp`，比对构建/安装 SHA-256。后续 attempt 复用已验证安装，不重复 build/install。
- 每次 stop/UID 确认 → 现有只读 device scenario 准备 → installed Activity launch → Bridge/requiredCapabilities 验证 → 独立 VM 连接 `getVM.pid` 与 launch PID 比对 → owner 当前进程绑定 → 返回新 endpoint/generation。初次构建与后续准备共用控制协议的 600 秒总上限；底层安装/停止/启动仍各有 120 秒上限，协议总取消信号约束全链。
- CLI 直接将 retained owner control 交给 runner；Worker supervisor 同样创建并持有 control。私有 grant 只返回 delegation/control，executor 请求仍只有受校验 project identity，launch 配置来自 lease/supervisor。executor 不再为该后端包装另一个 Flutter daemon relaunch control。grant decoder 校验字段、lease token 与 loopback control，非法 control 不降级。
- 任一 build/install/hash/launch/Bridge/PID 失败封闭后续 attempt，不回落 `flutter run`。未确认的 host build-group cleanup 即使没有安装 APK，也使 quiesce 失败并进入隔离，阻止 reset/reuse。

### 27.2 将 quiesce 与 release 分开

`NativeDeviceSession.quiesce()` 和 `ManagedNativeRun.quiesce()` 关闭本次会话的后续工作，等待正在运行的控制/构建/平台准备，完成 App 清理，保留原 device lease。`dispose()` 幂等调用清理并最终 release。成功 quiesce 后不再创建 Adapter、准备或启动下一 attempt。

Native cleanup 使用独立于顶层取消的 signal 和总 deadline，包含正在进行的底层操作、Adapter disposal 和平台恢复。已安装 App 先核对原 APK/UID，再 force-stop，验证全部 UID 进程退出，移除本次 forwarding，恢复权限并只移除本次新安装。已有同产物 App 保留。安装身份变更或未知写入会隔离；不停止、不恢复、不删除替换后的 App。只用权限 primitive、未拥有安装的 caller 仍须先确认自己的 launcher 已停止。

Worker 在 executor 退出确认后中止 owner lifetime，等待 acquisition/preparation 和 quiesce，随后执行 reset，最后 release。15 秒 barrier 未完成或 quiesce 失败则不执行 reset，后续晚到的完成也不能补执行 reset；清理失败与 release 失败均保留。reset 失败会把原 owner 隔离后释放/保留恢复记录。设备租约在 App 清理与 reset 之间不出现空隙。

### 27.3 回归与证据边界

新增回归覆盖首 attempt 懒构建安装、配置快照、同 APK 两次启动、新 endpoint/generation、无 attempt 不写设备、hash/构建/安装/验证失败封闭、build 取消后等待真实结束、未知 host cleanup 传播、keepalive 冲突、物理设备分流、自动最终 stop、取消后的独立恢复、quiesce 后仍持有真实租约、Worker reset 顺序、阻塞/失败 quiesce 不 reset/reuse 及错误保留。

真实 WebSocket 对端覆盖 Bridge handshake 后独立 VM PID 读取、错误 PID/类型、缺失能力和取消。真实 Node executor 通过 supervisor IPC 获取私有 grant，直接向 retained owner 请求两次不同 endpoint/generation；control/lease token 不写 job/result。已有 stale-log 测试改为在日志读取后触发取消，避免 30ms 在文件操作阶段到期造成误报。

本节没有启动/修改个人或 Worker 设备，没有重试已知 Android HVF/mprotect 阻塞。真实 Android 混合流程与恢复证据仍缺失；已有 host build 与 iOS 混合 smoke 不能替代此接线的设备验收。检查结果：CLI 聚焦 8 文件 133 项、Native 全量 16 文件 108 项、Worker 全量 22 文件 105 项、Core 配置 11 项与 Vitest fixture 3 文件 4 项均通过。新增/变更测试的 strict TypeScript 检查通过；全仓 build/lint 通过，最终 CLI build 与全仓 lint 复核通过。CLI 文档 70 guides / 104 parsed examples 检查及 Harness 检查通过；重新生成 623 份实现参考、17 份 capability 文件，并同步 portable Skills。真实 executor grant 测试的最后扩展已单独复核通过，未增加依赖。Android fixture 配置新增可选本机 `FLIWRIGHT_NATIVE_APK_ANALYZER` 输入，managed emulator 入口需要它。

### 27.4 接下来必须补齐的交付

| 顺序 | 内容 | 完成判据 |
| --- | --- | --- |
| 1 | N4 完整权限声明与 child 独立观察 | 每 attempt 替换完整权限集合；遗漏项回到原始值；child readback receipt 绑定 build SHA/UID/VM PID/scenario/attempt/Adapter generation；重试、skip、取消、未知写入与最终恢复均验证。通过真实平台验收前高层 declarations 继续拒绝，无公开绕过开关。 |
| 2 | N5 平台混合流程 | 在可运行的专用 Android emulator 执行原生确认/取消与相机/麦克风权限允许/拒绝 → Flutter 业务断言 → 基线恢复，保留原始失败和残留检查。按支持版本配置验证 analyzer、permission flags 与 app-op。 |
| 3 | N6 生物识别 | 移除配置中的 boolean 自证基线；建立可观察 enrollment 与当前 challenge，测试 match/reject/cancel/lockout 和退出后的业务结果。Android 模拟器与 iOS Face ID/Touch ID 各自验证；iOS 无界面注入尚未验证，真机不注入匹配结果。 |
| 4 | N7 相机与媒体 | 分别报告 app-owned 固定结果、真实系统拍摄 UI、图库导入及镜头帧输入。移动端 seam 验收、media 所有权/清理、虚拟相机启动前来源与实际帧内容均须有独立证据；不可把导入图库当作注入摄像头。 |
| 5 | N8 可靠性与发布 | 每平台至少 20 次独立混合 attempt，记录原始成功率、p50/p95、故障与残留；授权 Android 真机/双设备隔离；补全 owner build/install/launch/verify/cleanup 的 Worker telemetry、打包/发布及用户文档验收。 |

已接通的控制通道不能替代上述权限 receipt 或平台事实。设备环境不支持的能力继续返回明确 unsupported，不用 mock 结果冒充系统硬件能力。


## 28. Android child 独立安装/进程/权限核验

本节推进第 27.4 节的 N4，完成 installed managed 链路的独立观察与 live readback。当前普通 attempt 仅替换为空权限声明；未开放高层非空 permissions、baseline、biometricBaseline、media 或 cameraSource。N4 的非空声明整合与 N5—N8 仍未完成。

### 28.1 已实现链路

1. retained owner 保留实际安装的 SHA-256、appId 与隔离 UID。每 attempt stop/UID 确认、只读场景检查后调用 `preparePermissions([])`，使遗漏项按底层完整替换语义回到捕获的原始值；返回的集合包含所有已跟踪状态。随后无重装启动并验证 Bridge 与 VM PID。
2. `ManagedAppLaunchEndpoint` 将 `{ url, nativeApp? }` 作为统一启动结果，普通 launcher 也返回结构化结果，无 string/对象双轨兼容。installed backend 的 `nativeApp` 仅包含安装/启动及权限预期，绑定 request attemptKey、可选 scenarioFingerprint 和 launchGeneration。控制协议服务端、child decoder 分别严格校验；非法字段、路径、readiness boolean、UID/PID/hash、重复权限、不一致或未知 flags 均拒绝。它是预期，不是可复用的准备凭据。
3. `NativeDeviceSession.inspectAppState(names)` 在实际 delegated lease 与跨进程操作互斥下读取当前单 base APK 摘要、User 0 隔离 UID、主进程 PID及声明的 camera/microphone grants/flags/default app-op；权限观察前后重新读取安装/进程身份。可与当前 Adapter 共存，不安装、不启动、不停止、不捕获恢复基线。空集合也核验 APK/UID/PID。`runAndroidPreparation` 返回结果前再次确认 owner fence 与取消，防止最后一条读取期间丢失所有权后仍返回成功。
4. Vitest 在正文前取得当前 VM PID、校验 native 进程绑定，再通过 child 自己的 owner 独立观察。core 单次 live handle 快照预期，绑定 attempt key/ID、实际 scenario fingerprint、managed generation、launch generation、Adapter generation 和 hashed device identity；await 后复核身份和取消。失败消耗 handle、阻止正文，不能重用旧报告。取消可结束对未返回观察的等待，底层 owner 仍跟踪平台工作到其真实结束。
5. 自动 fixture 保护未请求 driver 的普通正文；每次 retry 新建上下文并重新观察。timeline 初始化明确依赖 endpoint/attempt fixture，避免 retry 重新配置已经执行过操作的旧 RunSession。成功记录 `Android app readback` step，失败记录 setup 失败；报告只含状态、摘要与 generations，无 serial、APK 路径或认证 URL。动态 skip 仍完成连接、Adapter 与 owner 清理。

### 28.2 回归与证据边界

新增 core 回归覆盖单次消费、上下文/Adapter 变化、异步取消、安装与完整权限集合 mismatch、严格 metadata 和稀疏数组拒绝；真实 HTTP 控制验证双端 metadata 校验、过期 request 与失败后封闭。native 回归覆盖只读观察、APK/UID/PID 中途变化、split/其他 user/非隔离 UID/非法进程/固定 flags/自定义 app-op、取消、实际 parent/child 租约和最后一次读取期间的 owner fencing，observer disposal 无恢复写入。

真实 Vitest child 回归覆盖独立 APK/UID/PID/权限集合 mismatch、缺失观察 API 时正文不执行、无 driver 的普通测试、静态 skip、动态 skip、retry 的新 PID/launch/Adapter generations、失败后的释放及脱敏 timeline。平台工具结果在确定性测试中受控；这些子进程与租约证据不能称为 Android 设备业务验收，也不证明实际权限弹窗、有效镜头访问、指纹或 Face ID。

本节没有连接或修改个人/Worker 设备，没有重试已知 HVF/mprotect 环境失败。重复平台读取不是原子快照。高层设备声明仍由原 validator 提前拒绝，无新增 readiness 开关或绕过入口。

验证结果：Core 原生/场景/控制聚焦 6 文件 97 项通过；Native 全量 17 文件 122 项通过；CLI 聚焦 5 文件原 88 项通过，新增权限准备失败覆盖后相关 2 文件 14 项复核通过；Vitest 全量单 worker 23 文件 96 项通过，另 3 项预期失败；Worker 全量单 worker 22 文件 105 项通过。新增/变更测试的 strict TypeScript 检查、全仓 build/lint、最终 Core build 及 metadata 聚焦 28 项复核通过。已用生成器更新 625 份实现参考与 17 份 capability 文件；CLI 文档 70 guides / 104 examples 检查通过。

最终复查补上运行中整个 Adapter identity 对象被替换的回归：无场景、无 driver 正文也必须失败。fixture 通过 live identity getter 在 await 后读取当前 runtime，避免只比较旧对象引用；相关 Vitest 4 文件 11 项、变更测试 strict TypeScript 与 Vitest build 最终复核通过。Harness 检查通过。

并行验证中，Vitest 清理时限回归曾触发 child 的 6 秒外层上限，Worker 的进程组退出检查曾出现 EPERM。未改变这些测试或进程清理实现；对应聚焦复核及上述单 worker 全量复核均通过。两次原始失败保留为本轮验证记录，不宣称并行可靠性验收通过。

### 28.3 后续必须完成

| 顺序 | 内容 | 完成判据 |
| --- | --- | --- |
| 1 | N4 非空权限声明与恢复整合 | supervisor 从冻结场景解析完整声明，child 按实际场景比对全部 tracked permissions；补继承/遗漏、retry、skip、取消、未知写入和最终恢复的跨进程证据。入口在平台验收完成前仍拒绝高层使用。 |
| 2 | N5 专用 Android emulator 平台验收 | 可运行设备上走 maintained fixture：确认/取消、相机/麦克风允许/拒绝 → Flutter 业务断言 → 独立 readback → stop/原状态恢复；保存原始失败、flags/app-op、残留。通过后才按支持矩阵开放权限。 |
| 3 | N6 生物识别 | 观察 enrollment 与当前 challenge，替换 boolean 自证基线；分别验证 Android fingerprint 与 iOS Face ID/Touch ID 的 match/reject/cancel/lockout、业务结果和恢复。真机仍不注入匹配结果。 |
| 4 | N7 相机/媒体 | 分别验收移动端 app-owned seam、真实拍摄 UI、图库资源所有权/清理、启动前虚拟镜头来源与实际帧；四者独立报告覆盖。 |
| 5 | N8 可靠性、Worker telemetry 与发布 | 继续第 27.4 节原范围：每平台至少 20 次独立混合 attempt、原始成功率/p50/p95/故障/残留、授权真机与双设备隔离、owner 各阶段 telemetry、打包和用户文档。 |

本节不缩减第 23 节 N1—N8 的完整目标，不把 readback 接线或测试通过等同于全部原生测试能力完成。


## 29. 权限原始值持久化与宿主崩溃后的设备排除

本节补齐 N4 非空声明整合前发现的恢复前置缺口：原先权限原始值只在进程内保存，宿主崩溃后无法保留可审核的 baseline。当前补充写前恢复记录，不开放高层 declarations，也不将 N4 或 N5—N8 标记完成。

### 29.1 已实现的恢复边界

- 真实父租约提供私有 `permission-recovery.json` 路径，delegation 不携带该路径。`preparePermissions` 和 managed `stopApp` 只允许 retained parent；child 的只读权限/安装观察不产生 baseline 或写入记录。
- 原始 grants/flags 与隔离 UID 首次捕获后保留；后续完整声明替换记录全部 declaration、desired tracked set 和 observed。新增权限扩展 originals，遗漏权限恢复原值，不用当前值覆盖 originals。UID 改变时不向替换应用准备或恢复。
- `AndroidPermissionJournal` 记录版本、随机 journal identity、hashed device identity、appId、User 0、default package app-op 策略及 pending/verified 步骤。记录不含 serial、APK 路径、认证 URL、token 或原始工具命令。
- force-stop、grant/revoke、clear/set flags 均在派发前完成 pending checkpoint。临时文件以 0600 独占创建并 sync，首次以 exclusive hardlink 发布，后续核对原记录后原子替换并 sync 目录。已有、目录、符号链接或改变的记录不能被接管覆盖；读取有 no-follow/nonblocking/regular-file/大小限制。
- 平台 readback 成功后仍须持久化 verified checkpoint，才能宣告本次准备成功。保存失败、取消后的未知派发或 lost reply 封闭后续 mutation，保留隔离和证据，不盲目恢复或重放。
- quiesce 在原独立总清理预算及 device mutex 下确认 stop、恢复 originals，完成 owned app 清理，再删除本会话自己的 verified-restored 记录。release 即使未见 dirty marker，也拒绝残留权限记录，包括 dangling symlink，并保留记录与 lock。
- 没有自动恢复/重放入口。人工处理必须独立核对设备、安装身份与实际状态；删除记录或认定 PID 已退出均不代表状态已恢复。

### 29.2 验证与事实边界

新增回归在每个受控 pm 派发时读取生产记录，确认原始值/完整声明/pending intent 已存在，覆盖跨 camera→microphone 替换、遗漏恢复与最终移除。另验证纯观察不创建记录、force-stop 派发前记录 pending，只有 stopped readback 与 quiescence 完成后才移除记录。覆盖 lost reply、首次记录冲突、写入后的记录故障、取消期间真实状态已改变、readback 成功但 verified checkpoint 提交失败、UID 改变及父/子 mutation 边界。直接租约回归验证没有先前 quarantine 时仍保留普通及 dangling-link 权限记录。

真实 Node 子进程加载实际生产 `DeviceLease` 与 journal 源码，保存 pending 和 verified-but-not-restored 两种记录，在 IPC 确认后由测试宿主 SIGKILL。新 manager 拒绝接管 stale owner，原始 baseline 字节保持不变。这验证主机写盘、进程退出与租约排除；没有调用真实 ADB，也不是 Android 权限 UI、业务结果或崩溃后自动恢复的设备验收。

验证完成：Native 全量 18 文件 136 项；CLI installed/managed/control 聚焦 4 文件 41 项；Worker ownership/IPC/processes 聚焦 4 文件 25 项；Vitest independent readback/device scenarios/native fixture 聚焦 3 文件 9 项均通过。变更测试 strict TypeScript 检查及全仓 build/lint 通过。已重新生成 626 份实现参考及 17 份 Harness capability 文件；CLI 文档检查 70 guides / 104 parsed examples、Harness 检查和本切片 diff whitespace 检查通过。最终新增的 stop/只读记录回归与 Native 全量、变更测试 strict TypeScript 再次通过；未新增依赖，未提交 dist。

### 29.3 后续交付与发布门槛

| 顺序 | 必须补齐 | 完成判据 |
| --- | --- | --- |
| 1 | N4 非空声明的完整链路 | supervisor 从冻结场景解析完整 declaration；每 attempt 包括普通 peer 都替换完整集合；child 按实际场景核验全部 tracked 状态；结合 durable originals 验证继承/遗漏、retry、skip、取消、未知派发与最终恢复。不得增加 readiness boolean 或公开 gate bypass。 |
| 2 | N5 可运行的专用 Android emulator | maintained fixture 完成确认/取消、相机/麦克风 prompt/deny/grant → Flutter 业务断言 → 独立 readback → stop/原始状态恢复；保存 OS/tool 版本、flags/app-op、原始失败与残留。通过后才按实际支持矩阵开放非空权限。 |
| 3 | N6 生物识别 | 实际 enrollment 与当前 challenge 观察替换 caller boolean；Android 指纹、iOS Face ID/Touch ID 分别验证 match/reject/cancel/lockout、业务终态及恢复。iOS headless 注入仍 unverified，真机由真人完成。 |
| 4 | N7 相机/媒体 | 移动端 app-owned seam、系统拍摄 UI、图库所有权/清理和启动前虚拟镜头来源/实际帧分别验收，不合并覆盖。 |
| 5 | N8 可靠性与发布 | 每平台至少 20 次独立混合 attempt；原始成功率、p50/p95、故障/残留；授权真机和双设备隔离；owner 阶段 Worker telemetry、打包及用户文档。 |

本轮不重试已知 Android Emulator HVF/mprotect 启动失败，不操作个人或 Worker 设备。现有 Android host build 和 iOS 四项 smoke 不能替代上述 Android managed 链路、硬件或 20 次可靠性验收。第 23 节 N1—N8 的完整目标保持不变。


## 30. 冻结权限声明传递与 child 实际场景语义核验

本节继续 N4 的声明整合。没有打开现有 validator，没有 readiness boolean 或公开 gate bypass；实际 CLI/Worker 非空 permission 场景仍在任何 build/install/stop 之前拒绝。本节完成的连接和低层真实子进程回归不能等同于非空高层用例已获平台支持。

### 30.1 已实现

- core 提供纯 `parseAndroidPermissionDeclarations`、`getAndroidScenarioPermissions` 与 `assertAndroidPermissionDeclaration`。只接纳唯一 camera/microphone 的 granted/denied/prompt，拒绝未知字段、状态、权限、重复、稀疏数组及显式 null。解析返回独立值快照；输入是已解析继承的场景，无 device/permissions 表示完整空替换。
- `startManagedAppControl` 对本次请求核对自身冻结场景 fingerprint 及现有发布门槛，stop 后将同一已验证场景交给 preparation。installed callback 从此场景提取完整声明，替换原硬编码 `[]`。普通 peer 仍传空集合；没有从 executor 接受任意 permission payload。非 installed launcher 的 CLI/Worker wrapper 只向 owner 转发原 request/signal。
- 父 `NativeDeviceSession` 在调度异步平台工作之前严格验证并复制整个声明，调用方在 await 前改数组不能改变已排队的目标。底层 preparation 使用同一 decoder，保留原 grants/flags 与完整替换恢复策略。
- child binding 接收自己的实际 `TestScenario`，自行计算 fingerprint 和声明，不接受父 owner 额外传入声明。readback 同时检查请求的 grant 和 USER_SET/USER_FIXED 语义；即使父 expectation 与平台 observation 相互一致，只要违反实际声明也不能发放 receipt。声明遗漏项仍比对父 owner 的全部 tracked 原始预期，不把空声明解释为忽略旧状态。
- core 对声明取快照，在独立读取前后重新核对。fixture 的 live scene/declaration getters 在 await 后读实际对象；修改或替换场景 layers 不能沿用旧 fingerprint。原安装/UID/VM PID/attempt/managed/launch/Adapter generation 绑定继续生效。

### 30.2 回归证据及限制

core 回归覆盖继承后的提取、空替换、严格解码、三种状态语义、遗漏 tracked 状态，以及父/平台一致但实际声明不一致和读取期间变化。CLI 真实 HTTP control 回归在控制建立后替换磁盘配置，证明仍使用冻结场景；未验收权限被拒绝且不再 stop/prepare。

Native 回归将继承的 camera granted 声明执行两次，切换到 microphone denied，再执行无场景 ordinary peer。每一轮实际派生独立 Vitest 子进程，导入生产 NativeDeviceSession/DeviceLease 源码、获取父 delegation，通过生产 inspectAppState 与 core live readback 读取。父平台 executor 仅提供受控包/进程/权限事实，子进程通过本地工具通道独立请求，未复用父读取的 permission result。原始 baseline 不变，新增 microphone 扩展 tracked set，遗漏 camera 与最终 microphone 恢复原值，最终 lock/记录清理。另覆盖非法输入在任何平台调用之前失败和排队后 caller 改值不改变目标。

fixture 直接回归验证实际场景语义和等待期间的场景变更，保留失败 timeline 节点并关闭 owner；既有真实 Vitest child 测试继续验证正文阻止、无 driver、retry/skip 及 Adapter replacement。直接回归不经过高层开放门槛，属于内部契约验证，不是向用户开放的绕过入口。受控进程/权限事实和测试构造的 generation 不证明实际 Android 启动或硬件结果。

验证完成：Core 声明/readback/场景/control 聚焦 4 文件 71 项、Native 全量 18 文件 138 项、CLI 聚焦 5 文件 47 项、Worker ownership/IPC/executor/processes 聚焦 5 文件 42 项均通过。Vitest 全量单 worker 24 文件 100 项通过，另 3 项预期失败。真实 child 权限恢复回归扩展到四轮后，相关 Native 14 项再次通过。变更测试 strict TypeScript、最终全仓 build/lint、CLI 文档 70 guides / 104 parsed examples 及本切片 whitespace 检查通过。已生成 628 份实现参考及 17 份 capability 文件。实现过程中新增测试先暴露实际场景未传递、声明 await 期间变化未被发现；均完成修复及复核。消费者扩大回归另发现通用 callback 的第三个场景参数意外传到旧 owner 方法，现由 CLI/Worker wrapper 显式只传原 request/signal，相关回归通过。未新增依赖，未提交 dist。

### 30.3 继续顺序

1. 在可运行的专用 Android emulator 验证已安装 fixture 的权限准备、真实系统 UI/应用读取、独立 child readback、最终 stop/恢复；明确当前 OS 对 grants/flags/default app-op 的实际行为。现有 HVF/mprotect 阻塞条件不变时不重复启动。
2. 补齐完整 N4/N5：实际非空高层场景的 retry、skip、取消、lost reply、未知写及残留矩阵；通过平台验收后，才能按实际支持组合逐项修改入口 gate。不得用本节纯解析或受控 executor 测试替代平台验收。
3. N6 生物识别 enrollment/challenge 与各自平台结果；N7 移动端 app-owned seam、系统相机、图库归属和虚拟镜头实际帧；N8 每平台至少 20 次混合 attempt、原始成功率/延迟/失败/残留、授权真机及双设备、owner Worker telemetry、打包与用户文档继续按第 23 节完整范围交付。


## 31. Worker retained owner 阶段时间轴遥测

本节补齐 N8 中 owner 阶段可观察性的定义。Worker executor 的时间轴不能只覆盖测试 runner；设备 owner 在 executor 外执行的构建、安装、每 attempt 启动/验证及最终清理必须由持有 owner 的 supervisor 记录到同一份 Worker timeline。此遥测用于定位生命周期停在哪一步，不作为设备状态或业务成功的证明。

### 31.1 事件范围与关联

- supervisor 在 owner acquire、build、install、stop、prepare、launch、verify、cleanup、release 的实际边界直接写入现有 timeline channel/recorder。只为实际发生的工作记录 span；已有匹配安装而跳过安装时，不伪造 install span，实际安装身份由 verify span 表达。
- run 级 acquire/build/install 事件关联当前 Worker execution attempt。每次 managed app attempt 增加一个父级 `native.attempt` span，以 supervisor 接受请求的顺序编号；该 attempt 的 stop/prepare/launch/verify spans 作为子 span。attempt 身份来自受校验的 supervisor 请求，不接受 child 自报值。quiesce、device reset、release 归属 run cleanup，不挂到最后一个测试 attempt。
- 为 `native.attempt` 和 attempt ordinal 扩展 Worker timeline contract、解析/展示模型及 UI。因现有 schema 对未知字段严格拒绝，新字段采用明确的新 schema version；Cloud/CLI/VS Code 双读旧版、新版 timeline，并仅写新版。历史数据没有 attempt 分组时仍可按 run 展示。
- 每个阶段至少记录 started 与 succeeded/failed/interrupted 终态、持续时间、允许的稳定错误 code；有界的失败消息使用安全枚举/模板，不透传 ADB、Gradle、Flutter、XCTest 原始输出。
- 时间轴不得写设备 serial/UDID、APK/fixture 主机路径、VM Service URL、认证 token、权限原始快照或生物识别数据。只写阶段、耗时、脱敏结果、attempt 关联和已有的设备摘要。

### 31.2 失败隔离与清理语义

- owner 阶段时间轴写入是尽力记录，不得改变构建、设备操作、quiesce、reset、release 的执行结果或顺序。recorder/channel 初始化失败、schema 拒绝、磁盘写入失败、IPC 超时和远端存储失败都只能降低 timeline quality 并登记 recording issue。
- 记录 started 失败时仍执行 owner 阶段；记录 finished 失败时仍返回或抛出原阶段结果。不得因遥测异常跳过 stop、权限恢复、App 清理、device reset 或租约释放。
- 业务/设备错误与遥测错误分别保留。最终 run summary 标记 timeline 为 partial/not_recorded，并给出容量、存储或投递问题；不能用遥测失败覆盖原始清理失败，也不能把缺少结束事件解释成 cleanup succeeded。
- supervisor 终止时，对仍打开的 owner spans 写入 interrupted/unknown（若 recorder 仍可用），否则由 timeline quality/open-span 诊断表达不完整；不能补造成功终态。

### 31.3 回归验收

1. 用真实 Worker supervisor + retained owner 测试正常路径：acquire/build/install → attempt stop/prepare/launch/verify → 多 attempt → quiesce/reset/release；断言所有阶段在统一 run timeline 中、attempt 归组正确且顺序与实际 side effect 一致。
2. 覆盖安装跳过、没有实际 attempt、普通测试失败、retry、取消、build/install/launch/verify 失败、executor 异常退出、quiesce 超时、reset 失败与 release 失败；每个已开始 span 只有真实可确认的终态，未知清理保持 interrupted/unknown。
3. 注入 timeline channel 拒绝、recorder 磁盘错误、Worker IPC 断开及远端 flush 超时。断言原 owner 操作、取消传播、清理和租约释放仍按既有约束执行，业务错误保持主错误，timeline summary 反映 partial/not_recorded。
4. 验证敏感值不会出现在 worker-timeline.jsonl、timeline API、Cloud/CLI/VS Code 序列化视图及失败消息中；兼容读取现有 schema 版本产物。

完成条件：Worker supervisor 能用时间轴回答构建/安装/每次启动与验证/最终清理分别何时开始、耗时多少、结果如何、属于哪次 attempt；遥测关闭或失败时，设备清理和 owner 所有权仍有与无遥测相同的执行语义。完成这些契约和回归后，仍需另行通过 N8 的每平台 20 次设备 attempt 与平台矩阵，不能以 telemetry 测试代替发布验收。

### 31.4 当前状态

已交付的遥测接线：

- Worker timeline event contract 新增 v2，同时继续解析历史 v1。supervisor recorder 写 v2；Cloud event validation/store 接受两版。
- `ManagedNativeTelemetry` 为 stop、build/install、设备准备、launch 和 verify 发出 attempt hash；attempt key 本身不落盘。Worker supervisor 以 hash 建立 run-local `native.attempt` ordinal 父 span，把 owner 阶段写入同一 timeline，并在 verify 成功或阶段失败/中断时结束分组。
- Cloud span 投影允许原生 attempt 下的原生阶段子 span；Worker 时间轴显示 attempt ordinal、每阶段耗时和结果。run 级 acquire/cleanup/release 仍独立归组。
- collector/helper 回归验证多阶段分组、第二次 attempt、失败关闭和 attempt key 不泄漏；CLI 回归验证首 attempt build/install/stop/prepare/launch/verify 与 retry 各阶段关联；Cloud 投影/UI 覆盖新版事件，旧版事件仍可读取。

本轮补充了一条跨 `WorkerNativeOwnership` 的故障注入回归：timeline channel 对全部写入拒绝时，native attempt 事件仍由 best-effort 队列吸收，supervisor 依序完成 quiesce、reset、release。`executor-launch` 的 retained owner mock 也补齐了 `prepareAttempt` 契约。聚焦验证为 managed-native timeline 2 项通过、Worker 包 lint 通过。

仍需完成：用真实 Worker supervisor 路径验证 build/install/launch/verify 失败、取消、executor 异常退出、无实际 attempt、quiesce/reset/release 失败及 recorder/IPC/远端投递故障；确认所有终态、timeline partial 质量与清理语义。当前测试证明 recorder 拒绝不阻断 owner 清理，但尚未覆盖磁盘故障、IPC 断连、远端 flush 超时与所有生命周期分支。单元及包级检查通过不替代这组监督器故障矩阵，也不替代 N8 的每平台 20 次混合 attempt、Android 真机/双设备或 Face ID、指纹、相机硬件业务验收。


## 32. app-owned 生物识别挑战观察与事件结果验证

本切片实现 N6 的 app 观察契约，尚未完成设备录入基线、实际认证 UI、受保护业务页面或锁定恢复。最初版本把 begin/complete 注册为远程方法而缺少 app-local 方法；本轮已修正，不能使用初版接口声称应用真实回调已验收。

- bridge `FliwrightBiometricTestCapability` 只远程开放 `reset/getStatus`；应用通过本地 `beginChallenge/recordRejection/completeChallenge` 报告实际平台回调。generation 隔离迟到回调，最多 16 个唯一 challenge，每 challenge 最多 32 个非终态 rejection。非匹配事件保持 pending，终态分别是 match/reject/cancel/lockout/error。
- core `BiometricTestController` 校验严格状态形状、唯一 portable ID、pending/终态互斥与 rejection 序号范围。`exerciseChallenge` 等待 pending 后单次派发平台 callback，等待实际终态并记录单独的 assertion；`exerciseRejection` 等待非终态序号增长并确认仍 pending，之后允许同一 challenge 继续匹配。acknowledgment 本身不构成结果证明。
- 排队、平台 callback、状态读取与轮询使用同一总预算；callback 接收剩余 timeout/signal。回包丢失或 acknowledgment 后没有可观察回调时不重放，并围栏后续事件。回调结果不同于预期时失败，不自动修正 app 状态。
- Vitest fixture 传入 task signal，每 attempt 新 generation；teardown 检查未解决 challenge 并清理匹配代次。正文错误与清理错误均保留，未解决 challenge 的动态 skip 必须失败。reset 仅清除观察状态，不关闭 OS prompt、不确认平台工作退出；owned lifecycle 仍负责 stop 和恢复。
- timeline 对 app 观察及断言使用 Flutter `app-test-seam`，设备事件维持 native metadata。已用同一 RunSession/endpoint + NativeRuntime 组合测试验证两者不互锁、分别记录；受控 Adapter 不是设备验收。
- 移除 native config 的 `baselineVerified` 布尔信任入口，无兼容通道。候选 enrolled/unenrolled IDs 不代表录入证据；Android 模拟器 fingerprint 返回 unverified/not ready，真机注入 unsupported。两种平台都需设备绑定的 enrollment/boot/OS/baseline/challenge 及恢复证据后才能开放能力。

本轮新增/更新回归覆盖 app-local 方法、远程不能伪造完成、迟到回调/旧 teardown、非终态拒绝后匹配、lockout、不匹配、lost reply、无回调、排队总预算、取消、严格协议、子 worker 的失败/skip/后续 attempt 隔离。运行的 TypeScript/Dart 测试只证明观察、调度及配置契约；没有运行 Android 或 iOS 生物识别硬件专项。现有 iOS Simulator dirty lease 没有清除，个人/Worker 设备没有被操作。

验证证据：core 相关 5 文件 100 项通过（其中 controller 16 项）；native 全包 18 文件 139 项通过；Vitest 全包单 worker 25 文件 101 项通过，另 3 项预期失败；bridge 生物识别/相机共 11 项通过，新增 Dart 源码与测试 analyze 无问题。受影响 TypeScript 测试 strict typecheck、全仓 build/lint、Harness 与 whitespace 检查通过。已生成 631 份实现参考和 17 份 capability 文件，未新增依赖或提交 dist。独立测试类型检查另修正 NativeDoctor mock 的 readonly argv 标注，不改变 doctor 行为。

剩余范围继续按第 23 节：N4/N5 Android 真实权限与恢复矩阵；N6 可信 enrollment 与 pending/平台事件/业务终态/锁定恢复（含失败事件序号及平台错误细节）；N7 移动端相机接缝、真实拍摄 UI、图库资产归属和虚拟镜头帧；N8 真实 Worker 故障矩阵、每平台 20 次独立混合 attempt、真机与双设备验收。不能用本观察器或受控 Adapter 替代这些验收。

## 33. 补齐启动诊断、显式恢复与交付顺序

本节作为后续执行入口；第 23 节 N1—N8 的目标保持不变。设计细节见[设计第 14 节](../specs/2026-11-03-native-device-automation-design.md#14-补充契约失败诊断与显式设备恢复)。不依赖 Appium/WDA，不新增框架或依赖。

### 33.1 启动诊断：已实现

此前 managed child 只获得泛化 preparation failed，无法区分场景核验、构建、安装、停止、设备准备、app 启动和 VM endpoint 验证。本次 core 为每次请求提供受运行时校验的固定 phase reporter；公开错误只携带阶段及 outcome may be unknown，不复制原始异常、cause、VM URL、token 或路径。原始错误仍交给 supervisor-only onError；observer 抛错不改变围栏/清理。deadline 在底层 work 未返回时也使用当时阶段，work 继续被追踪，后续写仍被拒绝。

CLI 的 ManagedAppRun 标记 frozen scenario validation → stop → prepare → launch；finite launcher 在等待 VM/Bridge 前切换 verify-endpoint；installed Android 额外区分 build/install/stop 与 launch/verify。Worker 消费相同 control；其 resolver 内尚未拆开的子步骤保持现有粗粒度，未声称已获得完整细分遥测。

回归覆盖：真实 loopback control 的阶段错误、原始错误仅交 supervisor、非法 phase 不外泄、未返回平台 work 的 deadline；CLI 各阶段失败、installed build/install/stop/prepare/launch/verify/产物摘要失败的准确阶段、写不重放及后续 attempt 围栏。修正 managed-native-launch 回归：关键断言移到 CLI mock callback 之外，防止 callback 的断言错误被 CLI 转成失败退出码后误判测试通过。验证范围与设备复核结果在本节末记录。

### 33.2 显式设备恢复：待实现

当前 quarantine 拒绝复用是已实现的保护。本节最初只补全契约；后续只读 inspection 和内部 claim 已按第 34 节实现，后续 Runner-only restore 已按第 46/47 节交付，Android 和通用 clear 不开放。不能把读 ps、删除 dirty 或新建另一设备记作恢复交付。

| 步骤 | 所属模块与交付 | 必须拒绝或保留的情况 |
| --- | --- | --- |
| inspect | native 只读读取 owner/delegate/operation、恢复记录与设备事实；生成摘要，敏感记录留在本机 | 记录损坏/符号链接/缺失、不完整 baseline 不推断为干净 |
| claim | native 获取与普通 acquisition 共用排斥的恢复 claim；CLI/Worker 不另写一套锁 | 任一旧 owner/delegate/operation 存活；并发恢复；身份/记录在检查期间变化 |
| reconcile | 核验 owned 主机进程组与 Simulator/emulator 内进程均退出，复查安装/UID/产物及资源归属 | PID 消失不能单独证明清理；不向替换 app 或未知资源写入；不重放未知 mutation |
| restore | 按已知原始值恢复权限/owned 资源；必要时使用已验证、版本化专用设备基线 | 没有可验证原始值、无法定向清理媒体、录入状态不明时继续隔离 |
| verify/release | 独立 readback → 持久化恢复完成 → 移除本次恢复记录/claim → 解除隔离 | 恢复失败、取消、deadline、回复丢失或写盘失败均保留证据和隔离 |

必须覆盖 dirty 无 lock、stale owner、active delegate/operation、进程 PID 复用、损坏记录、安装身份变化、恢复中取消/崩溃及互斥。可重复设备验收为故障 → quarantine → recovery → 新 attempt，不以新 readiness boolean 替代证据。若销毁本次新建的临时设备，必须核验 owned work 退出并记录销毁；这不是旧设备已恢复。

### 33.3 从当前状态继续

| 顺序 | 工作包 | 具体退出条件 |
| --- | --- | --- |
| 1 | 运行基线与恢复 | 保留既有隔离设备证据；用干净专用设备复核 managed cold start 与确认/取消；实现 33.2 并完成故障到新 attempt 的设备闭环 |
| 2 | N4/N5 Android 权限 | 在可运行专用 emulator 核验真实 grants/flags/default app-op，再跑 camera/microphone prompt/grant/deny → Flutter 结果 → child 独立 readback → 原状态恢复；补 retry/skip/普通 peer/取消/lost reply；按通过组合逐项开放高层 gate |
| 3 | N6 生物识别 | Android 指纹录入配方与设备/boot/OS/基线证据；app 本地真实挑战与平台错误；match、非终态 reject、cancel、lockout/fallback、恢复及业务页面逐项验收。iOS Face ID/Touch ID 先证明公开定向、headless 与双设备路径；未通过继续 unverified |
| 4 | N7 相机 | 移动端 cameraTest 固定结果的预览/取消/错误/重拍/本地上传接收器验收；再分别完成真实拍摄 UI、图库导入/资产所有权/清理、Android preboot source/实际帧；各层独立报告覆盖 |
| 5 | N8 故障、稳定性与发布 | 完成 31.4 的真实 Worker supervisor 故障矩阵；每平台至少 20 次独立混合 attempt，保存原始失败、无重试通过率、p50/p95 与恢复成本；授权真机、双设备隔离及打包/用户指南通过后才发布对应支持矩阵 |

Android emulator 的 HVF/mprotect 条件不变时不重复启动；继续可独立完成的恢复契约、回归、iOS 移动端接缝与 Worker 故障分支。不能用这些工作替代 Android 权限平台验收，不能将相机测试接缝解释成镜头注入，不能将生物识别观察器解释成硬件模拟支持。

### 33.4 本次验证与保留证据

真实设备复核使用本次新建的专用 iOS 26.5 Simulator；未操作个人设备，也未移除此前专用设备的 quarantine。CLI 使用 native managed-start、120 秒 VM port 等待上限、180 秒 test timeout；冷启动后执行确认/取消，两个实际用例均通过，另两个未选择的麦克风用例为 skipped。canonical run 为 `run-2026-11-03T14-39-17-938Z`，每项有 Flutter tap → native click → Flutter 结果断言，两个 Adapter generation 不同，证据完整。本次不重测麦克风权限基线或将其算作新增通过。

同一临时宿主补入维护中的 camera entrypoint/PNG、既有 camera.empty 命名场景及原 E2E 用例后，`run-2026-11-03T14-43-58-967Z` 在 iOS Simulator 通过：portrait 预览 → cancel 保留选图 → error 提示且保留选图 → retake 替换 → 本地 upload receiver → 队列消费与代次清理。timeline 明确 coverage=app-test-seam，证据完整；未验证网络上传、权限、系统快门、图库、虚拟/物理镜头。首次相机调用因临时宿主未完成源码/场景 staging 失败，`run-2026-11-03T14-43-14-537Z` 和原输出保留，不从样本中删除。可移植复现步骤已补入 demo README。

上述 canonical runs 位于本机默认运行根 `~/.fliwright/-private-tmp-fliwright-native-acceptance-20261103/runs/`；本机 `/tmp/fliwright-native-cold-validation-20261103/acceptance.json` 保存原始失败/成功索引、维护源码/图片摘要与 cleanup 引用。清理在该新设备的正常 device lease 和 operation mutex 下确认目标 app/Runner 与关联主机进程不活跃，再 shutdown/delete；已复查设备不存在并释放租约。既有 dirty 设备的隔离标记继续保留。这是临时资源销毁，不是 33.2 recovery 已实现或旧设备已恢复。

本次回归：core 全量 111 文件 1152 项通过；CLI 聚焦 6 文件 55 项通过；Vitest managed/cleanup fixture 聚焦 2 文件 3 项通过；Worker retained owner/IPC/timeline 聚焦 3 文件 16 项及 executor launch/timeline/processes 聚焦 3 文件 29 项通过。修改测试的 strict TypeScript、全仓 pnpm build/lint、Harness 和 whitespace 检查通过；生成 632 份实现参考及 17 份 capability 文件。未增加依赖，未提交构建产物、本机配置或凭据。上述 smoke 和回归不满足每平台 20 次稳定性、Android 权限、完整生物识别/相机或真实 Worker 故障矩阵；完整原生测试能力仍为实施中。

## 34. 只读恢复检查、内部独占 claim 与恢复证据保留

本节实现第 33.2 节的本机 inspection/claim 基础及一个释放漏洞修复。完整平台 restore、readback、持久化成功与解除隔离尚未实现，不能将本节测试或 CLI 检查视为设备已恢复。

### 34.1 已实现

- native 公开 `inspectDeviceLease({ platform, deviceId, rootDir? })`；CLI 新增 `native recovery inspect`，由相同项目/环境配置解析明确设备。检查不创建 storage、不 acquire、不开工具、不启动 Runner，不要求在线设备或 VM URL。
- 输出 schemaVersion、deviceKey、evidence fingerprint、owner/delegate/operation/recovery 的 absent/live/exited/invalid、本机记录状态和固定 issue codes。所有者 token、原始记录/任意错误文本、路径和原始设备 ID 不返回。PID 活跃即保守拒绝接管，不从 PID 推断是原进程或已恢复。`present` 只表示有界 JSON object 可读，不证明 journal 的平台 schema/基线可恢复。
- 已知记录以 no-follow/nonblocking 文件打开，限制 32 KiB，拒绝非普通文件和多 hard links；不跟随 root/lock/process/recovery 目录的符号链接。未知条目、缺失/损坏 owner、oversize/非法 JSON、变更的 enclosing 目录均保留并报告。fingerprint 绑定记录内容及文件/目录身份；不是 caller readiness boolean。
- 内部 `claimDeviceRecovery` 只在完全相同的已检查证据上 reserve，拒绝 live parent/delegate/operation、invalid evidence 和现存 recovery claim。它使用同一 host/platform/device key；普通 acquire 在创建 lock 前后检查 recovery reservation，关闭无旧 lock 场景下的竞争窗口。
- claim 执行前后核验原始证据及独占 claim 的 token/文件和目录身份，有单次总预算与取消 signal，拒绝并发 work。取消/总预算到期及时拒绝调用方，但实际 work 保持跟踪；work 未返回时 release 失败且保留 claim；原平台错误和后置所有权/取消错误分别保留。claim release 仅删除本次已确认的 reservation，原 dirty/lock/app/permission 字节不变。崩溃 claim 不自动接管。
- 修复 DeviceLease.release：此前 app recovery record 仅在 dirty 同时存在时保留；现在只要 app/permission recovery record 存在（包括 dangling symlink）就拒绝 release，保留记录/锁并写隔离，避免无先前 quarantine 的恢复证据被递归删除。

### 34.2 回归与本机实际证据

确定性回归覆盖 absent storage 零创建、iOS ID canonicalization、敏感内容不返回、live owner、dirty 无 lock、重复 claim、outdated fingerprint、record/claim copy 替换、取消/超时、未返回 work、原错误与围栏错误并存、符号链接/hardlink/oversize/未知文件及无 dirty 时的 app record 保留。

真实 Node 子进程导入生产源码：owner SIGKILL 后保留 app/permission 原字节并获取/释放 recovery reservation；parent 退出但真实 delegated child 存活时，分别覆盖有/无 active operation 的拒绝；真实 recovery holder 阻止独立 manager acquire，SIGKILL 后留下 exited claim 并拒绝自动接管。这些测试只证明主机进程与文件排斥，不证明 Android/iOS 恢复命令或硬件状态。

本机真实 CLI 对此前专用 iOS dirty 无 lock 设备返回 quarantined / owner absent / quarantine present / 无格式 issues；复核 marker 的原始字节、inode 与 mtime 均未变化。输出和核验保存在本机 `/tmp/fliwright-device-recovery-inspection-20261103/acceptance.json`。未执行任何平台恢复或清除；旧设备仍被隔离，个人/Worker 设备未操作。

后续顺序保持第 33.3 节：按实际 journal 与设备资源归属实现平台 restorer，独立 readback 和 durable restored checkpoint 后才能解除隔离；补 crashed recovery claim 的显式恢复协议与完整故障 → quarantine → restore → 新 attempt 设备验收。Android 权限平台、N6/N7 硬件专项和 N8 Worker/稳定性矩阵仍未完成。

本切片最终验证：native 全量 19 文件 161 项（恢复专项 22 项）、CLI 聚焦 6 文件 47 项、Vitest native/readback fixture 单 worker 3 文件 9 项、Worker ownership/IPC/processes 4 文件 25 项均通过。修改测试的 strict TypeScript、全仓 pnpm build/lint、Harness 和 git diff --check 通过；CLI 文档检查 71 guides / 105 parsed examples，已同步 plugin；生成 638 份实现参考及 17 份 capability 文件。未增加依赖，未提交 dist、本机记录或凭据。测试只证明已描述的本机检查/排斥/证据保留契约，完整目标继续实施。

## 35. 正常安装 journal 完成与恢复实施前置条件

### 35.1 已修复的正常释放缺口

第 34 节将任意 app recovery record 纳入 release 拒绝条件后，默认 owner 路径暴露了缺口：AndroidManagedApp 完成卸载或保留既有安装后只写入 removed/stopped，没有移除自身 record，正常清理也会被隔离。原 AndroidManagedApp 集成测试将 recoveryPath 重定向到锁目录外，因此未检出该回归。

本次先将测试改为实际 DeviceLeaseManager 返回的默认 record 路径；新安装和既有安装均复现 quiesce 后 record 遗留，正常 dispose 失败。随后实现内部 AndroidAppJournal 和 AndroidManagedApp.complete：首次排他发布 v2 记录，绑定随机 journalId/设备摘要，后续写和完成校验 inode/内容/单 hard link/目录身份，有界 no-follow/nonblocking 读取。完成要求本实例已 closed、无在途 work 或 unknown outcome；NativeDeviceSession 在权限恢复/readback、owned forward/App 清理和 permissionJournal.complete 全部成功后才完成 app journal，设备排斥仍保留至 dispose。安装恢复记录不会被所有者之外的通用 rm 清除。

新增回归覆盖默认锁目录的新/既有安装、quiesce 后排斥和 dispose 后可重新 acquire；提前 complete、取消、byte-identical copy 替换、修改、hardlink、symlink、首次发布竞争；以及 App 已卸载但权限 journal 完成失败时继续保留 removed 记录/dirty/锁。另补真实 owner 入口顺序：安装记录被替换时，managed stop 在任何平台执行前校验并围栏，后续 dispose 不再停止、恢复或删除该会话资源。完整 native 测试为 19 文件 174 项通过。受控 executor 只证明顺序和文件/owner 契约，不证明 Android 设备验收。

### 35.2 后续恢复实现必须先补齐的内容

设计第 14 节现已明确证据缺口；不能直接把当前 v1 permission/v2 app JSON 解码为可恢复凭据，也不能为历史 dirty-only 设备构造 baseline。下一项按下表逐项实现并验收，避免只有一个调用方传入 verified 布尔值的 clear API：

| 顺序 | 所属模块 | 交付及完成条件 |
| --- | --- | --- |
| R1 | native ownership/平台工具执行 | durable 资源清单：稳定 AVD key 与当前 serial/boot/OS 映射；host child/group、Runner、log observer、forward 的派发/实际分配/退出证据。每项资源在派发前记录意图，未知分配不得推断归属；真实 SIGKILL 验证遗留资源可识别 |
| R2 | app/permission journals | 同一 owner/generation 关联安装摘要、package/user/UID、baseline；严格 version/形状/大小/普通 flags 校验；原记录不被恢复事务改写。旧/不全记录保持隔离，CLI inspect 显示固定不可恢复原因 |
| R3 | Android restorer | claim 下核验旧 host/group 与设备 UID 进程、安装/签名/摘要及精确 forward。按实际状态 reconcile，向相同安装恢复已捕获的原始 camera/microphone grants/flags；分别读取 default app-op/停止状态和基线，无未知 mutation 重放。损坏/替换/UID 变化/取消均保留证据 |
| R4 | recovery transaction/lease | 新恢复进度 journal 与 synced readback-completed checkpoint；带身份校验的原记录归档和 quarantine 退役。每个 fsync/rename/unlink 边界模拟崩溃，普通 acquire 始终被旧锁、dirty 或 claim 中至少一项排斥；crashed claim 显式接管协议另验 |
| R5 | CLI/Worker | 公共 restore 仅调用同一 restorer，绑定明确设备及被核验 fingerprint；无 force/通用 clear。冻结预算、取消、失败原因和恢复摘要；使用真实 supervisor 故障路径验证，而非只 mock 返回成功 |
| R6 | 平台验收与支持声明 | 专用 Android 设备完成故障 → quarantine → inspect → restore → 新 attempt，断言真实权限/进程/安装及原字节归档；iOS 单独建立 Runner/权限/整机基线恢复证据后再开放。无基线的历史 iOS dirty 继续保留 |

R1—R6 当前仍未实现/验收，本次未提供 restore 命令、未解除既有隔离、未操作个人设备。N4/N5 权限、N6 Face ID/指纹、N7 真实相机/图库/镜头帧、N8 Worker 故障与每平台 20 次稳定性目标按第 23/33 节继续，不因本次正常释放修复而降级。

本次最终验证：native 全量 19 文件 174 项、CLI installed/native 聚焦 4 文件 42 项、Worker ownership/IPC/processes 聚焦 4 文件 25 项通过。修改测试的 strict TypeScript、全仓 build/lint、Harness 与 whitespace 检查通过；生成 638 份实现参考和 17 份 capability 文件。未新增依赖，未执行平台恢复或设备验收。

## 36. Device operation 的受控 host process 证据

### 36.1 已实现

- 正常 DeviceLease owner、delegate 与 operation owner 写入后同步文件和父目录，避免进程被强杀后刚创建的锁目录缺少持久化 owner 记录。
- `runDeviceOperation` 通过内部 `AsyncLocalStorage` 建立只在当前 awaited operation 内有效的工具所有权 scope。设备 operation 中的受管 `executeTool` 先排他写入 mode 0600 的 `tool-recovery.json`，记录 schema、opaque resource UUID、operation token、owner PID 和预留阶段；启动独立 detached process-group wrapper 后先更新 gated / running 并 fsync，再由 wrapper 收到一次性 IPC 消息启动 actual tool。journal 不含 executable、参数、环境、stdout/stderr、URL 或设备原始 ID。
- wrapper 持有 stdout/stderr pipe 和进程组锚点；超时/取消/工具失败只发一次停止意图，等待 actual work、wrapper、pipe 及整组 active member 收敛，TERM 超时后对本实例持有的 group KILL。只有正常退出/readback 后持有者才写 settled 并删除自身 journal；任何清理失败将 `operation.lock` 与证据保留并由 DeviceLease release 隔离。组内未知未托管后代导致命令失败，不当作成功返回。
- inspect 新增 `hostTool: absent/live/exited/invalid` 并纳入 evidence fingerprint、claim 校验与报告。它验证 journal schema/token/owner 和 wrapper/process-group PID，使用有界 `/bin/ps` host inventory 发现同组存活后代；无 wrapper 但组仍有成员记为 live，异常/替换 wrapper 记为 invalid。Zombie-only group 视为 exited，不能因 `kill(pid, 0)` 的 zombie 误判永久占用。`hostTool` 不证明 Android/iOS app、Simulator、forward、媒体或权限基线。
- Inspector 仍不启动 ADB/XCTest/Runner，不创建存储或更改隔离；它为 host command ownership 使用本机 `/bin/ps`。原 recovery claim 即使在所有进程退出后也只可 release reservation，仍原样保留 dirty/app/permission evidence，普通 lease 仍拒绝 acquisition。
- Windows 继续使用原生 `execFile` direct-child 执行 ADB 等工具，并在调用前保存 journal。正常退出可确认 direct child 后完成自己的 journal；Windows 进程树 reader 尚未实现，遗留记录报告 `hostTool=invalid` 并拒绝 recovery claim。这样保留既有 Android Windows 正常执行，但不声明 Windows 崩溃恢复能力。
- 长驻进程通过相同 gated executor 写入独立于短期 operation lock 的 `native-tool-recovery.json`。父 lease 和 delegated lease 各自使用自己 owner 目录及 token；inspect 聚合 operation、lease 与 delegate journals，因此 session 初始化结束后仍能看到 xcodebuild process group。release 在 journal 未被正常完成/删除时保留原锁并写入固定 quarantine reason。XCTest session shutdown 后取消受管 xcodebuild process group、等待 executor 完成 group/pipe readback，再调用 simctl terminate 并读取 launchctl process list；host process journal 只证明 host group，不证明 Simulator target/Runner 或 app 状态。

### 36.2 回归与范围

新增 NativeToolOwnership 子进程回归及生产 source-graph compiler。它递归编译当前 DeviceLease/ToolExecutor/OwnedNativeTool/Recovery 实际 TS 源码并在独立 Node 子进程加载，替代“只编译单个 DeviceLease 文件”的过时测试夹具。覆盖命令派发前 evidence、无敏感数据、成功后 journal/operation 同步移除、既有 journal 拒绝执行、取消后的实际子进程组回收、不托管后代不能返回成功、owner SIGKILL 后真实 wrapper+tool 的组检测/claim fencing，以及 wrapper 本身退出而 tool 后代仍存活时拒绝接管；待进程组退出后可检查/claim 但不清 quarantine。新增 XCTest Runner 生命周期集成回归，以本地伪 xcodebuild / xcrun 验证 lease 级 journal 从 ready 持续到 confirmed teardown；再以实际 `startXctestSession` source-graph 子进程触发 owner 与 wrapper SIGKILL，确认遗留 group 阻止 claim，整组退出后才开放 claim；另覆盖 delegated long-lived tool 的 inspect 与正常清理。migration 后 delegation、permission crash、recovery crash 子进程测试都加载当前 source graph。

不得将此能力写成完整主机或设备恢复：host xcodebuild process group 已纳入 owner journal；Simulator 内 XCTest target/Runner UID、启动后残留状态、ADB `forward`、VM endpoint 与媒体/录入资源仍没有共同的 durable provenance 和 platform restore transaction。因此 R1 仍部分完成，R2—R6 与 N4—N8 按计划未完成；Windows 进程树核验也未交付。已有历史记录没有 retroactive tool provenance。接下来先扩展 host crash 矩阵，并针对实际 Simulator Runner readback、Android forward 及 app/permission journals 建立各自可验证的资源身份，再实现 restore/recovery transaction。

本切片验证：native 全量 20 文件 181 项通过；CLI 全量 46 文件 448 项通过。ownership/recovery/lease/permission 聚焦 5 文件 54 项和 strict TS 对新增/修改子进程测试通过。全仓 build/lint、CLI 71 guides / 105 examples docs check、feature docs 638 references、capability 17 files、Harness 和 `git diff --check` 通过。plugin checker 的 CLI child test 环境统一注入 `FLIWRIGHT_RUNS_ROOT=/tmp/fliwright-plugin-check-runs`，导致依赖项目配置/独立运行目录的 5 项 CLI 测试失败（app-inspect、record-replay 两项、run、session）；同一 CLI 全量套件不带该覆盖变量复跑 46/448 通过。`node scripts/check-codex-plugin.mjs --skip-cli` 返回 0：manifest、bundled skills/source parity 均通过；official plugin validator 脚本在主机不存在，属于 warning。

本轮补齐 XCTest 长驻 host 进程证据后，native 全量为 21 文件 186 项通过，CLI 全量 46 文件 448 项通过。新增真实子进程 owner SIGKILL / recovery claim 回归、delegated long-lived tool 回归、fake xcodebuild / xcrun 正常生命周期集成与 `startXctestSession` owner-crash 集成；全仓 build/lint、CLI 71 guides / 105 examples check、feature docs 638 references、Harness capability 17 files、`node scripts/verify-harness.mjs`、`node scripts/check-codex-plugin.mjs --skip-cli` 与 `git diff --check` 通过。无需真实设备或新增依赖。插件官方 validator 仍未安装；真实 Simulator / Android 权限恢复、biometrics、camera 和 Worker 稳定性验收仍按 N4—N8 未完成。

## 37. Android recovery journal 的严格 inspection

`inspectDeviceLease` 现在在 Android 路径中调用独立 journal schema 校验器：只接受 app v3 与 permission v2 的严格字段、UUID、摘要、包名、UID、普通权限 flags 和有界列表；已知旧版 v1/v2 可识别为 legacy，但不能授权 claim。有效记录还必须绑定当前 lease key、owner token generation 和所选 Android device digest。app 与 permission 两份记录同时存在时，inspection 校验 device/owner binding、package、UID，以及 permission journal 捕获到的 APK 摘要和 session 安装归属；冲突以固定 `inconsistent-android-records` issue 返回，并进入 evidence fingerprint。

新增真实生产 lease 子进程用例：一致的 owner-bound app/permission 记录在 owner SIGKILL 后允许内部 claim，同时保留原字节；package、UID、APK 摘要、session 安装归属或 device digest 冲突的绑定记录拒绝 claim；严格符合旧 schema 的 journal 被识别为未绑定并拒绝 claim。native 全包 22 文件、199 项通过，native TypeScript lint 通过。feature reference 已从生成器更新。

这一步只补 R2 的 Android 本机记录识别与跨记录关联，不代表可恢复 baseline 或实现 R3 Android restorer。当前 claim 仍只能占有/释放 reservation，不能写平台状态、归档原始 journal、完成恢复 checkpoint 或清 quarantine。后续先补可恢复资源的 durable provenance 与失败恢复事务，再做专用 Android 设备上的故障 → inspect → restore → 新 attempt 端到端验收；Face ID/指纹注入、相机实际帧和 N8 稳定性矩阵仍未完成。

### 37.1 Permission journal 写入与恢复语义

permission journal 的后续 checkpoint 和 complete 现在核验原始文件身份、精确字节、单 hard link 和 enclosing directory 身份；有限 no-follow/nonblocking read 同时检查读前/读后/路径身份，拒绝 byte-identical copy、symlink、hardlink 和目录替换。首次发布仍排他且同步文件/目录。checkpoint 在首次 await 前深拷贝输入，拒绝 caller 注入安装/owner 元数据及未知字段，绑定 managed installation 的 UID/摘要/归属，保留已捕获 baseline，仅允许增加未记录过的权限。preparation/managed stop 在平台调用前核验 journal；失去所有权后围栏、隔离且不重放写入。

schema 校验现同时核对 baseline、desired 与完整声明的权限集合和状态含义；verified readback 必须有对应观察，restored 必须与原始状态一致，写步骤必须绑定已跟踪的权限。permission journal 缺少安装摘要或配套 app journal 时报告 `incomplete-android-installation`，拒绝 recovery claim。低层接口中未绑定安装的 journal 仍可完成其正常 owner 生命周期，但不能被当作崩溃恢复的完整凭据。

新增文件替换、元数据/UID 注入、输入并发修改、baseline 删除/改写/扩展、冲突读回及真实 lease owner 崩溃回归。native 全量 23 文件 231 项、CLI 全量 46 文件 448 项和修改测试的 strict TypeScript 检查通过。这些回归证明本机写入/排斥契约，未执行设备恢复或硬件验收。下一步仍需 R1 的稳定 AVD key 与 serial/boot/OS 绑定、Runner/forward 资源归属，以及 R3/R4 平台 readback 和 durable restore transaction；不得因这些检查通过而开放非空权限场景、biometrics 或虚拟镜头支持声明。

全仓 `pnpm build` / `pnpm lint`、Harness、CLI 71 guides / 105 examples 的 source/plugin 一致性及 whitespace 检查通过；feature generator 重新生成 638 份实现参考，capability generator 生成 17 份记录。plugin checker（`--skip-cli`）13 项通过，官方 validator 脚本仍未安装；CLI 已独立全量验证。未增加依赖，未操作个人/Worker 设备，未解除已有 quarantine。

## 38. Android managed mutation 的稳定设备身份（2026-11-04）

### 38.1 本次交付

- 新增内部 `AndroidDeviceBinding`，仅由持有父 lease 的 `NativeDeviceSession` 使用。首个 managed mutation 前，从实际发现的 AVD name 取得稳定租约，定向读取 serial、AVD、boot ID、build fingerprint、SDK，并复读 boot/AVD/serial。无法确认同一实例时不发布记录、不执行 mutation。
- 排他发布并同步 mode 0600 的 `device-recovery.json`；只包含版本、随机 journal ID、lease/owner generation 及 serial/AVD/boot/OS 摘要。后续验证检查有界 no-follow/nonblocking 字节、单 hard link、文件与 enclosing directory 身份；不采用既有记录。
- install/uninstall、stop/start、forward 修改、权限 grants/flags 派发前再次核验；managed operation 前后和 quiesce 清理前也复核。确认身份变化或证据丢失后，同一 binding 不因旧观察值重新出现而恢复；owner 隔离并停止后续写入。app/permission 清理完成且设备身份仍一致才完成 device record。
- 父 lease 返回私有 `deviceRecoveryPath`，delegate/grant 不返回该路径或恢复 generation；任意遗留 device record（包括不可读取链接）阻止正常 release，保留锁和 quarantine。
- `inspectDeviceLease` 增加 `deviceRecord`，识别严格 v1 schema、owner/lease binding 与选择的 AVD/serial 摘要，固定报告 `invalid-device-record` / `inconsistent-device-record`。有效 device record 的 serial 摘要用于关联 app/permission，使离线稳定 AVD inspection 可以校验两份记录。issues 或 live owner/child/operation 仍阻止内部 claim；claim 不执行恢复。

### 38.2 检查方式与证据边界

对以 AVD name 获取的租约，离线 `native recovery inspect` 使用 structured input 的 `native.deviceId: "avd:<name>"`；在线 doctor/snapshot/run 仍传真实 serial。离线检查不会运行 ADB 把 serial 转成 AVD name。原始 serial 对应不同 lease key，返回 absent 只说明该 key 无记录；不能据此宣布 AVD 可复用。CLI guidance 与回归已补齐这一限制。

回归覆盖五种 identity 变化后持续围栏、捕获期间重启、初始 AVD 不符、文件/目录等字节替换、hardlink/symlink、取消清理、已有记录拒绝采用、parent-only 路径、正常释放及 unused owner 惰性。managed 集成验证 install/permission 写入时记录已存在，以及 grant 之后重启会在 clear-flags 前被拦截。真实生产源码 Node owner 被 SIGKILL 后，inspection/内部 claim 保留原始字节；malformed schema、owner generation、lease key 或 AVD 摘要被改动均拒绝 claim。测试 source-graph compiler 从所属包解析真实外部依赖，临时输出不依赖本机 temp 目录存在 node_modules。

以上平台观察由受控 executor 提供；SIGKILL 证明主机进程与文件契约，不能当作真实 Android 身份、重启或恢复的设备验收。R1 仍部分完成：普通原生 UI 动作、独立 child 生命周期、Runner 设备内身份及 forward durable provenance 尚缺；R3/R4 restorer 和恢复事务未实现。没有新增公共 restore/clear，未解除既有隔离。

### 38.3 验证结果

native 全量 24 文件 254 项、CLI 全量 46 文件 449 项、Worker ownership/IPC/processes 4 文件 25 项、Vitest native fixtures 与 Android readback/declaration binding 共 4 文件 12 项通过；修改测试的 strict TypeScript、全仓 build/lint、Harness 和 whitespace 检查通过。多套件与文档生成同时运行时，native 曾有 3 项 host-process readiness/test deadline 超时；失败两文件单 worker 重跑 12 项通过，随后 native 默认命令全量复跑 24/254 通过。未通过延长生产预算或删除断言掩盖超时，仍需后续受控负载稳定性验收。

已生成 638 份 implementation references、17 份 capability 文件；CLI 71 guides / 105 examples 检查与 source/plugin 同步通过。plugin checker（`--skip-cli`）13 项通过，官方 validator 仍未安装，仅该项 warning。未新增依赖，未执行真实设备操作、平台恢复或 quarantine 清除；完整目标继续实施。

## 39. 剩余实现方案与完成条件

本节更新第 23/33/35 节的执行顺序。每个交付先以所属 Module 的公共 Interface 写行为回归，最小实现后运行包级检查；真实平台证据单独登记。保留 `page` / `native` / `device`，不引入 Appium/WDA、通用 shell 执行入口或未经 Harness 批准的依赖。

| 顺序 | 所属 Module / 接线位置 | 实现内容 | 完成条件 |
| --- | --- | --- | --- |
| 1：全入口身份约束（R1） | native `NativeSession`、`NativeDeviceSession`、`DeviceLease`、Android Adapter | **已部分接线：**父 owner 的受检身份快照用于普通 Android NativeSession 操作、每条 ADB 派发、managed owner 及 delegated child。child 只核验、不创建或采用父 journal。仍需逐项审查 capability/snapshot/evidence/teardown 的所有 Adapter 路径及跨进程生命周期 | 生产 lease、独立子进程及实际 Android 设备覆盖 serial 重用、boot 变化、record 替换、parent 围栏；证明任何 ADB dispatch 都在同设备锁内绑定同一 generation；未用 native 的 Flutter suite 不启动 identity 工具 |
| 2：剩余资源证据（R1） | native Android launch/forward、iOS Runner、工具监督 | **Android 部分完成：**派发前持久化 forward 意图，精确 `adb forward --list` 读回后立即持久化 host/device mapping；内部恢复事务见第 49 节。**iOS 部分完成：**生产会话在 launch 前落盘 boot/session/私有密钥，ready 后通过平台 PID 与 fresh challenge 再 checkpoint，正常关闭使用认证主动退出（第 45 节）；只读 verify 的 boot/PID 匹配仍仅作诊断。仍需 Android owner 崩溃接管、未知资源恢复、log observer、VM launch generation 及完整资源关联 | 在分配前后、回复丢失、owner/wrapper/Runner 退出处注入故障；未知资源只保留证据并隔离，不能按端口或 bundle 相似性推断归属或清除其他 mapping/进程 |
| 3：Android 恢复执行（R2/R3） | native `DeviceRecovery` 与专用 Android restorer | **内部执行器已实现，见第 49 节：**恢复前核验设备、安装摘要/package/user/UID、遗留进程、原权限 flags/app-op 和精确 forward；逐项恢复 force-stop、grants/flags、forward 与 session-owned 安装。仍需验证更完整 app-op 状态语义和真实 AVD 输出 | 安装/UID/boot/证据替换、固定或未知 flags、取消、未知写结果均保留原记录；成功必须有独立平台 readback，不能仅检查命令退出码。受控 ADB executor 不是平台验收 |
| 4：恢复事务与隔离退役（R4） | native lease/recovery journals、iOS/Android restorer | iOS Runner 的事务、crashed claim 接管、归档和退役已通过本机真实 Simulator 验收；Android 已接入 write-ahead action journal、原证据归档和退役流程，但 Android serial 推导、owner SIGKILL 边界矩阵及恢复 claim 跨进程续查仍缺 | 每个 fsync/rename/unlink/ADB dispatch/readback 边界强杀后仍阻止普通 acquire；原字节可追溯，事务可续查，重复请求不盲目重放，取消后实际 work 未退出不能释放；其他未恢复资源仍阻止退役 |
| 5：公共恢复与权限开放（R5/R6、N4/N5） | CLI、Worker supervisor、Vitest preparation、core capability/Scenario | **iOS XCTest Runner 与 Android app/permission/forward 窄范围 API/CLI 已接线。** Android API 只接受稳定 AVD identity 和当前 inspection fingerprint，serial 从绑定记录摘要与在线发现交叉核验，回执声明固定资源范围。Android 仍是 host-tested implementation，尚未通过专用 AVD 平台验收；Worker/Vitest 共用入口、完整非空权限场景 → stop/prepare → 无重装 launch → child 独立 receipt → 最终恢复仍待完成，按实际平台/权限/state 逐项开放 | iOS 专用 Simulator 验证公开入口的 crash → restore → 新 lease → 生产 attempt。Android 专用 AVD 跑通 inspect → restore → 新 lease → managed attempt，验证权限状态、安装和 forward；prompt/granted/denied、allow/deny/cancel、retry/普通 peer/空声明均有系统与 Flutter 断言。iOS Runner 恢复不继承 Android 权限恢复通过结论 |
| 6：指纹与 Face ID（N6） | native biometric Adapter/baseline、bridge app observer、demo | Android 先交付已录入基线和 match/reject；iOS 单独验证设备定向、录入、无界面注入及多 Simulator，再实现对应 Adapter。挑战 ID、pending、一次事件和最终 app 结果关联 | 成功、失败、取消、未录入、重复事件、旧挑战/代次、锁定恢复有真实业务证据；平台命令成功不能代表认证成功。iOS 验证失败保留 unverified；真机自动结果注入 unsupported |
| 7：图库和相机（N7） | native device preparation、媒体归属、demo camera 接缝 | 继续独立维护 app 固定结果；图库用版本化夹具 ID/摘要、实际资产 ID 及定向清理。Android cameraSource 在 boot 前应用并绑定设备基线，不伪装成运行时 setImage | 权限/快门/确认/取消与业务断言；实际读到指定帧、方向/镜像/分辨率、前后摄像头、视频/headless 及恢复均独立验证。无定向清理时只用可恢复的专用设备；iOS 不预设镜头注入 |
| 8：发布闭环（N8） | CLI/Worker、Cloud/VS Code、生成文档与示例 | 补故障报告、能力原因、离线证据消费、命令/schema/skills 一致性；记录工具链版本、准备配方和复现命令 | 每平台 20 次独立混合 attempt，报告无重试成功率、查询/动作 p50/p95、启动与清理结果；同设备争用/跨设备并发、Runner 崩溃/断线/超时/取消/恢复失败均不误报成功 |

依赖关系：1—4 为安全恢复的连续主线，5 需其平台恢复闭环；6 的 iOS 技术验证与 7 的夹具技术验证可独立推进，但任何设备写入都受统一 ownership/恢复约束。固定图片业务接缝已有可独立使用的实现。各能力通过自己的平台业务门槛即可单独交付，无需等 iOS 真机或原生录制；完整目标保持实施中。

每个交付登记源码/测试位置、真实工具链与设备类别、执行命令、原始 artifact、支持状态及剩余限制。不能以 deterministic fake、主机 crash 回归、mock supervisor 成功或菜单可操作证明硬件/无头 CI 支持。设备实验使用专用环境；本方案不修改个人/Worker 设备，也不提交 serial、VM URL、认证凭据或 Runner 构建产物。

### 39.1 紧接当前代码的三个交付

以下执行设计第 16 节。A 的控制原语、交叉语言回归及临时 XCTest 入口的平台实验见第 44 节；生产会话、ready/journal 与认证主动退出已接通，两次真实生产会话及实际 owner SIGKILL 验证见第 45 节。C 的 iOS Runner 内部窄范围恢复见第 46 节，Runner-only 公开恢复见第 47 节；Android 内部 app/permission/forward 恢复事务见第 49 节。Android 公开接线、崩溃接管、真实 AVD 与完整 headless/取消矩阵仍待完成。不能以增加只读诊断命令代替恢复实现。

| 交付 | 实施位置与步骤 | 可审查结果 / 失败出口 |
| --- | --- | --- |
| A：Runner 控制通道技术验证 | 专用 Simulator 的最小 XCTest 实验，验证 Network loopback listener、CryptoKit 认证、owner broker 消失后的有界自主结束；实际引入系统框架前登记 stack。验证 host → Runner，不复用旧方向的连通结论 | 明确工具链、单/双 Simulator、headless、取消和 owner SIGKILL 的证据；不通则记录原因并修订传输设计，生产支持状态不提升 |
| B：Runner 认证与主动退出 | native `ios/`、Runner、`RunnerBroker`、`XctestRunner`、严格 journal decoder；启动前落盘私有恢复密钥，ready 后绑定 endpoint；fresh challenge 认证 generation，有限 shutdown 使 Runner 自行结束；正常退出共用相同证明 | 公共会话行为回归和真实 Runner 验证；旧/跨代次/错误密钥/端口复用不触发退出。未 ready、无响应和旧 journal 只允许读回 absence 或继续隔离，不按 PID terminate |
| C：首条显式恢复闭环 | **iOS Runner 与 Android app/permission/forward 窄范围 API/CLI 已接线，见第 46/47/49 节。** iOS 具备追加式事务 journal、显式 claim epoch 接管、独立 boot/PID/boot readback、归档和隔离退役；Android 具备逐 action write-ahead、serial 摘要/在线 AVD 交叉核验、平台 readback、原证据归档和范围化 receipt。Android 尚缺 owner/ADB 工具崩溃接管矩阵与真实 AVD 验收，通用资源恢复不开放 | iOS 专用 Simulator owner crash → restore → 新 lease → 两次生产 session 已验收；Android 需恢复 owner/ADB 工具各边界的 SIGKILL 矩阵及专用 AVD inspect → restore → 新 lease → managed attempt。其他未恢复资源拒绝退役；iOS Runner 结果不代表权限/整机恢复 |

A/B 通过前，`native recovery verify` 继续只输出诊断。C 的 iOS Runner 内部闭环通过后，仅开放第 46/47 节定义的 Runner-only API/CLI；不暴露通用 journal 删除、clear 或 Android restore。恢复预算独立于失败 attempt，超时后的实际工作仍受追踪。更广故障/平台验收继续保留门槛。

### 39.2 硬件专项的最小完整交付

| 专项 | 最小实现与准备 | 必须有的真实结果 |
| --- | --- | --- |
| Android 指纹 | 版本化已录入专用 AVD 配方与受检设备/boot/OS 基线；绑定 app challenge 的 match/reject；拒绝重复事件和旧 challenge | 成功解锁、非终态 reject 后仍 pending、后续 match 成功、取消、未录入和锁定恢复。空闲时注入不能算通过；命令 ACK 与 app 最终结果分别记录 |
| iOS Face ID / Touch ID | 分别验证公开可用的定向接口、录入状态、headless 和双 Simulator；验证成功后才添加对应 Adapter/能力。两种 modality 分开记录 | app 发起真实挑战并消费 match/reject，包含取消和锁定恢复；另一 Simulator 不受影响。只有菜单操作可用时不能列 CI supported；无可靠路径保持 unverified，真机用人工流程 |
| 相机固定结果 | 目标 app 显式注册 debug/test 接缝；版本化夹具、每 attempt 重置和 `app-test-seam` 标识 | 成功/取消/错误、预览/重拍/上传业务结果；已有 iOS/macOS 证据保留，Android 单独验收 |
| 系统相机 / 图库 | permission/state 逐项准备与恢复，真实权限/快门/确认/取消控件；图库持久化本次导入资产 ID 与摘要 | 允许/拒绝/取消后的 Flutter 结果；图库能定向清理本次资产，不能证明清理时只能使用可恢复专用设备，不能按文件名删除 |
| Android 镜头来源 | 验证已安装 Emulator 官方参数与镜头能力；场景在 boot 前配置 image/video 来源并绑定设备基线 | app 实际读取指定帧，验证方向/镜像/分辨率、前后镜头和 headless；视频逐帧/时序另验。恢复设备基线后可正常新 attempt，不能把导入相册当作镜头注入 |

专项技术验证可独立推进；向公共 device scenario 开放写入仍依赖该平台的 ownership、准备、readback 和恢复闭环。测试失败不得通过重复 boot 同一已知不可运行的 AVD 来制造进度；先核实环境变化或转移到具有相同可复现配方的专用执行环境。

### 39.3 完成与发布判定

- 每个能力独立记录平台、设备类别、OS/工具链、backend、准备配方、源码回归、实际 artifact 和支持原因；`supported` 必须同时有生产实现和该范围的平台证据。未验证的能力在 setup 明确失败。
- 原生混合流程的稳定发布门槛为每个平台连续 20 个独立 attempt 全部通过且全部清理确认，禁用自动 retry；保留失败记录，修复后重新完整执行，不能挑选成功样本。另记录启动、查询、动作与清理的 p50/p95；统计每类样本数，不把不同操作混成一个延迟。
- 完成同设备争用、跨设备并发、Runner 崩溃、连接中断、超时、取消、旧代次、恢复失败及恢复过程中崩溃的矩阵；任何未知写入不得误报成功或允许普通 acquire。20 个正常 attempt 不能替代故障矩阵。
- CLI/Worker/fixture 共用同一恢复与能力判断，Cloud/VS Code 可离线读取原生证据；类型、构建、受影响测试、lint、Harness、生成 CLI reference 和 feature/capability 文档一致。实际设备不可用时保留对应未验收项，不用 mock 测试替代。
- Android 普通原生 UI 真机验收与 Simulator/Emulator 验收分别报告；iOS 真机、真机生物识别自动注入、可靠 Android Unicode 输入和原生录制不因首期通过而自动开放。完整目标只有在本节及对应 N1—N8/R1—R6 必需条目均有证据后才能标记完成。

## 40. 普通原生会话与 delegated child 身份复核

`DeviceLease` 增加内部 `verifyAndroidDevice` / `completeAndroidDevice` 能力。父 lease 只在同一稳定 `avd:<name>` lease 下，通过 `AndroidDeviceBinding` 首次同步捕获记录；后续调用复核记录和实际设备。delegated lease 从其内部 lock location 定位记录，但不返回路径或 owner generation；它使用自己的只读 binding，比较 owner token generation、lease key、serial、AVD、boot 和 OS 摘要，身份不符后该实例永久围栏。delegated release 不完成父 binding。

普通物理 Android NativeSession 按发现到的 serial 取得 lease，binding 复用同一 serial/boot/OS 检查，但不读取 AVD 专属状态；serial lease key 与 `deviceLeaseKey('android', serial)` 一致。managed 权限、安装和恢复仍仅对经过验证的专用模拟器开放，不能从普通物理 UI 操作覆盖推导出真机准备能力。

`NativeSession` 将校验置于跨进程操作锁内，并为标准 Android ADB Adapter 安装 `beforeCommand` hook，使 snapshot、click、fill 的各个 ADB 命令分步经过相同 binding 检查。初始化和 teardown 保留现有 lease 所有权；独立普通 NativeSession 在 Adapter dispose 后完成自己的 binding，managed `NativeDeviceSession` 则继续等 app/permission/forward 等所有清理成功后才完成。lease wrapper 将 parent/child 专有 verifier 方法传给 attempt session。

新增回归验证普通模拟器 session 首次动作创建持久记录、boot 改变后下一操作到不了 Adapter、正常退出完成记录；物理 Android session 按 serial 建立绑定且不派发 Emulator 专属命令；受控 ADB 多命令操作中途校验失败不派发下一命令；真实 delegated lease 读取父记录，boot 改变后拒绝；managed 的 session wrapper 在无父记录时 fail closed。此前的 SIGKILL/source-graph 测试发现 `DeviceLease` 与 verifier 间新增循环导入后无法编译，改由 verifier 在本地按相同 hostname/platform/AVD 输入计算 key，移除循环；原 5 秒 crash 测试预算保持不变。

这一步仍不是 R1 完成：真实 Android AVD reboot/serial reuse 设备验证未运行，XCTest Runner 设备内身份、Android forward 实际 mapping、Runner/log observer 资源记录与 Windows process tree 仍缺。已有模拟观察和主机 lease 测试不提升 Face ID/指纹、相机或设备恢复状态。

## 41. Android VM forward mapping 的即时持久化

`AndroidManagedApp.launch` 在派发前 checkpoint `operation: "forward"` 意图。ADB 返回动态 host port 后，先以 `adb forward --list` 核验唯一的完整 `serial tcp:hostPort tcp:devicePort` mapping，再立即 checkpoint 同一 `forward` operation 及两个端口；随后才复核 app PID、写入 `running` 并返回 endpoint。`running` 和 `remove-forward` inspection 必须具有精确端口，其他阶段不允许附带 forward mapping。

回归覆盖 forward 已建成、app 在 endpoint 返回前退出时，恢复记录仍保有 exact mapping；inspection 拒绝缺少 mapping 的 running/removal 记录和非 forward 状态下的 mapping。若 ADB 已分配端口但响应丢失或 owner 在 mapping 读回 checkpoint 前崩溃，journal 只有派发意图，不能通过扫描端口猜归属；owner 必须保留隔离。恢复器尚未实现，因而当前不能保证清除此类未知残留。

## 42. XCTest Runner 的在线 PID 绑定

Runner 的 authenticated `/ready` handshake 增加 Simulator 内 PID。启动前通过目标 Simulator 的 `launchctl list` 拒绝已存在的精确 Runner label；ready 后要求 launchctl 报告唯一 PID 与 handshake 一致。关闭时仅在同一个 PID 仍是精确 Runner label 时调用 `simctl terminate`，随后确认 Runner 不再活动；启动期间未完成 handshake 或 PID 已替换时不 terminate 未归属进程，保留 cleanup failure。

RunnerBroker 和 `startXctestSession` 回归覆盖缺 PID handshake、已有 Runner 拒绝、正确 PID 清理及 PID 替换时不误杀。Swift Runner 通过 Xcode 26.6 Simulator `build-for-testing` 编译。当前 PID 只在活跃 owner 内存与握手中绑定，尚未写入设备 recovery journal；owner SIGKILL 后设备内 Runner 仍需独立 durable provenance/recovery，不能由 host process group 已退出推断清理完成。

## 43. XCTest Runner durable Simulator provenance

新增 `ios-runner-recovery.json`，owner lease 下首次排他写入 `phase: launching`、设备摘要、lease/owner generation 与 Runner generation；authenticated `/ready` PID 和 exact `launchctl list` readback 一致后更新为 `phase: running` 与 PID。仅在 host process group 收敛、Simulator 内精确 Runner 不存在后删除 journal。启动或关闭无法确认时记录保留，普通 lease release 写入 quarantine 并拒绝释放。

离线 `inspectDeviceLease` 不启动 `xcrun`，只验证记录 schema、设备摘要和 owner binding；存在合法记录时返回 `iosRunnerRecord: present` 与 `unresolved-ios-runner`，malformed 或错绑记录报告固定 issue。内部 recovery claim 因 issues 拒绝占有，尚无 iOS Runner restorer 读取该 PID、核验 Simulator UUID/boot generation 并完成受控清理，所以该 journal 是 durable provenance 和隔离，不是已实现恢复。

本轮将 Runner journal 增加 `simulatorBootedAt`，取自 CoreSimulator 对明确 UDID 的 `simctl list -j devices booted` readback；缺失、重复、未启动或时间格式不合法均在启动 xcodebuild 前失败。该字段与 Runner PID、Simulator UUID、lease/owner generation 一起持久化，使后续 restorer 可以拒绝在不同 Simulator boot generation 下终止同号 PID。它只提供恢复前置身份，不构成恢复操作或支持声明。

新增在线只读 `inspectIosRunnerRecovery()` 与 `native recovery verify`。仅在 lease/Runner 记录完整、旧 owner 与 host/delegate/operation 已退出且无其他 inspection issue 时执行；它读取当前 boot generation 与精确 XCTest Runner launchd label，并只返回 runner-absent / runner-matches-record / runner-mismatch 和 boot generation 是否一致，不暴露 PID或 journal 内容、不写设备或本机证据。离线 `native recovery inspect` 的无工具语义保持不变。该 API 为显式 restore 提供 readback 基础，尚未执行 terminate、归档或 quarantine 解除。

在线检查在读取 PID 前后比较 CoreSimulator boot generation，再复核完整本机 fingerprint（含 recovery claim）；取消、重启、record 替换或并发 claim 均不返回成功。`runner-matches-record` 只描述 PID 与 boot timestamp 的匹配，同一次 boot 内 PID 也可能复用，不能据此批准终止进程。`launchctl list` 必须提供完整表头和合法行，空白/异常输出不能算 Runner 缺失。

普通 XCTest session 同时将初始 boot generation 用于 ready/PID checkpoint 和 teardown 复核。Simulator 重启后即使 PID 与原记录相同，也拒绝 terminate 和 journal complete，保留记录并使 release 隔离。owner SIGKILL 回归改为等待生产启动路径完成后再注入崩溃，避免靠固定延时碰巧落在临时 journal rename 期间；另测文件替换、取消、同 boot PID 不匹配和读回期间重启。此处仍非完整恢复事务。

本切片验证：native 全量 26 文件 291 项、CLI 全量单 worker 46 文件 451 项通过；修改过的 native/CLI 测试 strict TypeScript、全仓 `pnpm build` / `pnpm lint` 通过。独立 Node 进程使用生产 DeviceLease/IosRunnerJournal 在临时 storage 写记录后退出，再调用生产在线检查对现有专用 iOS 26.5 Simulator 读回，得到 runner-absent、boot generation 一致且原 journal 字节不变；未启动/终止 Runner 或清除实际隔离。CLI docs 72 guides / 106 parsed examples、source/plugin parity、642 份 feature references 和 17 份 capability 文件已更新。在线检查结果不能当作恢复凭据；后续仍需真实 Runner 的进程代次证明、claim 下恢复事务、原证据归档和隔离退役，不能只凭同 boot/PID 匹配恢复终止。

回归覆盖 journal 的排他创建、PID checkpoint、文件/owner fencing、普通 release 拒绝；真实 Node owner/wrapper SIGKILL 发生于 Runner PID 已持久化之后，host process group 退出前 claim busy，退出后 Runner evidence 仍阻止 claim。模拟 `launchctl` 只验证主机记录契约，不代替真实 Simulator 崩溃恢复验收。

## 44. Runner 认证控制原语与真实 Simulator 通信验证

### 44.1 已实现的内部原语

新增 `ios/RunnerRecoveryClient.ts` 和 Runner `RunnerRecoveryControl.swift`。Swift 使用已登记的 Apple Network/CryptoKit，只绑定 loopback、仅接受 identify/shutdown。HMAC 对方向、操作、新 nonce、session/generation、设备、boot generation 和 PID 一起认证；错误身份、错误密钥、重放、未知操作/字段或过大消息均不能触发退出。并发连接最多两个、每帧最多 4096 字节，未完成输入两秒内关闭。shutdown 通知仅让持有该控制端的测试自行结束，不调用 kill 或 simctl terminate。

Node 客户端只连接明确的 loopback 端口，受 deadline/取消约束，固定错误文本不包含请求、回复或密钥。每个客户端只能派发一次 shutdown；回复丢失后报告 unknown，并拒绝后续请求。ACK 只返回 stopping，不返回设备已恢复。`PrepareIosRunner` 把新增 Swift 源码纳入缓存摘要；源码列表、Xcode 工程和 import allowlist 同步登记，未增加第三方依赖。

host 回归编译并执行实际 Swift 控制源码，与 Node 客户端真实通信；另用 Node 对端验证错误签名、跨代次/设备、错误 nonce/direction/status、额外字段、分片、超限、取消、deadline 及 shutdown 不重发。prepare 缓存回归先证明新增源码变化未使缓存失效，再纳入摘要修复。

### 44.2 平台实验和隔离验证

可复现入口（需先构建 native，设备参数仅放本机命令行）：

```sh
pnpm --filter @fliwright/native build
node packages/fliwright-native/scripts/verify-ios-recovery-control.mjs <dedicated-Simulator-UDID>
node packages/fliwright-native/scripts/verify-ios-recovery-control.mjs <first-dedicated-Simulator-UDID> <second-dedicated-Simulator-UDID>
```

该开发工具复制 Runner 工程到临时目录，仅替换实验 XCTest 入口，复用生产控制源码与标准 prepare；它持有默认设备 lease、写入 Runner launch/PID journal、监督 xcodebuild process group，并在 readback 确认退出后才完成 journal/release。首个原专用 Simulator 因既有 quarantine 被拒绝，没有更换 storage root、清标记或操作该设备；随后新建两个临时专用 iOS 26.5 Simulator 完成实验。

Xcode 26.6 / 17F113、Simulator SDK build 23F81a：单设备一次与双设备并发各一次均通过。每个 Runner 在明确设备启动，host → Runner HMAC identify 成功；实验 broker 子进程被 SIGKILL 后仍能重新认证；signed shutdown 返回 stopping，XCTest 正常结束，平台 readback 确认 Runner 消失且 boot generation 未改变。双设备同时保持活跃，分别向对方 endpoint 发送自己的身份/密钥，均被拒绝；两边再次确认自身可用后才允许进入 shutdown，避免把已退出 peer 的连接失败误当隔离成功。

本机私有 artifact 保存在系统临时目录的 `fliwright-ios-control-wg0cJM`（单设备）、`fliwright-ios-control-XZPEa5` 和 `fliwright-ios-control-EEteo7`（双设备），含 `result.json` 与 xcodebuild 输出；source/build 临时目录已移除，两个新建 Simulator 已 shutdown/delete，普通租约已释放。结果明确标注 `scope: temporary-xctest-entry` 与 `productionSessionIntegrated: false`。运行没有使用 Simulator 菜单，但尚不把本机桌面会话的结果提升为无宿主 UI 的 CI 验收。

### 44.3 仍需完成的接线

生产 `FliwrightRunner.testServe` 尚未实例化该控制端。下一步在生产启动前持久化私有恢复密钥/session，升级严格 Runner journal schema 与主协议；ready 后绑定恢复 endpoint，平台 readback 后通过 challenge 证明当前 generation，再写 running checkpoint。正常关闭使用认证主动退出替换 label/PID 后的 bundle terminate fallback；处理旧 broker 请求仍 pending、未 ready、无 shutdown 请求、回调与 ACK 竞态及 startup/cleanup 的统一预算。无认证证明时继续保留隔离。

实验强杀的是 broker 子进程，lease owner 仍在监督，不能当作生产 owner SIGKILL 恢复证据。后续还必须完成真正的 owner 崩溃、恢复 claim、独立 readback、完成 checkpoint、证据归档、crashed claim 显式接管与隔离退役；这些都未由本切片交付。Face ID、指纹、权限场景、图库和镜头支持状态不变，整体目标保持实施中。

本切片验证：native 全量单 worker 28 文件 311 项通过，包含四项实际 Swift 进程协议回归；修改测试的 strict TypeScript、全仓 build/lint、三项 native stack 治理回归、Harness、CLI 72 guides / 106 examples source/plugin parity 和 `git diff --check` 通过。生成器已刷新 642 份 implementation references 与 17 份 capability 文件。本轮不重复未受影响的 CLI 全量测试，也不将这些主机检查计为硬件业务验收。

## 45. 生产 Runner 认证接线、主动退出与实际 owner 崩溃

### 45.1 生产协议和持久化

`FliwrightRunner.testServe` 已实例化恢复控制端，在主协议 v2 `/ready` 中报告恢复端口；broker 拒绝旧版本、无效端口及 ready 后 PID/端口变化。控制协议仍为独立 v1，其 HMAC 字段和操作白名单不变。Runner 为 broker 请求持有可取消的 URLSession Task：认证 shutdown 在 MainActor 设置关闭状态并取消当前网络等待，停止读取新 UI 命令；shutdown 不再通过旧命令队列发送。

`IosRunnerJournal` 升为严格 schema v2，在 xcodebuild dispatch 前以 mode 0600 同步保存 sessionId、generation、恢复密钥和 boot generation；launching 的 PID/端口均为 null。authenticated ready 后，TypeScript 读取指定 Simulator 的 boot/PID，再向明确端口发送 fresh challenge，认证通过并复核 boot 后才写 running PID/端口。密钥不进入 inspection/timeline/CLI JSON 或构建缓存。完整旧 v1 及其他缺失/无效凭据记录不能通过新 decoder，没有旧格式自动采用路径。

启动的 preflight 后平台读回、journal 和 ready/challenge 共用 startup 总预算，后续阶段不会重新获得完整 startup 时间。关闭有独立总预算；依次读回 boot/PID、认证 identify、单次 shutdown、关闭 broker、等待 owned host group 与 pipes、读取实际 Runner absence，再完成本实例 journal。即使 boot 与 PID 一致，错误密钥也不会触发 shutdown。已移除 `simctl terminate` fallback，不对 Simulator 内进程发送信号。ACK 丢失仅触发独立 readback；仍有 Runner、host work 未退出、boot 变化或总预算耗尽均保留记录和隔离。

回归中的 fake xcodebuild 是实际子进程与真实 loopback 控制对端，启动前从生产 journal 独立核对已落盘凭据。覆盖正常退出、lost ACK、同 PID 换密钥、替换 PID、重启、收到 ACK 但不退出、ready 前认证失败、existing journal/Runner 拒绝，以及真实 owner/wrapper SIGKILL 后的 group fencing。fake 平台 inventory 在 host tool 被杀后仍可保留活跃 Runner，避免把 host 退出自动当作 Simulator absence。broker 和 journal 的行为回归先红后绿；所有 secret/session 仍不进入 inspection 输出。

### 45.2 真实生产入口

新增开发验证工具（正常默认设备 lease，不提供跳过隔离开关）：

```sh
pnpm --filter @fliwright/native build
node packages/fliwright-native/scripts/verify-ios-production-session.mjs <dedicated-booted-Simulator-UDID>
node packages/fliwright-native/scripts/verify-ios-owner-crash.mjs <disposable-booted-Simulator-UDID>
```

Xcode 26.6 / 17F113、iOS Simulator 26.5 / SDK build 23F81a 上，新建专用 Simulator 使用实际 shipped `testServe`、生产 `startXctestSession`、lease 和受管 xcodebuild，连续完成两次独立启动/截图/关闭。每次都检查 running schema v2、保存 PNG，并在关闭后确认 hostTool/Runner record/operation absent 以及平台 Runner absence；最后正常 release。两次 generation 不同，启动约 24.4 秒/11.2 秒、关闭约 4.3 秒/3.8 秒，截图各 2,804,575 bytes。只有两个样本，不作为稳定性或 p95 验收。私有 artifact 目录：系统 temp 下 `fliwright-ios-production-gvIk0k`。

随后同一专用 Simulator 上由独立真实 Node child 取得默认 lease 并启动生产 Runner；父进程在 running checkpoint 后 SIGKILL 这个实际 owner。受管 host wrapper/group 随后退出，在线 verify 读回 Runner absent 且 boot generation 一致。原 journal 字节未变，owner/hostTool 均 exited，iosRunnerRecord 仍 present，只有 unresolved-ios-runner issue；普通 acquire 继续被拒绝。私有 artifact 目录：系统 temp 下 `fliwright-ios-owner-crash-Upu0OO`。该结果区别于第 44 节仅杀 broker 的实验。

崩溃验证故意保留这台本轮新建的专用 Simulator 和原始恢复证据，供下一步真正的 fault → recover → 新 attempt 验收；没有绕过旧隔离、删除 dirty/lock 或宣称已恢复。后续恢复成功后才清理该专用设备。个人/已有 Worker 设备未操作。脚本不输出私有 journal、密钥、PID 或路径到公开结果；artifactRoot 只在本机开发工具输出，未进入产品报告。

### 45.3 验证与下一步

native 全量单 worker 28 文件 316 项通过；修改的 broker/Runner/journal/recovery tests strict TypeScript 通过。实际 Swift/XCTest 生产 build-for-testing 编译和上述三次设备运行通过，三项 native stack 回归与 CLI 72 guides / 106 examples 检查通过；feature/capability 生成器已刷新 642 references / 17 files。全仓 build/lint、Harness 和 whitespace 检查作为交付收尾记录。

第 39.1 节 C 的 iOS Runner 窄范围内部闭环已在第 46 节实现，并用专用 Simulator 完成 owner crash → restore → 新 lease → 两次生产 session。Runner-only 公共 API/CLI 现见第 47 节；无宿主 UI 的 CI、恢复过程平台工具在途时 owner crash、完整 Worker 故障矩阵、Android forward/权限恢复、生物识别、媒体/相机和发布矩阵仍按原计划独立完成，整体目标保持实施中。

## 46. iOS Runner 内部恢复事务与故障后的新 attempt

### 46.1 资格、事务存储及显式接管

`RecoveryTransaction` 与 `ios/IosRunnerRecovery` 实现首条内部恢复闭环，未从包 barrel 或 CLI 暴露 restore。只接受 inspection 的准确 fingerprint，以及没有其他资源记录、有效 owner 绑定的 schema v2 Runner。原 owner、delegate、operation 和宿主工具必须可验证已退出；存在 app/permission/device、未知记录、旧 generic claim、错误 dirty owner 或其他 issue 时拒绝。现有只读 verify 继续只提供诊断。

reservation 下每步是不可变的非空 `step-NNNNNN/record.json`，绑定 transaction、设备 hash、原 fingerprint、原资源内容/身份摘要、owner epoch、前步摘要、phase、shutdown-pending 和 completion boot。先创建私有 `.pending-*` 目录，写入并同步 record、同步目录，再以原子 rename 发布到唯一 sequence，最后同步 reservation。并发 claimant 无法覆盖已存在的非空步骤目录；publication 前的残留 pending 是惰性候选，不能执行平台动作，也不删除其字节。历史链、目录和文件身份、完整读取及路径复核均严格校验。

接管保留旧 owner/步骤，确认原 owner 与全部记录的宿主 group 已退出后追加新的 claim epoch；未知 reserved tool 不猜测已退出，继续隔离。正常失败可在实际工作已结束后追加 release epoch，仍保留 reservation；取消/超时先有界返回调用者，尚未结束的底层工作继续持有 owner，不能提前重试或普通 acquire。平台工具复用真实 executeTool 的 write-ahead journal 和 gate，各 epoch 下记录工具归属。

活跃 Runner 必须先做 boot/PID 独立核验和 fresh identify，再持久化 shutdown-pending，最多请求一次主动退出。丢 ACK、崩溃或重试均不重发 pending；只允许等待并读回 absence。即使 PID 相同，错误密钥也不会发送 shutdown。未 ready 的 launching 记录只读回，不猜测 endpoint；boot 改变继续隔离。

### 46.2 归档和退役

平台独立读回 boot/PID/boot，确认相同 boot 且 Runner absent 后同步 readback-completed，再同步 archiving。逐项核对原资源摘要，原锁 rename 为 reservation 下的 original.lock，dirty 若存在则 rename 为 original.dirty；分别同步目标与来源目录。原始 journal/dirty 字节不改写，原 inode/mode/mtime/内容必须保持。归档后的 inspection fingerprint 同样覆盖实际私有证据，替换归档内容会改变 fingerprint 并阻止完成。

任一中间阶段原锁移走也仍由 reservation 阻止 acquire。归档完成后再次独立读回，并同步 archived、retired；最后原子 rename 整个 reservation 到私有 archive 目录并同步 root。崩溃后从原位置或归档位置恰好一个资源重建相同摘要，重复位置、丢失、替换或其他未恢复资源一律拒绝。最后退役后设备已具备 durable completion；保留完整事务和原证据，不删除历史记录。此处只证明 Runner 资源恢复，不宣称权限、图库、媒体或整机恢复。

### 46.3 确定性和真实平台证据

新增 RecoveryTransaction、IosRunnerRecovery 及 crash tests，覆盖并发 claimant、SIGKILL 接管、旧 checkpoint 替换、链接候选、真实宿主进程未退出、取消不合作 executor、错误密钥、lost ACK、pending 不重发、重启、其他资源拒绝和归档替换。持久化崩溃矩阵在实际 Node restorer 子进程强杀：reservation mkdir/root sync、五个 phase 的候选写入/file sync/directory sync/rename、原锁与 dirty 的 rename/目标及来源 sync、最后退役 rename/root sync。每个故障后都验证原字节可追溯、未退役时 acquire 拒绝，以及显式续查后可取得新 lease。该矩阵不替代实际 OS 设备业务或断电持久化验证。

本机 Xcode 26.6 / 17F113、iOS Simulator 26.5 / SDK build 23F81a：沿用第 45 节实际 owner SIGKILL 留下的专用设备与原 journal，执行内部 restore，验证归档字节不变、inspection available 和新 lease。私有 artifact：系统 temp 下 fliwright-ios-runner-recovery-psXol0。随后同设备两次生产 start/screenshot/dispose 均通过，启动约 8.6/12.4 秒，清理约 4.0/3.4 秒，截图各 2,804,976 bytes，generation 不同；私有 artifact：fliwright-ios-production-87Jw8u。两个样本不作为 20-attempt 或 p95 验收。

开发验证入口为 packages/fliwright-native/scripts/verify-ios-runner-recovery.mjs，必须显式传专用 Simulator 和最新 inspection fingerprint；不自动选设备、不清理旧证据。它只验恢复与新 lease；生产会话由 verify-ios-production-session.mjs 单独验证。

### 46.4 剩余门槛

`restoreIosRunner` API 与 `native recovery restore` CLI 现已开放且只处理 XCTest Runner。Worker/Vitest 统一入口、真实恢复 owner 在运行平台工具期间崩溃的完整矩阵、headless/双设备生产恢复及严格平台发布验收尚待完成。Android forward 未知分配、权限及安装 reconcile/恢复、非空权限场景、Face ID/Touch ID、Android 指纹、图库和真实镜头来源保持第 39 节顺序和独立支持状态；本切片不提升它们为 supported。整体目标仍未完成。

## 47. XCTest Runner 恢复公共入口

`@fliwright/native` 导出 `restoreIosRunner({ deviceId, fingerprint }, { timeoutMs?, signal?, xcrunPath? })`；`native recovery restore` 接受同一 inspection fingerprint 和可选总超时，并从当前项目 native 配置读取明确 Simulator 与 xcrun 路径。成功返回仅包含 `status: restored`、opaque `transactionId` 和固定 `resourceScope: xctest-runner`，不暴露原始 journal、恢复密钥、PID、host 路径或 archive 位置。

公共 wrapper 复用第 46 节同一个资格判断、reservation、journal、认证 shutdown、platform readback、字节保全和最终退役。fingerprint 缺失/格式错误、证据已变化、Android 或非 Runner 资源均在平台写入前拒绝。此结果只证明 XCTest Runner 已恢复；不能用于 Android permission/app/device recovery，也不能用作整机 ready 断言。CLI contract、帮助和 source/plugin 文档由 command registry 生成并保持同步。

源码/回归：`packages/fliwright-native/src/ios/IosRunnerRecoveryApi.ts`、`packages/fliwright-native/tests/IosRunnerRecovery.test.ts`、`packages/fliwright-native/tests/IosRunnerRecovery.crash.test.ts`、`packages/fliwright-cli/src/registry/native.ts`、`packages/fliwright-cli/tests/native.test.ts`。Xcode 26.6 / 17F113、iOS Simulator 26.5 / SDK build 23F81a 的专用设备上再次真实杀死生产 lease owner；`restoreIosRunner` 返回 `resourceScope: xctest-runner`，原 journal/quarantine 字节留在私有归档，inspection 转为 available 且新 lease 成功。随后两次生产 start/screenshot/dispose 通过，启动约 7.1/7.5 秒、清理约 2.6/2.8 秒、截图各 2,805,164 bytes、Runner 均独立读回 absent；私有 artifact 为系统 temp 下 `fliwright-ios-runner-recovery-ZW2rL8` 与 `fliwright-ios-production-QnRA1M`。这证明公共 API 复用同一恢复事务，不代表 CLI 在真实设备上单独执行、20 次稳定性或 Android 资源和硬件能力状态。

## 48. 恢复 reservation 多 claimant 压力回归

`RecoveryTransaction.claim()` 的既有互斥测试只用两个同进程调用争抢，覆盖不到多个候选者同时创建并扫描惰性 `.pending-*` 目录的窗口。回归扩展为 10 轮、每轮 12 个并发 claimant：必须恰有一个 claimant 成功，其余 11 个全部返回 `device_busy`；之后的 claimant 仍必须返回 `device_busy`。

压力测试发现，`readLog()` 根据目录枚举到 `.pending-*` 后，另一 claimant 可能已将该目录原子改名为正式 step，随后 `lstat/readdir` 得到 `ENOENT`。竞争者将其作为 `device_busy` 返回；只读 inspection 对明确的并发变化做有界重读，避免把正常发布窗口误判为证据损坏。其他无效目录内容仍按原规则报告恢复证据错误。修复位于 `packages/fliwright-native/src/RecoveryTransaction.ts`，回归位于 `packages/fliwright-native/tests/RecoveryTransaction.test.ts`。

验证：`pnpm --filter @fliwright/native exec vitest run tests/RecoveryTransaction.test.ts tests/IosRunnerRecovery.test.ts`，20 项通过；压力回归覆盖 120 次同步 claim 尝试（10 × 12），每轮只有一个获胜者且 11 个竞争者及后续 claimant 都返回 `device_busy`。该回归验证本机 reservation 竞争语义，不替代真实多进程、跨设备和 Worker 故障验收。

本轮收尾验证：native 单 worker 全量 31 个文件、380 项通过；native build/lint 通过；CLI native 恢复回归 13 项通过。默认并行全量首次出现 2 项恢复 fingerprint 时序失败和 1 项 Runner 5 秒超时；对明确的事务并发发布增加有界 inspection 重读后，定向 20 项及单 worker 全量通过。未提高测试 timeout；随后默认并行全量复跑 31 个文件、380 项通过；Harness 与 `git diff --check` 通过。feature references 和 capability catalog 已重新生成。

## 49. Android 安装、权限与 ADB forward 的内部恢复事务

### 49.1 已实现的恢复原语

新增共享 `RecoveryEvidence`，统一读取原 lock/dirty 证据摘要、验证归档路径和保留原始字节。`RecoveryTransaction` 增加 write-ahead action intent：派发每个恢复写操作前持久化 pending；只有同一 action intent 的独立平台观察匹配目标状态后才能 checkpoint 为 verified。续查 verified action 时重新绑定其 intent 摘要并独立观察目标状态，状态仍满足则跳过该写操作继续，intent 不符或状态反转则失败；pending action 未被读回证明已生效时返回 `action_outcome_unknown`，不会重放。

新增 Android 内部 restorer 与平台观察层。资格限制为稳定身份 `avd:<name>` 对应的专用单用户 AVD，并要求设备 owner/operation/host tool 已退出、journal 与原 dirty 证据仍精确绑定。恢复前检查 serial、AVD、boot ID、系统 fingerprint、安装包摘要、package/UID/target SDK、进程、运行时权限 flags、default package app-op 与完整 forward mapping；写操作前后持续检查相同 device binding 和恢复事务 owner。操作按 force-stop、原权限 grants/flags、完整读回、精确 forward 移除、仅卸载本 session 安装的 app 执行。不会删除不属于本 journal 的 forward，也不会清除不确定的安装。

每个动作都有独立 pending/verified checkpoint。续查遇到 verified 动作时，必须再次观察目标状态；状态仍满足则跳过已完成写入并继续，状态反转则失败并保留隔离。完成后再次确认目标 UID 无进程、原权限状态一致、所记录 forward 已消失且安装所有权恢复，再同步记录 readback-completed、归档原 lock/dirty、退役 quarantine。取消、身份变化、写入回复丢失、读回未知、事务边界崩溃或清理失败均保留原始记录与 reservation；此版本不执行 Android enrollment、媒体或相机恢复，也不公开通用清理入口。实现位于 `packages/fliwright-native/src/RecoveryEvidence.ts`、`RecoveryTransaction.ts`、`DeviceRecovery.ts` 和 `android/AndroidRecovery*.ts`。

### 49.2 剩余统一接线与平台验收

`restoreAndroidApp` 已从 `@fliwright/native` 导出，`native recovery restore` 已按平台路由 Android；它只返回 `resourceScope: android-app-permission-forward`，不返回 serial 或 archive path。wrapper 在同一 fingerprint 下读取严格 bound 的 `device-recovery.json`，通过只读发现要求唯一在线同名 AVD，再比较 serial 摘要；内部 restorer 会重新检查实际 serial/AVD/boot/OS。不得让调用方传任意 serial 覆盖绑定记录。Android 恢复 owner 已有真实 Node 子进程 SIGKILL 后的 host 回归，覆盖 pending 写入、权限/forward/安装动作派发、7 类 verified 动作续查、verified 状态反转隔离及 9 个 readback/归档边界。真实专用 AVD acceptance 仍缺失，不能据此声明 Android recovery supported。

在对 Android restore 声明 supported 或接入 Worker/Vitest 前补齐：真实 Android Emulator 故障后 inspect → restore → 新 lease → managed attempt；恢复 owner 在其余 durable checkpoint、ADB dispatch/readback 和归档边界被 SIGKILL 后的显式续查；forward/permission/uninstall 回执丢失、未知写入不重放、恢复并发/取消/owner 仍存活、两台 AVD serial 复用等契约。当前主机 SIGKILL 回归覆盖 durable `claimed`、权限 revoke/forward remove/session-owned uninstall 派发、5 类 pending intent 未知结果、7 个已 verified 动作续查、verified 状态反转保护和 9 个 readback/归档边界，共 26 个 owner 崩溃续查用例。其余工具/事务边界仍待覆盖。需用新建专用 AVD 验证真实命令输出与恢复前后 grants/flags/app-op、安装归属、forward mapping、boot identity 和目标 app 新 attempt；受控 ADB executor 测试不能替代平台证据。现有主机回归只证明事务逻辑，不提升 Android recovery 为 supported。

### 49.3 当前验证与顺序

本轮 native 全量单 worker 33 个文件、429 项通过，其中 Android recovery API 7 项及内部 Android recovery 40 项通过；native `lint`/`build` 通过，feature references 已重生成。此前 CLI native command 14 项、CLI 全量 46 个文件、454 项通过，CLI `lint`、CLI command docs、Harness 均通过。当前 `adb devices -l` 无在线设备，`emulator` 不在 PATH；以上都是主机回归，未完成真实 AVD 验收。

推荐顺序：先在可启动的专用 Android AVD 上验证真实工具输出及已接线的 `native recovery restore`；补齐其他 ADB dispatch/readback、归档期间 SIGKILL 的续查与未知结果契约；再执行生产 owner SIGKILL → restore → 新 lease → managed attempt 平台验收，最后决定是否把 Android recovery 从 host-tested 提升为 supported 并接入 Worker/Vitest。任一步设备身份或状态不确定时停止后续写入并保留隔离；不以 iOS Runner 已验收推断 Android 权限恢复可用。

## 50. Android UID 退出证明与权限场景的 worker 边界

### 50.1 已修复的进程观察缺口

N4 调用链核对发现，permission preparation 对 `ps -A -o UID,PID,NAME` 的解析弱于 child readback 和恢复器：重复 PID、超过安全整数范围的 UID/PID、额外列会被当成有效的“UID 无进程”观察，数字表示不同的同一 UID 也可能漏检。安装式 app 的启动与清理路径同样未拒绝重复 PID。新回归先复现 8 项失败，其中异常进程表仍会得到权限 grant、VM endpoint 或成功清理结果。

新增内部 `android/AndroidProcessInventory.ts`，由 `AndroidPermissionPreparation`、`AndroidManagedApp`、`AndroidAppObservation` 与 `AndroidRecoveryPlatform` 共用：限制输出 1 MiB，要求精确 UID/PID/name 三列、安全整数、PID 全局唯一和 UID 0/PID 1，按数字比较目标 UID。无效输出报告 `protocol_mismatch`；恢复器在保留该 cause 的同时报告 `cleanup_failed`。该观察不声称系统原子快照或真实平台验收。

权限准备/恢复在有效 UID 退出证明前不派发 grant/revoke/flag mutation；安装式启动在无效观察后不创建 forward、不返回 endpoint，清理不移除 forward 或卸载 app。已经派发 force-stop/launch 时保留 outcome unknown，不重放。retained owner 的最终 stop 读回失败时，真实 lease/journal 主机回归确认 quarantine 与恢复记录保留，原始权限恢复和卸载都不会继续，重新 acquire 返回 `cleanup_failed`。

### 50.2 公开 gate 的子进程回归

`packages/fliwright-vitest/tests/device-scenarios.test.ts` 新增实际 Vitest worker 与真实 loopback `ManagedAppLifecycle` 测试。managed-start 的显式及默认 camera prompt 场景（包括 retry）均因未开放的权限准备失败；supervisor prepare、native owner、Bridge 和正文事件全部为零。该用例证明拒绝发生在跨进程平台请求前，不开放非空权限场景，也不以 fake 设备结果充当业务验收。

后续仍按 N4/N5 完成非空声明的公开 worker 链路与专用 Android AVD 的 prompt/granted/denied、allow/deny/cancel 业务及最终恢复。Face ID/Touch ID、Android 指纹、图库、虚拟镜头与每平台 20 次 attempt 继续独立验收；本切片不改变其支持状态。

### 50.3 验证记录

修复前聚焦回归确认 8 项失败；修复后 native 单 worker 全量 33 个文件、439 项通过（`pnpm --filter @fliwright/native exec vitest run --maxWorkers=1`），其中包含实际 Node owner SIGKILL 恢复矩阵。权限准备、安装生命周期、child readback 聚焦组 3 文件、64 项通过；Vitest device scenarios、declaration binding、child readback 专项 3 文件、12 项通过。native `build`/`lint`、Vitest `lint`、Harness 与本轮文件空白检查通过；实现参考重生成 649 份、Harness capability 文件 17 份。

首次默认并发全量运行与另一组重型恢复测试重叠，既有 lost-reply reconcile 用例出现 5 秒超时；该用例在聚焦组及随后独立的单 worker 全量中通过。未放宽测试预算、跳过用例或改动真实设备。本轮没有 Android AVD、Face ID/指纹、媒体/镜头或每平台 20 次混合 attempt 的新增平台通过记录，整体目标继续实施中。

## 51. 恢复事务中的 App 重启与写入前停止证明

### 51.1 实现

恢复事务原先只在 `app.stop` 动作检查 stopped/UID 退出，后续权限、forward 和 uninstall 动作的 satisfied 条件各自只核对目标值。若 App 在 stop verified 后重启，或恢复 owner 在权限 verified 后崩溃、App 再启动，续查会越过早先的 stop 动作继续写入。平台 `mutate` 也只复查设备 identity，未独立复查 App 退出。测试先复现 5 项失败：恢复过程中仍修改权限、删除 forward 或卸载 app；stopped 标志已清除但尚无进程时甚至会误报恢复完成。

`android/AndroidRecovery.ts` 现将 stopped 为真且整个目标 UID 无进程纳入所有动作的 satisfied 条件。pending/verified 动作续查和写后 readback 均复核该条件；早先 stop verified 不是持久的停止凭据。`AndroidRecoveryPlatform.mutate` 在权限写、forward removal 和 uninstall 派发前独立执行一次完整的平台观察，重新核对当前安装、UID、permission/app-op、forward ownership 与停止证明；force-stop 保留原有设备绑定检查。所有观察与派发共用原恢复 deadline，不新增无限等待或重置预算。它们仍是有限时间内的重复观察，不声称系统原子快照。

停止证明失效时保留原 lock/dirty、资源 journal 和恢复 reservation，不继续派发后续动作，也不自动重发 force-stop。写入派发后若 readback 看到重启，则该 action 保持 pending，返回 `action_outcome_unknown`；在停止证明仍失效的显式续查中，不推进 checkpoint、不重放权限写。只有目标状态、stopped 标志和 UID 退出同时得到观察证明时，才能继续验证动作或确认完成。

### 51.2 回归与范围

新增 9 项主机回归，覆盖三种停止证明失效（stopped=false、有残留 UID 进程、两者同时发生）、外层观察完成后/实际平台派发前重启、显式续查前重启、forward removal/uninstall 前重启和权限写后的重启。真实 Node SIGKILL 用例扩展至 `permission.camera.grant.verified`：父进程恢复实际观察状态、模拟 App 重启后，确认新恢复 owner 不继续写、不重复 stop，并保留原恢复证据。10 项相关专项通过，包含原有 stop verified 状态反转用例；正常恢复及 lost-reply reconcile 的首轮 9 项专项也通过。最终完整包验证见第 51.3 节。

`tcp:0` 转发回执丢失且 journal 没有 host port 时仍无法证明映射归属，恢复资格继续在任何平台工作前拒绝，不猜端口或删除候选映射。本切片补恢复停止前置条件，不声明未知 forward 分配可恢复，也不提升 Android 平台支持状态。真实专用 AVD、非空权限场景、Face ID/指纹、图库/镜头和每平台 20 次 attempt 的验收仍待完成。

### 51.3 最终验证与后续验收

`pnpm --filter @fliwright/native exec vitest run --maxWorkers=1`：33 个文件、448 项全部通过，耗时 227.44 秒。native build/lint 已通过；feature 文档生成器已刷新 649 份 references（16 packages、292 CLI commands），capability 生成器刷新 17 份文件；`node scripts/verify-harness.mjs` 通过。生成器、实现文档、capability 和本切片源文件、测试、计划均完成空白检查。测试未提高 timeout；这些结果是主机侧行为与构建证据。

后续仍以第 39、49 节的交付和退出条件为准：先补 Android 恢复剩余 ADB dispatch/readback、durable checkpoint 与归档故障边界，再在可运行的专用 AVD 上完成 inspect → restore → 新 lease → managed attempt，以及真实权限 prompt/granted/denied、allow/deny/cancel 与最终 baseline readback。只有平台证据通过后，才逐项开放非空高层权限场景并验公开 Worker/Vitest 链路。已有 HVF/mprotect 启动阻塞没有新条件时不重复启动实验。

独立继续 iOS 生物识别公开接口可行性、可信 enrollment/challenge/业务结果、图库资源归属与定向清理、Android preboot cameraSource 及实际镜头帧验证。真机 Face ID/指纹不承诺自动通过；相机固定结果继续标为 app-test-seam。每平台 20 次独立混合 attempt、延迟统计、双设备及 Worker 故障矩阵仍为发布门槛，不能由本轮 448 项主机回归替代。整体目标保持实施中。
