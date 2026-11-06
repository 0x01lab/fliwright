# 原生会话独占、未知结果与平台支持证据

- Status: accepted
- Date: 2026-11-03
- Scope: 原生会话、Vitest 生命周期、证据和 CLI 接入；不涵盖完整硬件场景的完成声明
- Evidence: `packages/fliwright-core/tests/ManagedAppLifecycle.test.ts`, `packages/fliwright-vitest/tests/managed-app-fixtures.test.ts`, `packages/fliwright-cli/tests/managed-control-env.test.ts`, `packages/fliwright-core/tests/native/NativeRuntime.test.ts`, `packages/fliwright-core/tests/native/NativeConfig.test.ts`, `packages/fliwright-native/tests/`, `scripts/tests/native-stack-contract.test.mjs`, `docs/superpowers/plans/2026-11-03-native-device-automation.md` 第 11 节, `packages/fliwright-core/tests/native/NativeEvidence.test.ts`, `packages/fliwright-vitest/tests/native-fixtures.test.ts`, `packages/fliwright-vitest/tests/native-fixture-failures.test.ts`, `packages/fliwright-cli/tests/native.test.ts`, `packages/fliwright-cli/tests/artifacts-manifest.test.ts`, `scripts/tests/prepare-native-demo.test.mjs`, `examples/form_demo/test/native_fixture_test.dart`, `e2e/.fliwright/tests/native-mixed.test.ts` 与实施计划第 21 节
- Changed-Files: `packages/fliwright-core/src/ManagedAppLifecycle.ts`, `packages/fliwright-cli/src/ManagedAppRun.ts`, `packages/fliwright-vitest/src/TaskManagedApp.ts`, `packages/fliwright-tdd/src/daemon/SubprocessDaemonTransport.ts`, `packages/fliwright-core/src/CameraTestController.ts`, `packages/fliwright-bridge/lib/fliwright_bridge.dart`, `packages/fliwright-bridge/lib/src/testing/camera_test.dart`, `examples/form_demo/lib/camera_fixture.dart`, `examples/form_demo/lib/camera_fixture_main.dart`, `packages/fliwright-core/src/Scenario.ts`, `packages/fliwright-core/src/ScenarioDevicePreparation.ts`, `packages/fliwright-vitest/src/TaskScenarioPreparation.ts`, `packages/fliwright-cli/src/commands/scenario.ts`, `packages/fliwright-core/src/RecordingConfig.ts`, `packages/fliwright-core/src/index.ts`, `packages/fliwright-core/src/native/DeviceController.ts`, `packages/fliwright-core/src/native/NativeAssertion.ts`, `packages/fliwright-core/src/native/NativeConfig.ts`, `packages/fliwright-core/src/native/NativeLocator.ts`, `packages/fliwright-core/src/native/NativePage.ts`, `packages/fliwright-core/src/native/NativeRuntime.ts`, `packages/fliwright-core/src/native/index.ts`, `packages/fliwright-core/src/native/types.ts`, `packages/fliwright-native/package.json`, `packages/fliwright-native/runners/ios/FliwrightRunner.swift`, `packages/fliwright-native/runners/ios/FliwrightRunner.xcodeproj/project.pbxproj`, `packages/fliwright-native/runners/ios/FliwrightRunner.xcodeproj/xcshareddata/xcschemes/FliwrightRunner.xcscheme`, `packages/fliwright-native/src/DeviceLease.ts`, `packages/fliwright-native/src/NativeSession.ts`, `packages/fliwright-native/src/ToolExecutor.ts`, `packages/fliwright-native/src/android/AdbSession.ts`, `packages/fliwright-native/src/android/AndroidSnapshot.ts`, `packages/fliwright-native/src/index.ts`, `packages/fliwright-native/src/ios/PrepareIosRunner.ts`, `packages/fliwright-native/src/ios/RunnerBroker.ts`, `packages/fliwright-native/src/ios/XctestRunner.ts`, `packages/fliwright-native/src/ios/XctestSession.ts`, `packages/fliwright-native/src/ios/XctestSnapshot.ts`, `packages/fliwright-native/tsconfig.json`, `scripts/native-stack-contract.mjs`, `scripts/verify-harness.mjs`, `packages/fliwright-core/src/RunSession.ts`, `packages/fliwright-core/src/native/NativeEvidence.ts`, `packages/fliwright-native/src/NativeBinding.ts`, `packages/fliwright-native/src/NativeDeviceSession.ts`, `packages/fliwright-native/src/NativeDoctor.ts`, `packages/fliwright-vitest/package.json`, `packages/fliwright-vitest/src/TaskNativeSession.ts`, `packages/fliwright-vitest/src/TaskEndpointLease.ts`, `packages/fliwright-vitest/src/index.ts`, `packages/fliwright-vitest/src/runner.ts`, `packages/fliwright-vitest/src/AttemptContext.ts`, `packages/fliwright-cli/package.json`, `packages/fliwright-cli/src/config.ts`, `packages/fliwright-cli/src/index.ts`, `packages/fliwright-cli/src/registry/native.ts`, `packages/fliwright-vscode/src/webview/viewer/artifacts.ts`, `packages/fliwright-vscode/src/webview/viewer/components/DetailTabs.tsx`, `packages/fliwright-vscode/src/webview/viewer/components/WidgetTreeTab.tsx`, `packages/fliwright-cloud/src/web/replay-model.ts`, `packages/fliwright-cloud/src/web/Replay.tsx`, `packages/fliwright-vitest/src/preset.ts`, `packages/fliwright-cli/src/ManagedNativeRun.ts`, `packages/fliwright-cli/src/commands/run.ts`, `packages/fliwright-cli/src/registry/finite.ts`, `packages/fliwright-cli/src/run.ts`, `packages/fliwright-cloud-worker/src/executor.ts`, `packages/fliwright-cloud-worker/src/processes.ts`, `packages/fliwright-cloud-worker/src/worker.ts`, `packages/fliwright-cloud-worker/src/WorkerNativeOwnership.ts`, `packages/fliwright-cloud-worker/src/native-ownership-ipc.ts`, `packages/fliwright-native/src/android/AndroidPermissionPreparation.ts`, `packages/fliwright-cloud-worker/src/NativePreparationIpc.ts`, `examples/form_demo/lib/native_fixture.dart`, `examples/form_demo/lib/native_fixture_main.dart`, `examples/form_demo/native_fixtures/ios/AppDelegate.swift`, `e2e/native.project.ts`, `e2e/.fliwright/support/native-scenarios.ts`, `e2e/.fliwright/tests/native-mixed.test.ts`, `scripts/prepare-native-demo.mjs`, `harness/stack/framework.json`, `scripts/generate-feature-docs.mjs`, `examples/form_demo/native_fixtures/android/MainActivity.java`, `e2e/native.android.project.ts`, `e2e/.fliwright/tests/native-android-mixed.test.ts`
- Supersedes: none

