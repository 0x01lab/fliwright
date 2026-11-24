# macOS 27 上的 Device Hub 对 Fliwright 的影响

调研日期为 2026 年 11 月 21 日。目标环境是 **macOS Golden Gate 27.2.1（26B131）和 Xcode 27.2（27B52）**，分别于 11 月 9 日和 10 月 29 日发布。macOS 和 Xcode 的最新预览版都是 11 月 16 日发布的 27.3 beta 2。Device Hub 随 Xcode 27 提供。Xcode 27.2 的最低宿主版本是 macOS 26.6，各项命令的实际支持还取决于 CoreDevice、模拟器 runtime 和设备型号。[Apple 发布记录][releases] · [Xcode 27.2 发布说明][xcode272] · [WWDC26 Device Hub][wwdc]

## 结论

**Fliwright 可以通过 Xcode 27 扩展 iOS 设备自动化。** Apple 明确支持用 `devicectl` 操作已启动的模拟器，提供 DeviceFS，并为 `simctl` 和 `devicectl` 增加模拟器重启支持。对当前 Fliwright 测试 API，最值得验证的是 **Face ID / Touch ID 事件**。对 Cloud，最直接的改进是 **收集目标 app 的崩溃报告**和**简化模拟器重启**。横竖屏、显示器信息和窗口尺寸可扩大布局测试覆盖。Apple 另提供 Xcode MCP 供 agent 操作设备。[Apple 命令行指南][apple-cli] · [Xcode 27 发布说明][xcode27] · [Bitrise 实测][bitrise] · [AutoMobile 实测][automobile]

## 命令和用途

| 能力 | 版本证据与 Fliwright 用途 |
| --- | --- |
| **Face ID / Touch ID** | Bitrise 在 Xcode 27 早期 beta 报告 `devicectl device settings biometrics --enable/--disable` 可设置模拟器 enrolment，`devicectl device simulate biometrics --success/--failure` 可注入结果。AutoMobile 在 27.1 beta 也报告模拟器生物识别可用。可复用 `device.biometrics.match()` 和 `reject()`。在 27.2 上需确认实际命令、无界面执行及 Flutter app 对每种结果的观察方式。[Bitrise 实测][bitrise] · [AutoMobile 实测][automobile] · [DeviceController.ts][device-controller] |
| **横竖屏和显示信息** | AutoMobile 在 Xcode 27.1 beta 实测 `devicectl device orientation get/set/rotate`、`device info displays` 和 `device capture screenshot --display-unique-id` 可用于模拟器。显示信息包含 iPhone Duo 内屏和外屏各自的 `active` 状态，duoctl 在 27.2 也用 `device info displays` 读回显示状态。XCTest 已有 `XCUIDevice.orientation`，CLI 的增量是能脱离 Runner 设置和读回方向。测试可一起观察 Flutter viewport 和对应显示器截图，区分物理方向与 app 布局变化。[AutoMobile 实测][automobile] · [duoctl 实测][duoctl] · [XCUIDevice.orientation][xcui-orientation] |
| **DeviceFS 和故障产物** | Apple 为已启动的模拟器和可连接的真机提供 DeviceFS。`devicectl device info mountpoint --device <UDID>` 可取单设备路径。挂载点可能提供 `DiagnosticReports`、`AppDataContainers`、`AppGroupContainers` 和 `Temporary`，实际访问范围视权限而定。Fliwright 可在失败时收集目标 app 的崩溃报告并放入本次运行产物。Apple 将 `device copy to/from` 文档化为真机传输，AutoMobile 在 27.1 beta 的模拟器文件复制实测返回不支持。[Apple 命令行指南][apple-cli] · [AutoMobile 实测][automobile] |
| **模拟器重启** | Apple 确认 Xcode 27 为 `simctl` 和 `devicectl` 增加模拟器 `reboot`。Cloud worker 可以在专用槽位验证 `simctl reboot <UDID>` 加现有启动等待，并确认重启后重新建立 app、XCTest Runner 和 VM Service 连接。Xcode 27 模拟器 runtime 还包含预构建 dyld cache，Apple 将收益归于首次启动。[Xcode 27 发布说明][xcode27] · [Cloud worker host.ts][cloud-host] |
| **安装和启动** | Apple 文档支持为已启动模拟器和已配对真机安装并启动 app，启动时可传入 `--environment-variables`。这适合需要对两类设备使用统一入口的预构建 `.app` 工作流。Fliwright 的 Flutter 调试会话还需要通过 `app.debugPort` 获取对应进程的 VM Service URI。[Apple 命令行指南][apple-cli] · [FlutterDaemonController.ts][flutter-daemon] |
| **无障碍环境** | 深浅色、Dynamic Type 和加深对比度已有 `simctl ui` 命令。AXe 已通过 Xcode 27 的 `devicectl` 提供 VoiceOver、减少动态效果、降低透明度和色彩滤镜控制。这些可用于 Fliwright 的无障碍场景准备。AXe 记录了首次启用 VoiceOver 的弹窗会阻挡输入，设备准备时需要处理。[模拟器环境指南][sim-environment] · [AXe 设备设置][axe-settings] |
| **内存压力和窗口尺寸** | Bitrise 在早期 beta 记录了 `device process sendMemoryWarning`，以及用于 iPad 模拟器的 `device appResize start/set/observe`。Apple 另文档化了 iPhone 模拟器的图形界面 resize mode，并在演示中使用 iOS 27 SDK。27.0/27.1 的另一份实测未找到可自动改变窗口宽度的路径，接入前需按目标设备、runtime 和具体 resize 模式验证。[模拟器环境指南][sim-environment] · [WWDC26 UIKit][uikit] · [Bitrise 实测][bitrise] · [Xcode 27.0/27.1 实测][sim-automation] |
| **横跨真机和模拟器的设备元数据** | Xcode 27 的 `devicectl` 支持将结构化输出直接写到 stdout。Apple 从 JSON v5 开始在设备详情中弃用 `hardwareProperties`、`deviceProperties`、`connectionProperties`，改用 `properties`。AutoMobile 已观察到把模拟器记录误判为真机盘点失败的情况。接入前应取得目标版本输出样本，验证设备分类和 UDID 映射。[Xcode 27 发布说明][xcode27] · [AutoMobile 盘点问题][automobile-inventory] · [DeviceDiscovery.ts][device-discovery] |