## Decision

设备独占与 Flutter endpoint 独占是两种不同资源。原生工具必须绑定显式在线设备；host-wide 租约按稳定设备身份互斥，只有确认 owned Adapter/Runner 已退出且临时文件清理完成才释放。无法确认的设备保留 quarantine；失去活 owner 的锁不能仅凭超时自动回收。

点击、输入和生物识别属于写动作。传输结果未知时不自动重发；已投递请求取消/超时后，不允许新动作越过仍可能执行的旧请求。主机、broker 和 Adapter 各守住自己的一层边界；原生否定断言不能把断线当成节点消失。

平台声明以实际验证为准。Android ADB 已执行 Settings 导航/返回/截图；自研 iOS XCTest Runner 已验证 loopback 握手、唯一 ID 查询/点击、结果页面查询、截图及正常退出。重复文字的父子节点必须维持 strict 匹配；iOS 以查询下推避免每次都遍历整树。hostless UIScreen.bounds 曾与真实设备不符，应使用实际 XCUIScreen 像素和 scale 并另验旋转。完整树仍可能超时。

XCTest 构建是显式、无签名的 Simulator prepare，按源码/协议/Xcode/SDK/架构输入缓存；Swift imports、源码列表与 Xcode build settings 纳入 framework.json 和 checker。Node 包 import 不启动工具。Android XML 使用已登记的 saxes 完整解析，禁 DTD、限节点/字节和深度；不能用正则解析树。

这些验证只覆盖基础会话。真实 Flutter 混合用例、managed/Worker 生命周期、硬件业务结果、权限/图库/相机和正式设备矩阵仍须通过各自验收；不能把结构存在、命令返回或单测通过写成完整产品能力已上线。

## Lifecycle And Evidence Integration

Vitest 的 task 设备所有权必须跨 retry 保持，每个 attempt 使用新的 Adapter/generation。资源状态通过 task 上的 Symbol.for 在 runner/fixture 的多个 module graph 间共享。绑定校验读当前 VM PID，再由所选设备的进程表验证目标 package/bundle，不能信任旧 runtime metadata。清理或 owner release 失败应影响当前测试并持久化结果，不能从 runner finally 抛出并中止同文件的 peer tests。

RunSession 在 action 返回前采集证据，因此原生 provider 必须使用受控 Adapter 只读入口，不能递归排队 native.screenshot。动作、排队和证据各有预算；证据沿用 attempt finalization 的取消信号，但不继承已结束 action body 的 abort。保留原始操作错误，证据失败仅标记 partial；证据超时后不得继续复用可能有未完成请求的原生会话。surface provider 可以随 fixture 注册，不能因此修改已经开始的 recording policy。原生树 wrapper 和 artifact surface metadata 必须贯穿离线导出与 viewer，不能按 Flutter widget schema 解码。

CLI doctor 只检查环境，不启动/构建 Runner；prepare 才是显式构建流程，snapshot 则持有设备租约并在结果/失败后清理。iOS doctor 的环境 ready 与 Runner 已握手是不同事实。双重操作/清理失败保留两个错误，不能让 finally 中的清理异常抹掉原始平台故障。CLI → native 与 Vitest → native 是批准的单向依赖。

## Delegated Managed Ownership

managed CLI 在 Flutter daemon 启动前取得设备租约；只通过子进程专用环境变量传递显式委托，不将其放入项目配置、命令输入、job journal 或报告。宿主锁只保存委托 token 的摘要。task 的委托 claim 在父租约内部互斥，独立 CLI 仍等待父租约；不允许重新取得父租约导致自锁。每次 Adapter 请求检查 owner token，监控父进程活性/代次；失去所有权会取消请求并停止 owned Adapter。仍有委托 claim 时父进程关闭会保留锁并 quarantine，不能删除活跃子会话的保护。

Cloud Worker 的持有者是 supervisor，executor 通过有界 IPC 请求委托。supervisor 只接受当前 checkout/project 的一次请求，不将凭据写入 IPC timeline 或 job journal。executor 退出后，租约仍保持到 supervisor 确认 owned process group 退出且最终 reset 完成；reset 失败则 quarantine。不得把持有者放在即将退出的 executor 中，留出释放到 reset 之间的竞争窗口。无 native 配置时只解析项目配置，不启动平台工具。

动态 skip 需要等待 fixture 清理和 runner attempt 收尾两阶段完成，再释放所有权和写最终 handoff。清理失败必须清除 Vitest 的 pending skip 投影并记录为 failed；Adapter 和 owner 双重错误分别保留，不能以第二次清理异常中止 peer tests。


## Device Scenario Preparation

设备层是整个场景的单例资源；可移植 baseline/fixture 引用与权限声明需要严格 schema 和 JSON/fingerprint 回归。当前只开放 requiredCapabilities 的只读准备。破坏性字段在任何平台工作之前拒绝，不能在已经连接 Bridge 的 ScenarioCoordinator 中执行重置或静默忽略。

managed owner 在 launch 前检查所选场景能力并关闭临时 Adapter 后才委托子进程；Worker 选择与 request 一致，direct run 显式传 null，不能回落到仓库 defaultScenario。每次 Vitest attempt 在 Bridge 连接前检查，retry 新建 Adapter 后重做。worker-only Symbol 元数据保留显式场景，扩展 fixture 与默认场景遵循同一路径。

准备凭据是单次消费的活对象，绑定完整声明 fingerprint、attempt、mode、identity/generation；应用阶段再次读取 readiness，失败后不能复用旧凭据。JSON 报告只保存设备摘要和检查结果。准备期读取必须遵守原生队列/预算/取消/租约，但不能在 timeline 配置前启动 RunSession operation，否则冻结 recorder/policy/endpoint 初始化。应用阶段复核正常记录。证据见 core ScenarioDevicePreparation/NativeRuntime、Vitest device-scenarios 真实 worker、CLI managed-native/managed-native-launch 和 Worker executor-timeline 回归。