## Device Hub 界面和其他自动化入口

- **Device Hub 界面。** 新增附近 iPhone、iPad 和 Apple Watch 的无线配对，Apple 对 iPhone 和 iPad 明确要求系统为 27 或更新。27.2 提供 Sidecar 和支持触控的 Mac 输入转发、iOS 17 模拟器输入，以及慢动画、摇动、跌落、内存压力菜单。27.3 beta 加入 Option 拖动双指手势和拖放 app、链接、文件。各项 CLI 能力需单独核实。[配对指南][pairing] · [Xcode 27.2 发布说明][xcode272] · [Xcode 27.3 beta 2 发布说明][xcode273]
- **Xcode MCP。** Apple 文档提供外部客户端入口 `xcrun mcpbridge`。Xcode 27 另有无需打开 workspace 的 MCP server 预览。公开的 27.2 `tools/list` 快照包含 `DeviceInteractionStartSession` 和 `DeviceInteractionSynthesize`，声明支持 tap、swipe、type，并能返回 UI 层级、截图和日志路径。27.0/27.1 的实测在 Device Hub 运行时验证了触控和层级读取。适合验证 agent 快速探查，实际接入仍需测无界面运行、目标 UDID、并发会话和产物路径。[Apple 外部 agent 指南][mcp] · [Xcode 27 发布说明][xcode27] · [27.2 MCP schema 快照][mcp-schema] · [Xcode 27.0/27.1 实测][sim-automation]
- **iPhone Duo。** Xcode 27.3 beta 的 XCUIAutomation 有新类 `XCUIHinge`，可设置 iPhone Duo 铰链角度。`devicectl device motion hinge-angle` 曾在 27.1 beta 读到角度，duoctl 的作者在 27.2 实测发现该命令已移除。可在 Fliwright Runner 评估 `XCUIHinge`，再用显示信息和 Flutter viewport 验证布局。27.2 发布说明记录了 Duo 启动后截图可能暂时为黑色、Device Hub 的无障碍工具暂时无法呈现 Duo 屏幕，以及 27.2 runtime 克隆可能失败。[Xcode 27.3 beta 2 发布说明][xcode273] · [Xcode 27.2 发布说明][xcode272] · [AutoMobile 实测][automobile] · [duoctl 实测][duoctl]
- **Swift Testing。** Xcode 27.3 beta 允许 Swift Testing 与 `XCUIAutomation` 一起编写 UI 测试。Fliwright 的 Swift Runner 可以独立评估该支持，TypeScript/Vitest 测试脚本的接入点仍是现有运行时。[Xcode 27.3 beta 2 发布说明][xcode273] · [XCTest 会话实现][xctest-session]
- **Flutter 兼容性。** Flutter 3.47.0 已包含适配 `DeviceHub.app` 路径的修复。Fliwright 当前 CI 配置使用 3.47.8。升级验证关注 `flutter daemon` 的设备枚举、`app.start`、`app.debugPort`，以及仓库外按旧 `Simulator.app` 名称启动的脚本。[Flutter PR #187910][flutter-pr] · [Flutter 3.47.0 发布说明][flutter347] · [CI 配置][ci] · [FlutterDaemonController.ts][flutter-daemon]

## Fliwright 接入点与验证顺序

1. **先验证 iOS 生物识别。** `@fliwright/core` 已定义 `device.biometrics.match/reject`，`@fliwright/native` 的 iOS adapter 将它们标为 `unverified`。在 macOS 27.2.1、Xcode 27.2、iOS 27.2 模拟器上，按明确 UDID 测 enrollment、match 和 non-match。注入先后由测试 app 确认 challenge 已出现，以及成功回调或拒绝事件确实发生。`BiometricTestController` 已提供这类观察。若要支持每次运行的 `biometricBaseline`，还需补设备准备生命周期，现有场景验证会拒绝该配置。[DeviceController.ts][device-controller] · [XctestSession.ts][xctest-session] · [BiometricTestController.ts][biometric-test] · [ScenarioDevicePreparation.ts][scenario-preparation]
2. **增加现有 Cloud 流程可用的证据。** 在失败后、清理设备前验证 DeviceFS 上目标 app 当次运行的 `.ips` 能否进入产物目录。单独测重启前后的 boot generation、Runner 和 Flutter VM Service 就绪状态。现有 worker 使用 `shutdown → boot → bootstatus`，所以比较应涵盖清理正确性、耗时与失败恢复。[Cloud worker host.ts][cloud-host] · [IosSimulatorIdentity.ts][sim-identity] · [Apple 命令行指南][apple-cli]
3. **按功能接入设备控制。** `@fliwright/devices` 目前从 `simctl` 和 `xcdevice` 分别获取模拟器和真机。建议用 `simctl` 负责关机设备枚举及模拟器生命周期，在 `@fliwright/native` 为已启动设备按 CoreDevice 版本、runtime 和具体命令探测支持。AutoMobile 实测过自定义设备集在 CoreDevice 中不可见，以及 `DEVELOPER_DIR` 与实际加载的 CoreDevice 版本存在差异。用现有设备租约约束写操作。XCTest Runner 提供系统弹窗的元素定位，Dart VM Service 提供 Flutter 元素、路由和应用状态。Xcode MCP 的层级与截图可独立评估用于 agent 探查。[DeviceDiscovery.ts][device-discovery] · [NativeSession.ts][native-session] · [XctestSession.ts][xctest-session] · [Apple 命令行指南][apple-cli] · [AutoMobile 实测][automobile] · [27.2 MCP schema 快照][mcp-schema]

调研依据为 Apple 和 Flutter 官方资料、工具作者公开的 beta 实测与 27.2 MCP schema 快照，以及 Fliwright 仓库源码。Fliwright 在 macOS 27.2.1 / Xcode 27.2 的端到端运行结果仍待验证，尤其是无界面生物识别、DeviceFS 在 worker 执行账号下的可用性、显示器切换及 MCP 并发。

[releases]: https://developer.apple.com/news/releases/
[xcode27]: https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes
[xcode272]: https://developer.apple.com/documentation/xcode-release-notes/xcode-27_2-release-notes
[xcode273]: https://developer.apple.com/documentation/xcode-release-notes/xcode-27_3-release-notes
[wwdc]: https://developer.apple.com/videos/play/wwdc2026/260/
[uikit]: https://developer.apple.com/videos/play/wwdc2026/278/
[apple-cli]: https://developer.apple.com/documentation/xcode/interacting-with-devices-using-the-command-line
[pairing]: https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub
[sim-environment]: https://developer.apple.com/documentation/xcode/configuring-the-environment-of-a-simulated-device
[xcui-orientation]: https://developer.apple.com/documentation/xcuiautomation/xcuidevice/orientation
[mcp]: https://developer.apple.com/documentation/xcode/giving-external-agents-access-to-xcode
[mcp-schema]: https://github.com/artemnovichkov/xcode-tools-docs/blob/f71624fd7305d148459d286c0b07968266f41a85/tools-headless-27.2.json
[flutter-pr]: https://github.com/flutter/flutter/pull/187910
[flutter347]: https://docs.flutter.dev/release/release-notes/release-notes-3.47.0
[automobile]: https://github.com/kaeawc/auto-mobile/issues/8347
[automobile-inventory]: https://github.com/kaeawc/auto-mobile/issues/8623
[axe-settings]: https://www.axe-cli.com/docs/settings
[sim-automation]: https://github.com/capsrock/ios-simulator-automation-skill
[bitrise]: https://bitrise.io/blog/post/wwdc-2026-device-hub-and-what-it-means-for-ci-cd
[duoctl]: https://github.com/skarol/duoctl#how-it-works
[device-controller]: ../../packages/fliwright-core/src/native/DeviceController.ts#L10
[xctest-session]: ../../packages/fliwright-native/src/ios/XctestSession.ts#L68
[biometric-test]: ../../packages/fliwright-core/src/BiometricTestController.ts#L70
[scenario-preparation]: ../../packages/fliwright-core/src/ScenarioDevicePreparation.ts#L37
[cloud-host]: ../../packages/fliwright-cloud-worker/src/host.ts#L14
[sim-identity]: ../../packages/fliwright-native/src/ios/IosSimulatorIdentity.ts#L10
[device-discovery]: ../../packages/fliwright-devices/src/DeviceDiscovery.ts#L69
[native-session]: ../../packages/fliwright-native/src/NativeSession.ts#L21
[flutter-daemon]: ../../packages/fliwright-tdd/src/daemon/FlutterDaemonController.ts#L23
[ci]: ../../.github/workflows/ci.yml#L124