## Camera App Test Seam

cameraTest 仅由 app 测试入口显式注册；默认和 release 入口不得启用。Dart capability 提供 reset/enqueueResult/getStatus，app 测试适配器调用带 generation 的 capture。image/cancel/error 分支独立，每次 capture 最多消费一项；空队列失败，不回落真实相机。PNG/JPEG fixtureId 由 app 的 loader 映射到随 app 分发的可读资源，校验内容解码、大小和预算，不接受主机路径，不把图片字节写入状态报告。异步加载跨 reset 时拒绝旧结果。

TypeScript CameraTestController 和惰性 cameraTest fixture 每 attempt 重新取得代次、结束检查残留并执行带旧代次的 reset，旧控制器不能清空新 attempt 的队列。写结果未知后拒绝新 enqueue，不重发旧写。所有录制操作标记 coverage=app-test-seam；这不构成权限弹窗、相机 UI 或镜头验收。skip 时残留结果同样是 failed，清除 pending skip 投影，避免未释放 endpoint 阻塞后续用例。

capability 请求默认 5 秒上限；fixture 清理进入 attempt finalization 的预算，过期 signal 阻止后续 reset。图片 loader 5 秒、字节最多 10 MB、解码后最多 16 MP，每代最多 32 项。真实 macOS CLI 验收成功消费 4 项、pending=0、evidence=complete；复现步骤、工具链和临时证据位置见实施计划第 14 节。

独立 form_demo camera 入口消费公开 bridge API，提供确定性预览、取消、错误、重拍与本地上传接收器；不修改 Exio。框架共用能力保持在 bridge/core，demo 仅包含业务消费 UI。证据：bridge camera_test_test.dart、core CameraTestController.test.ts、Vitest camera-fixtures.test.ts 真实 worker、demo camera_fixture_test.dart；真实 CLI 验证及硬件矩阵状态见实施计划。

## Managed App Attempts

native-enabled managed run 的每个 attempt 都通过 supervisor stop/relaunch/verify，含无场景、app-only 场景和 retry；不能只给 device layer 重启，导致后续普通用例继承旧 endpoint。设备 owner 跨 retry 保持，旧 endpoint 在清理 Adapter/driver 后释放，新 endpoint 进入当前 attempt 配置并重新核验 VM PID。driver 只在 attempt 内缓存，被动诊断结束后再有界关闭；失败/超时使 attempt failed、清除 pending skip，隔离设备并阻止继续复用。

core ManagedAppLifecycle 使用私有认证 loopback、单次 attempt key、成对 name/fingerprint、并发排斥与失败围栏。CLI/Worker 共享配置校验和 stop/launch helper，凭据只传私有环境变量，不放共享配置、日志和报告；无显式控制时清空继承值。客户端断开/预算到期取消 owned startup，关闭等待仍未结束的准备，不能把未知状态写成清理完成。daemon transport 在 SIGKILL 后仍需等待 exit；每次 relaunch 新建 transport。

证据：core ManagedAppLifecycle.test.ts、CLI managed-app.test.ts/managed-control-env.test.ts、Vitest managed-app-fixtures.test.ts、Worker executor-launch.test.ts/executor-timeline.test.ts、TDD SubprocessDaemonTransport.cleanup.test.ts。真实 Android relaunch 验收被 Emulator 的 hvf/mprotect 启动错误阻塞，临时设备和 scaffold 已移除，详见实施计划第 16 节；不得从 worker 回归宣称平台业务已通过。权限等 mutation 仍明确拒绝，下一步需在当前 owner 内增加 preparation/readback/恢复，不能重新抢已委托的同一租约。

## Permission Preparation And Operation Exclusion

Android 权限底层准备可以在 retained owner 内执行，但不能从原语存在推断场景已支持。当前只处理专用 Emulator、主用户 0、targetSdk ≥ 23、无共享 UID 的 camera/microphone；目标必须 force-stopped 且整个 UID 无进程，不能只按包名前缀判断，自定义 process name 也属于应用。配置应使用 schema 的独立快照，避免调用方后续修改把平台操作重定向到别的设备/包/tool path。

整批声明和 grants/flags/app-op 先校验后写。prompt、曾拒绝、授予按 USER_SET/USER_FIXED 区分；曾拒绝不等于永久拒绝。未知/策略/固定/一次性 flags 与自定义/UID app-op 没有可验证恢复策略时应拒绝，不重置系统状态掩盖差异。默认 package app-op 限制尚需现代 Android 业务验证，不能把 pm 退出码或 grants/flags 读回当作有效镜头权限或真实弹窗证明。

每次声明替换前次声明，省略项恢复首次捕获原始值；归还 owner 前用独立预算恢复/readback。派发写之前就标记 unknown，完整复核后才清除；失去响应后不重发、不对未知状态盲目 restore。取消调用方不等于工具已退出，必须保留底层工作和互斥；清理超时隔离且阻止晚到工作继续恢复。

父 owner 与委托 child 共用设备目录内的 operation mutex；整批准备/恢复、Adapter 请求以及 VM PID 绑定的工具读取都进入同一互斥。只保护 Adapter 会遗漏绑定阶段的直接读取；等待必须计入总预算，owner 关闭应取消并等待底层读取。不得在父进程重取已委托的 child claim。活跃操作尚未结束时 release 保留锁/quarantine；业务、初始化、清理、隔离和释放的多重异常分别保留，finally 不能抹掉原始原因。

证据：native 的 AndroidPermissionPreparation.test.ts、DeviceLeaseOperation.test.ts、DeviceLeaseDelegation.test.ts 真实 child、NativeDeviceSession.test.ts、NativeSession.test.ts。设计与实施计划第 17/18 节记录高层接线及平台验收要求。场景权限和 device.permissions.set 仍拒绝；本轮专用 AVD 显式 HVF 也未成功启动，未记录真实权限业务通过，不涉及个人设备或主机安全设置更改。

## Retained Owner Attempt Preparation

stop/relaunch 的控制进程与设备 owner 可以不在同一进程。Worker executor 只能把当前 project、单次 attemptKey 和成对场景 name/fingerprint 交回 supervisor；owner 根据获取所有权时的配置独立校验并执行准备，不接受任意平台命令。CLI 直接调用相同 owner prepareAttempt。每次 device scenario 都新建/检查/关闭准备 Adapter；无场景 peer 也经过通道但不继承默认场景。child 启动后仍独立复查 readiness，成功 JSON reply 不能充当 live receipt。

IPC 预算、取消、断开、并发及重放围栏必须保留真实未结束工作；提前回复取消不等于清理完成。supervisor reset 先取消并等待准备，未确认结束时不能执行 reset 或再次 acquire，关闭 owner 以 cleanupConfirmed=false 保留隔离。reset 与 owner release 的多重失败保留。Adapter/Runner 构造可能在第一次请求之前触碰设备，也必须进入跨进程 operation mutex；只包装 capabilities/snapshot/action 不足以防止准备并发。

owner acquisition 也是需要取消和有界等待的工作。executor 退出后不能永远等待尚未取得的设备租约；迟到授权必须以 cleanupConfirmed=false 清理，不能在 reset 已结束后把它写回 owner。回归使用忽略取消的 acquisition，证明超时不执行 reset、不复用，以及迟到授权仍清理。

证据：CLI managed-native/managed-app/managed-native-launch；Worker NativePreparationIpc 与 client IPC、worker-native-ownership、executor-timeline direct/supervised 多 attempt；processes.test.ts 真实 Node executor 通过文件事件确认准备已投递后取消并拒绝后续执行；native NativeSession.test.ts 初始化互斥。实施计划第 19 节记录此只读准备通道，高层权限等 mutation 仍需接线、readback 与实际平台验收，不从通道或单元测试存在推断权限/生物识别业务已支持。

## Managed Stop And Independent Permission Observation

force-stop 是写动作。派发前校验目标 package/User 0/隔离 UID，派发后同时确认 stopped 标志和整个 UID 无进程；成功回复不能证明自定义进程已经退出。停止请求取消或结果未知时不重发、不继续权限准备，保留未结束的工具工作与设备互斥并隔离。owner dispose 不暗中杀 app，恢复原始权限前仍由 managed 调用方确认最终停止。

启动后的权限复核必须是独立只读观察，允许活跃 Adapter 但经过同一 operation mutex，等待计入总预算；它不能捕获恢复基线，否则 child 结束会把 supervisor 的准备结果误当作自己应恢复的状态。观察 grants/flags 与默认 app-op 仍不等于真实权限 UI 或相机访问通过。底层 API 存在不开放场景权限，后续应将观察与新 endpoint、PID、generation 和单次凭据接线后再做平台业务验收。

证据：AndroidPermissionPreparation.test.ts 验证停止前拒绝错误包/共享 UID/不可用用户、停止回复后残留自定义 UID 进程、未知停止不重发和只读观察不写入/不采纳基线；NativeDeviceSession.test.ts 验证 parent 停止/准备、launched child 观察、parent 最终恢复，以及取消停止保留底层工作、锁等待预算。实施计划第 20 节保留当前原语与未完成高层集成的边界。

## Maintained iOS Mixed Fixture

移动端混合验收维护 Dart/Swift 源码与可移植命名场景，用脚本在新临时目录生成宿主；生成的 Flutter/Xcode 工程、本机 Runner 配置和设备状态不进入源码。source-only fixture 同样需要 stack 的 source roster/import 治理，并拒绝夹带生成工程或依赖/build manifest。fixture 原生通道只在显式 Simulator Debug 条件启用；Flutter 生成 Runner 的 Debug 名称不保证 Swift `DEBUG` 已定义，应检查实际 build settings 并显式设置专用条件。

iOS 26 的实际 launchctl 标签为 `UIKitApplication:<bundle>[hex][rb-legacy]`。VM 绑定按完整语法、精确 bundle 与当前 PID 核验；相似包名、旧 PID、畸形/附加后缀不能通过。该已观察格式与已有 application 标签各有回归，不以模糊包含匹配修复设备绑定。

真实 CLI 已通过 UIKit 确认/取消及系统麦克风允许/拒绝，再断言 Flutter 业务状态；连续确认用例具有不同 managed app/Adapter generation。两个麦克风用例由外部工具各自 reset prompt，不能据此开放高层权限声明或声称自动恢复/音频采集。保留排障时的原始失败；修复后四项通过不构成发布稳定性样本。此前 Android 启动阻塞仍独立存在，不影响 iOS 的有限证据，也不由 iOS 推断 Android/生物识别/相机支持。

证据：NativeBinding.test.ts、scripts/tests/prepare-native-demo.test.mjs、native-stack-contract.test.mjs、demo native_fixture_test.dart、e2e native-mixed.test.ts；复现、实际版本、原始运行与清理记录见实施计划第 21 节。测试结束重置/卸载自有 app、恢复专用 Simulator 原始 Shutdown 状态，删除生成宿主但保留 canonical evidence，不操作个人或 Worker 设备。

## Android Fixture And One Cleanup Deadline

维护的 Android fixture 消费 Flutter embedding 与系统 API，在 debuggable app 中注册真实 AlertDialog/运行时权限通道；使用新临时宿主构建，不纳入生成 Gradle 工程。staging 与 native stack 治理同时覆盖 Java/Kotlin source/import 与 Gradle manifest 拒绝。app-owned 只读权限观察返回 granted/rationale，Dart 严格核验；rationale=false 不能当 prompt/永久拒绝分类，也不替代 owner/child 的 grants/flags 或恢复凭据。

owner dispose 的 cleanupTimeout 是等待、Adapter dispose、权限 restore 的总预算，restore 不得重新计时。使用同一 deadline 和独立于已取消 task 的 cleanup signal，在总期限或其他清理失败时取消；被延迟的读回/等锁返回后不得继续派发新的恢复写。已经派发的命令忽略取消仍为 unknown，保留工作与 quarantine；不能把停止等待当作命令已退出。

证据：NativeDeviceSession.test.ts 的 40 ms deadline 回归先红后绿；native 全量 89 项、demo native fixture 7 项、宿主/stack 脚本 6 项及两平台 E2E 类型检查。真实 Android Debug APK 构建与 apkanalyzer 证明编译/manifest，未证明权限业务。专用 AVD 再次 HVF/mprotect offline，原始日志及清理记录见实施计划第 22 节。首次安装、prelaunch prepare、postlaunch 独立复核与最终恢复仍需接线/平台验收；高层权限声明保持拒绝。
