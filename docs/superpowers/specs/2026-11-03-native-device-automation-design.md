# 原生元素与设备能力接入设计

日期：2026-11-03。状态：实施中。用户已认可不使用 Appium 的方向及 `native` / `device` 用例语法；底层会话、Adapter、fixture、证据、CLI/Worker 租约、只读设备场景检查及 app-owned 相机固定结果接缝已接入。相机固定结果业务示例已在 macOS 与 iOS Simulator 通过真实 CLI 验证；iOS Simulator 已通过原生确认/取消及系统麦克风允许/拒绝的混合用例。Android 权限准备及 owner 下的安装/无重装启动已有底层实现；CLI/Worker 已去除原生 managed 测试的预先启动，首个 attempt 才请求新 endpoint。独立 Debug APK 构建监督已有真实主机验证，并已接通 Android emulator 的 CLI/Worker retained owner：首个实际 attempt 构建安装、后续无重装启动、独立 Bridge/VM PID 绑定及 reset 前 quiesce。该接线已有确定性测试和真实子进程/协议对端验证；Android installed managed 路径已携带严格的安装/启动预期，child 在正文前独立读取 APK/UID/PID/声明集合并生成单次 readback；普通 attempt 目前只执行空权限声明替换。权限原始值、完整声明与每次待写步骤已有父 owner 持久化记录；恢复未确认或宿主崩溃时保留证据并阻止自动接管，委托 child 不能捕获基线或 managed stop。冻结场景到 installed preparation 的完整声明传递已接通，child 独立核对实际场景的权限语义并拒绝读取期间场景变化；现有高层入口仍在写前拒绝非空权限。Android 设备业务验收、非空权限场景、硬件能力及完整发布验收尚未完成。本文仍是目标契约，不代表全部能力已经上线。最新证据、限制与后续接线见实施计划第 18—49 节；Android recovery 的最新宿主 crash matrix 与剩余验收见实施计划第 49 节；第 13 节补充首次安装、无重装启动及生物识别挑战的目标契约。

实施顺序见[实施计划](../plans/2026-11-03-native-device-automation.md)。

2026-11-04 更新：当前交付边界见[第 15 节](#15-当前交付边界与后续方案2026-11-04)，剩余执行顺序见实施计划第 39、49 节；Runner-only 公开恢复及专用 Simulator 验收见实施计划第 45—48 节，Android host recovery 事务与 crash matrix 见第 49 节，新增恢复协议约束见本文第 16 节。前文的首期范围、示例与版本矩阵是目标契约，不能直接用作已支持能力清单。

## 1. 目标与范围

在同一份 Fliwright TypeScript test / script 中完成 Flutter → 系统弹窗或原生页面 → Flutter 的操作，并支持可验证的模拟器生物识别事件和相机测试环境。不引入 Appium、WebDriverAgent 或通用 WebDriver server。

保持三种入口：`page` 操作 Flutter；`native` 操作设备无障碍元素；`device` 控制设备测试能力。使用已有 `flow`、`expect`、TestScenario、RunSession、timeline 和 artifacts，调用方无需管理 ADB 命令、XCTest Runner 或进程通信。

服务于受测 Flutter 应用及其原生流程，不扩大成任意 APK/IPA、任意应用的通用测试框架；WebView DOM 自动化不在本次范围。原生驱动可能读取 WebView 暴露的无障碍节点，但不承诺 DOM、iframe、JS 或完整网页定位。

### 首批交付

- Android 模拟器和经验证的真机：原生查询、唯一定位、点击、滑动、返回、整屏截图；基础文本输入明确字符集限制。
- iOS Simulator：自研 XCTest Runner，查询、点击、文本输入、滑动、系统弹窗和截图；Xcode/Simulator 版本组合通过验证后列入支持矩阵。
- Android Emulator：已录入指纹对应的匹配事件、未录入指纹对应的不匹配事件；每次注入均有业务结果断言。
- 相机：系统权限与拍摄 UI 操作，以及应用自己提供的固定图片测试能力。两者分别报告，不能将固定图片称为真实镜头拍摄。

### 独立验证后再开放

- iOS Simulator Face ID / Touch ID 自动注入；Simulator 支持人工模拟不等于已有稳定的无界面编程接口。
- Android 常驻 UIAutomator Runner、可靠中文输入、虚拟相机固定场景，以及 iOS 真机 Runner 通信与签名。
- 真机生物识别结果由真人完成；第三方活体识别仅使用供应商官方测试模式或显式人工步骤。

## 2. 当前事实与证据

当前定位从 `WidgetsBinding.instance.rootElement` 遍历 Flutter Element，点击通过 `GestureBinding.instance.handlePointerEvent` 注入 Flutter 指针事件。现有坐标点击不能解释为系统级触摸注入。

`@fliwright/devices` 只负责只读设备发现；架构契约明确不拥有启动、重置和设备交互。新增原生操作归 `@fliwright/native`，不能直接塞入 devices。设计启动时 Vitest 仅依赖 core；本轮已显式登记 Vitest/CLI → native 和 native → core/devices 的包依赖及治理契约，core 保持不依赖 native 平台实现。

本次只读检查：本机 Xcode 26.6 / Build 17F113 的 `xcrun simctl help io` 提供截图、录像、屏幕配置等，没有通用元素查询/点击；`xcrun simctl help privacy` 列出 photos、microphone 等服务，未列出 camera。不得编造 `simctl privacy grant camera` 或把相册导入解释为镜头输入。其他 Xcode 版本仍需独立探测。

源码锚点：

- `packages/fliwright-bridge/lib/src/extensions/inspect.dart`、`gesture.dart`。
- `packages/fliwright-core/src/Scenario.ts`、`Assertion.ts`、`RunSession.ts`、`EvidenceCapture.ts`、`EndpointLease.ts`。
- `packages/fliwright-vitest/src/index.ts`、`packages/fliwright-cli/src/commands/run.ts`。
- `harness/architecture/dependency-rules.json`。

平台依据：

- [Android Emulator console](https://developer.android.com/studio/run/emulator-console)：`finger touch` / `finger remove`；录入和验证是两个步骤。
- [Android Emulator 启动参数](https://developer.android.com/studio/run/emulator-commandline)：当前文档列出 imagefile、videofile、webcam、environment 等相机来源；image360 标注需要 Emulator 36.6.4 及以上。实际安装版本和 AVD 必须验证，不推断所有设备都支持。
- [XCUIApplication](https://developer.apple.com/documentation/xcuiautomation/xcuiapplication)、[XCUIElement](https://developer.apple.com/documentation/xcuiautomation/xcuielement)：当前 Apple XCUIAutomation 文档确认应用代理和元素能力；通过 XCTest UI Test Runner 使用。
- iOS 生物识别无界面自动注入路径尚未验证；不将私有通知或 Simulator 菜单脚本写成已支持的平台契约。

## 3. 模块职责与依赖

| Module | 责任 | 不承担 |
| --- | --- | --- |
| `@fliwright/core` | NativePage、NativeLocator、DeviceController、能力/错误模型、等待/断言、场景和证据语义 | ADB、Xcode、Runner 构建及签名 |
| 新增 `@fliwright/native` | 原生 Adapter、设备会话、平台工具执行、Runner 构建/启动/停止、能力探测 | Vitest 生命周期、Cloud 调度、Flutter 状态操作 |
| `@fliwright/devices` | 设备发现及工具诊断 | 设备操作 |
| `@fliwright/vitest` | 注入 `native`、`device` fixture，绑定 attempt 与清理 | 平台原语 |
| CLI / Worker | 选择设备、创建会话、传递租约、监督进程与诊断 | 复制原生实现 |
| Dart bridge / 目标 app | Flutter 操作；注册 app-owned 相机测试能力 | 系统无障碍树及系统弹窗控制 |

外部 Seam 是 core 的 NativeSessionAdapter / DeviceSessionAdapter 契约，由 Android 与 iOS Adapter 实现。工具执行器和通信实现是内部 Seam，可注入真实临时子进程或协议测试对端进行测试。平台差异、取消、错误映射和快照规范化集中在 Adapter 内部。

拟议依赖方向：native → core、devices；vitest → core、native；CLI → native（保留已有依赖）；Worker 通过 CLI 执行，只有确实直接使用时才声明 native 依赖。core 不反向依赖 native；包 import 本身不启动工具。VS Code 优先消费 CLI 用例，不复制驱动。

Runner 源码放在 `packages/fliwright-native/runners/ios/`，后续 Android Runner 放在同级 `android/`。Swift/XCTest、可选 Kotlin/AndroidX Test 及使用的 SDK 版本先纳入 `harness/stack/framework.json` 和验证脚本可识别的框架契约，再添加工程。编译产物置于本机 runtime cache，不提交进仓库。

## 4. 用例 Interface

本节描述目标用法。native/device fixture 和原生定位/断言已实现；以下 device scenario、权限/图库及硬件业务场景仍需实现和设备验收，不能将整段示例视为已验证用例。示例 Key、文字和 app capability 必须替换为受测项目真实值，系统文字随语言和 OS 变化。

```ts
import { test, expect } from '@fliwright/vitest';

test.scenario('photo.system-picker')('从系统图库选择照片', async ({ page, native, flow }) => {
  await flow.step('打开系统图库', async () => {
    await page.getByKey('profile.choosePhoto').click();
    await native.getByText('照片图库', { scope: 'system' }).click();
  });

  // 该测试专用图片由命名场景导入，并在目标系统上具有已验证的标签。
  await native.getByText('fliwright-avatar', { scope: 'system' }).click();
  await expect(page.getByKey('profile.photoPreview'), '头像预览出现').toBeVisible();
});

test.scenario('biometric.enrolled')('生物识别匹配后进入详情', async ({ page, device, biometricTest }) => {
  await page.getByKey('security.verify').click();
  // security-details 是 app 本地观察器为这次真实认证请求报告的 challenge ID。
  await biometricTest.exerciseChallenge(
    'security-details',
    options => device.biometrics.match(options),
    'match',
  );
  await expect(page.getByKey('security.details'), '识别后的业务结果').toBeVisible();
});
```

`native` 最小 Interface：

- `getById(id, { scope? })`、`getByText(text, { scope?, exact? })`、`getByLabel(label, { scope?, exact? })` 返回惰性 NativeLocator。
- `scope` 默认目标 app，`system` 仅涵盖当前平台已声明的系统 UI/选择器进程。第三方 SDK 自有 app/外部应用需要显式 app-id allowlist；不做全设备任意首个节点点击。
- NativeLocator：`click()`、`fill(text)`、`waitFor({ state, timeout? })`、`count()`、`isVisible()`；范围为首批支持的方法。`waitFor` 的 state 为 attached / detached / visible / hidden。
- `native.swipe({ from, to, durationMs? })`、`native.back()`、`native.screenshot()`、`native.snapshot()`；iOS 不提供 Android Back 语义，`back()` 在 iOS 明确 unsupported，由用例点击真实返回控件。
- `expect(nativeLocator).toBeVisible()`、`toBeEnabled()`、`toHaveText()` 及 `.not` 进入相同 timeline；不支持的 matcher 明确报错。

定位语义：Android ID 是完整 resource-id，iOS ID 是 accessibilityIdentifier；跨平台相同接口不保证 ID 字符串相同。Android text 对应节点 text，label 对应 content-description；iOS text 对应可见 label，label 对应 accessibility label；输入值由独立 value 字段承载，不偷偷加入 label 匹配。exact 默认 true。优先稳定 ID，其次 label，最后可见文字；项目支持模块负责各平台 ID/文字映射。

每次操作重新查询；零匹配可在总 deadline 内轮询，多匹配立即 strict-mode 错误，不能默认选第一个。原生树中保留 package/app/window 标识；返回的临时节点 ID 不可跨快照缓存。先验证唯一、enabled 和可交互区域；无法确定被遮挡时保留 unknown，不把几何可见等同于 hittable。Android ADB 点击使用 bounds 与最新屏幕状态，存在快照到点击的竞态，需要在报告中记录。

`fill` 语义为替换并读回验证。ADB 起步版只声明经验证的字符集和可替换控件；不支持可靠清空、密码读回或 Unicode 的组合应报 unsupported，不使用剪贴板/自定义 IME 的隐式降级。中文输入在 Android Runner/测试输入通道通过验证后单独开放。敏感输入禁用值日志，不保存用于读回校验的明文。

## 5. 设备 Interface 与能力协商

```ts
interface DeviceCapability {
  support: 'supported' | 'unsupported' | 'unverified';
  ready: boolean;
  reason?: string;
  backend: string;
}

// 拟议用法：获取当前设备的能力与就绪状态，不靠平台名猜测。
const capabilities = await device.capabilities();
await device.biometrics.match();
await device.biometrics.reject();
```

能力至少拆为 native.query、native.click、native.fill.basic、native.fill.unicode、native.swipe、native.back、screen.capture、permissions.<service>.<operation>、media.import、biometrics.enrollment、biometrics.match、biometrics.reject、camera.source.image、camera.source.video、camera.virtualScene。支持、生效前置状态、Adapter 版本、OS/工具链版本分别记录。

`supported` 来自已验证的实现和运行时探测；`ready` 不代表业务成功。unsupported / unverified 在操作前失败；正式验收任务缺能力应失败，不自动跳过。支持矩阵探索任务可显式跳过，并保留原因。权限未开启、Runner 未启动和用户尚未录入属于可诊断的前置条件，不能笼统记录成 selector timeout。

### 生物识别

- `match()` / `reject()` 表示发送一次平台模拟事件，不设置应用认证状态。返回包含事件 ID、平台确认状态；最终成功/失败由 app UI 或 app-owned 状态断言证明。
- 识别挑战由受测应用先触发。若平台不能查询挑战状态，测试使用 app-owned 测试观察能力确认 pending；否则报告确认能力有限，不把注入命令返回当成“挑战已消费”。
- Android Emulator 使用 `adb -s <id> emu finger touch <fingerId>`；match 使用专用 AVD 已录入的测试 ID，reject 使用确认未录入的 ID。不假定任意 ID 都能成功；不匹配、取消和系统锁定是不同结果。
- enrollment 不列为 ADB 首批通用能力。专用 AVD 由可重复准备配方完成录入，doctor 校验后才 ready。锁定测试使用独立设备基线，恢复需验证；每个普通测试不重新录入。
- iOS Simulator 自动注入先做技术验证：明确设备选择、录入状态、成功/失败、无界面 CI、多个模拟器隔离、Xcode 版本。只有 Simulator 菜单可用时，可提供显式桌面交互模式，标记需宿主机 UI 独占及辅助功能权限；不能宣传为 headless CI 支持。首版不依赖未公开 CoreSimulator 通知。
- iOS / Android 真机 `match/reject` 均 unsupported；真人通过 `flow.manual` 完成，resumeWhen 检查真实业务结果。Android 人脸识别不从指纹能力推断支持。
- 普通已登录业务场景继续使用 `auth.seedLoggedIn`；仅生物识别专项用例触发真实挑战，不把所有业务测试改成真实登录。

### 权限

提供拟议 `device.permissions.set({ permission, state })`，state 为 granted / denied / prompt；每种平台、权限、状态组合分别协商能力。首次弹窗测试必须使用 prompt 基线，不能先 grant 再声称验证了权限 UI。

Android 使用受支持的 pm/appops 等命令和权限标志处理，每项独立验证；iOS Simulator 仅使用该 Xcode 实际支持的 privacy 服务，其余由真实弹窗或干净的专用设备基线准备。真机不承诺任意权限重置。修改可能终止 app 时只能在 managed-start 启动前执行；attach 模式拒绝需要重启/清数据的准备。

当前 Android 底层 `NativeDeviceSession.preparePermissions` 只接受专用 Emulator、主用户 0、targetSdk ≥ 23、无共享 UID 的 camera/microphone。先确认 force-stopped 且整个 UID 无进程，校验整批 grants/flags 和默认 package app-op，再执行 pm 并读回。`prompt` 为 revoked 且清除 USER_SET/USER_FIXED；`denied` 为 revoked、设置 USER_SET、清除 USER_FIXED，表示曾拒绝，不能称为永久拒绝。仅保留已识别的 user-sensitive flags；固定/策略/一次性/未知 flags、自定义和 UID app-op 一律提前拒绝，不自动修改 app-op。

owner 同时提供底层 `stopApp({ mode: 'managed-start' })` 和 `inspectPermissions(names)`。前者在派发 force-stop 前校验 package/User 0/隔离 UID，返回前确认 stopped 标志与整个 UID 无进程；成功的命令回复不能代替退出证明。后者允许 app/Adapter 运行时独立读取 grants/flags 与默认 app-op，仅观察、不写入、不捕获恢复基线。停止、准备、观察和 Adapter 请求使用同一跨进程互斥，等待时间计入总预算；已派发停止的取消/未知结果隔离设备，未结束工具工作继续被跟踪。

这些接口供 retained owner 下的准备使用，尚未接到 `device.permissions.set` 或场景权限执行器，不能据此声明权限能力 supported。后续必须在已确认 stop 与 launch 之间执行；每次 attempt 以完整声明替换前次声明，无权限声明时恢复原始状态，最终归还设备前再确认 stop、恢复/readback。拥有安装的 owner quiesce/dispose 先核验原 APK/UID，再停止 App、确认全部 UID 进程退出、恢复权限并仅删除本次新安装；只使用权限 primitive 的调用方仍须提供最终停止前置条件。quiesce 保留租约供 Worker reset，dispose 最后释放。child 在新 endpoint、VM PID 与 Adapter generation 下独立观察并复查，观察值需校验声明后才能进入单次 live receipt，不能直接信任 supervisor 的成功回复。写结果未知不重发、不盲目恢复，直接隔离设备。恢复用独立预算；单测与命令语法检查不能替代实际弹窗和业务结果验收。

已实现的 `inspectAppState(names)` 在同一设备操作锁内独立读取单 base APK 摘要、User 0 隔离 UID、当前主进程 PID、指定权限 grants/flags 与默认 package app-op。权限读取前后重新读取安装与进程身份，变化即失败；返回前复核 owner fence。它支持运行中的 Adapter，不安装、不启动、不停止，也不捕获恢复基线。读取属于有限时间内的重复观察，不构成系统状态的原子快照。

installed managed control 返回的 `nativeApp` 是 supervisor 预期而不是凭据。两端严格校验字段及 attempt/scenario 绑定；拒绝路径、readiness boolean、非法 flags 和重复权限。child 读取当前 VM PID 并执行独立平台观察后，才消费绑定 attempt key/ID、scenario fingerprint、managed generation、launch generation、Adapter generation 和设备身份的单次 live handle。异步读取后再次检查身份和取消。失败阻止包括未请求 driver fixture 的普通测试正文；重试重新准备和核验。timeline 只记录摘要、状态与 generation，不含 serial、APK 路径或认证 URL。现有高层 permissions/baseline/biometricBaseline/media/cameraSource 声明仍拒绝执行；此空声明接线不能替代非空权限场景或移动端验收。

### 相机与媒体

| 测试层次 | 实现 | 验证内容 |
| --- | --- | --- |
| 权限/拍摄 UI | NativeLocator 操作系统或 SDK UI | 弹窗、拒绝、取消、快门、确认、返回 Flutter |
| 固定结果 | app-owned `cameraTest` capability，在相机调用的应用接缝返回夹具 | 上传、裁剪、预览、重拍、错误、取消；不计为真实硬件覆盖 |
| Android 虚拟相机 | 固定 AVD + imagefile/videofile 等已验证 camera backend | 通过相机管线读取指定图片/视频，不先承诺运行中通用 setImage |
| iOS Simulator | 以真实运行时能力为准 | 不承诺任意镜头帧注入；图库导入单独记为 media.import |
| 真机 | 实际镜头和固定外部场景 | 光学拍摄链路；需要环境控制或人工配合 |

固定结果已实现为 bridge 的 `FliwrightCameraTestCapability`、core 的 `CameraTestController` 和 Vitest 惰性 `cameraTest` fixture。推荐调用 `cameraTest.enqueueResult({ kind: 'image', fixtureId: 'avatar' })`；控制器通过现有 app capability 通道携带当前 generation，不直接发送无代次的 enqueue。取消/错误使用显式 kind；队列按 attempt 清空，每次消费一项，空队列失败，结束时未消费结果使 attempt 失败。app 测试适配器调用 `capture(generation: camera.generation)`；旧请求和旧 teardown 不得影响新代次。只在测试入口注册，release 模式拒绝启用，不自动替换生产相机插件。

夹具通过受控 fixtureId 映射到 app 可读 PNG/JPEG 资源，不假设主机文件路径可被手机读取。每代最多 32 项，loader 预算 5 秒、图片最多 10 MB、解码后最多 16 MP；状态报告不包含图片字节。请求超时后不重发写操作，清理受 attempt finalization 预算约束。timeline 使用 `surface: flutter` 与 `coverage: app-test-seam` 标识。具体注册和图片分发属于目标项目；仓库 form_demo 已提供独立入口，真实 CLI 验证覆盖预览、取消、错误、重拍和本地上传接收器，不代表移动端或网络上传验收。

`device.camera.setImage()` 不作为首版公共契约。图库夹具通过拟议 `device.media.importImage()` 导入，产生可追踪 ID，清理仅处理本次拥有的资源；无法定向删除的平台使用专用模拟器恢复配方，不清空用户相册。

Android 固定相机来源优先验证官方 `-camera-back` / `-camera-front` 的 imagefile 和 videofile 模式。它们是模拟器启动配置，应由 device scenario 的 cameraSource 准备项引用主机已分发的夹具，managed 环境负责在 boot 前应用。已有模拟器采用不同来源时报告需重启，不把启动参数伪装成运行时帧注入；attach 模式拒绝不相符的来源。镜头实际读到指定夹具、方向/分辨率、前后摄像头及 headless 环境均须验证；通过后可作为 P4 的独立交付，不必等待更复杂的虚拟场景。

## 6. Android Adapter

起步实现为 ADB + `uiautomator dump`：每次请求使用明确 serial、唯一设备临时路径、超时与取消；导出 XML、拉取/读取、解析、清理。截图使用 screencap；输入和手势使用 input。不得依赖固定全局 dump 文件或 adb 默认设备。

XML 解析禁用外部实体，限制字节数/节点数；禁止 regex 代替完整 XML 解析。选择已批准解析器；确需新依赖时先登记框架契约。空节点树、dump 失败、未暴露无障碍节点和零匹配分别报告。动态页面导致空闲等待失败时保留原错，不能当成不存在。

ADB shell 的远端参数仍需专门编码；即使主机使用 execFile(argv)，也不能把任意文本直接拼入 shell。验证空格、引号、换行、Unicode、shell 元字符和 NUL。命令执行绑定单一设备会话队列；取消应终止已拥有子进程并清理临时文件。

UIAutomator Runner 为后续 Adapter，解决查询延迟、稳定输入和更可靠的可交互性检查；只有测得 ADB 方案的局限阻碍目标用例才引入。不会保留“新驱动失败就静默换 ADB”的行为；会话明确选择一个 backend 并报告。

## 7. iOS Adapter 与自研 Runner

创建独立 XCTest UI Test Runner，通过 XCUIApplication / XCUIElement 查询和操作目标 app 及验证过的系统 UI。Runner 仅接受有限命令白名单；不实现 WebDriver、不嵌入 WDA、不暴露任意 Swift 或 shell 执行。

Simulator 首选通信：Node 主机启动 loopback HTTP broker，Runner 通过 URLSession 主动获取命令并回传结果。测试进程启动参数传递 session/generation 和临时凭据；token 不写进日志。Simulator 到主机 loopback 的实际可达性、ATS 测试工程配置、XCTest 执行上下文必须在 P0 证明；若不成立，先修订明确的传输设计，不虚构已连通。

UI 操作调度到 XCTest 支持的执行上下文，网络等待不阻塞它的事件循环。每设备同时只有一条操作；定义 Runner 初始化、ready 握手、heartbeat、最长会话、shutdown 和崩溃退出。Runner 启动/attach 不得调用目标 app 的 launch() 隐式重置已经运行的 Flutter 应用。

协议字段至少包括 protocolVersion、sessionId、generation、requestId、operation、deadline/剩余预算、payload；响应为结果或结构化错误。目标 app 和设备身份由主机独立校验。不要直接比较不同时钟域的绝对时间；传递预算并扣除排队耗时。断线后读操作可在总预算内重新查询；点击/输入/生物识别等结果未知的写操作不自动重发。

Runner 构建缓存 key 包含源码、协议、Xcode/SDK、架构和签名输入摘要；缓存只复用产物，每次会话重新握手。真机签名、Developer Mode、USB 隧道/转发和端口所有权单独验证，P0 未通过前不列入支持列表；不用已启动 Simulator 的网络拓扑推断真机可用。

## 8. 生命周期、隔离和取消

会话顺序：resolve device → acquire device lease → probe → 准备设备基线 → managed launch/验证 attach → 准备 Runner（必要时提前）→ 校验目标 app/Bridge 与设备绑定 → 应用 app scenario → 执行 → 采集证据 → 清理 → 确认进程停止 → release。

- 使用 host + platform + 稳定 device identity 作为设备租约 key。VM endpoint 租约不能阻止两个 Flutter 进程或测试修改同一系统弹窗；设备独占是新增约束。
- 跨进程本地 CLI 和 Worker 共用本机设备租约机制。固定获取顺序：设备 → app endpoint；已有 Worker slot owner 通过显式 owner 委托传入，不能二次抢同一租约造成死锁。
- retained parent 与 delegated child 在设备锁内共用 operation mutex，整批权限准备/恢复和 Adapter 请求、VM PID 绑定读取互斥；等待计入调用总预算。父 owner 不重新取得 child claim。取消后旧平台工作尚未结束时保留互斥，释放遇到活跃操作则保留锁并 quarantine；操作、清理、隔离及释放的多重错误分别保留。
- Flutter 和 native 的动作在同一个 attempt 操作队列中串行；切换不需手工 context 命令。查询结果携带 surface，不混用 Flutter ref 与原生节点。
- VM 断开不代表 native 会话断开；可以继续原生诊断，但不能伪造后续 Flutter 成功。应用被权限修改终止时交由 managed 生命周期处理，不能偷偷重启掩盖失败。
- 默认查询/断言总预算 5 秒、单次动作 10 秒、Runner 冷启动 120 秒、清理 15 秒，均受剩余 attempt 预算约束；这些是初始可配置预算，P0 测量后再校准，不是性能保证。
- 取消、超时或 lease lost 停止排队和新动作，终止本次拥有的子进程。确认 Runner / 转发停止后释放；清理无法确认时标记 dirty/quarantine，阻止后续直接复用。
- 重试前重新准备声明的基线。无法恢复权限、指纹锁定、图库或 Runner 状态时 fail setup，不能让后续 case 继承污染。

已实现的 managed app 子阶段使用独立的认证 loopback 控制通道。启用 native 的 managed run 在每个 attempt（包括 retry、无场景和仅 app 场景）开始时，先收尾旧连接/Adapter，保留设备所有权并释放旧 endpoint，再请求 supervisor 确认旧 Flutter 进程退出、重新启动并验证新 endpoint。随后创建当前 attempt 的 driver/Adapter，重新校验 VM PID。不能只给有 device layer 的用例重启，否则随后的普通用例会拿到最初已失效的 URL。

控制凭据只通过私有环境变量传递，不进入共享项目配置或报告。请求绑定单次 attempt key；有场景时 name/fingerprint 必须成对且与 supervisor 的配置一致。并发、重复请求和结果未知后的重发均拒绝。取消会传播到启动器；控制通道关闭仍有未完成准备时，不能报告清理成功。driver 清理在被动诊断后执行，失败或超时使当前 attempt 失败、隔离设备并阻止后续复用。

stop 与 launch 之间已接入 retained owner 的 `prepareAttempt`：CLI 直接调用，Worker executor 通过 supervisor IPC 只传 project 与 attempt/scenario identity，不能传平台命令或权限状态。owner 使用获取所有权时的场景配置再次校验 fingerprint，并为每个 device scenario 新建、检查和关闭准备 Adapter；child 启动后仍独立复核，supervisor 结果不作为 live receipt。无场景的 attempt 同样经过通道，但不创建准备 Adapter。IPC 的预算、取消、断开、并发和重放围栏与 owner 一起保留未结束工作；最终 reset 先取消并等待准备，未确认停止则不执行 reset、不复用 owner，并保留 reset/释放的全部错误。Adapter/Runner 初始化也进入跨进程 operation mutex，不能在首次请求之前越过准备。此阶段只执行已开放的只读准备；权限/媒体/生物识别基线 mutation 尚未开放，平台完整链路仍需设备验收。详见实施计划第 19 节。

Worker owner 的 build/install/每 attempt launch 与最终 cleanup 阶段由 supervisor 写入同一份 Worker timeline。事件 v2 通过 run-local ordinal 父 span 归组 attempt；owner 内存中的 attempt-key hash 仅用于关联，不进入事件，旧 v1 timeline 仍可读。Cloud 投影/UI 显示 attempt 和子阶段，CLI 与 supervisor helper 已有相关聚焦回归。真实 Worker 的取消、进程异常、reset/release 与遥测故障矩阵仍待完成；遥测失败不得中断设备清理。详细契约与剩余验收见[实施计划第 31 节](../plans/2026-11-03-native-device-automation.md#31-worker-retained-owner-阶段时间轴遥测)。

坐标统一为当前屏幕方向下的逻辑坐标，快照记录像素尺寸、scale、方向、可用显示区域与窗口 frame；Android 物理 bounds 转换由 Adapter 完成，iOS 使用 XCTest points。旋转、状态栏、刘海、键盘和多窗口均要验证。坐标是单次快照证据，不能作为跨设备持久选择器。

## 9. 场景与运行配置

TestScenario 已增加 `kind: 'device'` layer 的模型和严格 schema，字段为 requiredCapabilities、permissions、media、cameraSource、baseline 和 biometricBaseline；每个 resolved scenario 只有一个 device layer，继承时沿用现有单例重复检查。设备基线引用是项目可移植名称，不能包含真实 serial 或主机秘密。cameraSource 需要模拟器启动配置时，准备阶段进一步先于 emulator boot；设备发现允许选择停机的专用 AVD，不能等 app launch 后再改镜头来源。

当前只开放 requiredCapabilities 的只读准备。managed CLI/Worker 在 launch 前检查，Vitest 在连接 Bridge 前检查，每次 retry 重新读取。应用阶段消费绑定完整场景 fingerprint、attempt、mode 和 Adapter identity/generation 的一次性内存凭据，并再次核验 readiness；JSON 报告不能当凭据复用。报告保存设备摘要、检查代次与 managed app 代次。每 attempt 重启通道和 Android 权限底层原语已实现，设备 mutation 的场景接线、独立复核及平台验收仍待完成；其余设备字段在任何平台工作之前明确失败，不会忽略或偷偷重置。`scenario.apply/reset` 的 app-only 入口提前拒绝 device layer，提示使用 `run --scenario`。

拆分场景执行为设备准备与应用准备两个阶段。device layer 在应用启动及任何 Bridge 依赖前执行，之后保留 mocks → storage → auth → state → app → navigation 顺序。现有无 device layer 的场景执行语义不变；不可在已有 ScenarioCoordinator 连接 Bridge 后才执行需要重启的设备准备。

例如 `photo.system-picker` 组合 base/auth 场景及图库夹具；`biometric.enrolled` 组合 app 登录基线与已录入专用模拟器基线。测试内只执行用户动作及业务断言，不散落 reset、录入和权限准备。

配置新增可选 native 段，包含 enabled、backend、targetAppId、显式系统/外部 app 范围和超时；默认关闭，普通 Flutter 测试不启动原生工具。managed 模式复用已选择设备；attach 模式必须提供可验证的设备绑定，多设备或未知映射时报错。不会仅凭一个 VM URL 猜出设备。

CLI 首批拟议命令为 `native doctor --json`、`native snapshot --json`，并将 native 配置接入现有 run / script；帮助、schema、命令目录和生成 skill reference 一起更新。doctor 默认只读；安装/构建 Runner 是显式 prepare 工作流。完整操作命令在核心用例稳定后添加，不另造第二套能力。

## 10. 断言、错误与证据

当前 Assertion 和 Vitest expect 依赖 Flutter Locator。实现时抽出供两种 Locator 实现的最小可断言观察 Interface，并让 native matcher 使用原生观察与证据来源；不把 NativeLocator 强制转换成 Flutter Locator，不把 Flutter selector/healing 逻辑套在系统按钮上。

错误至少区分 unsupported_capability、precondition_failed、device_mismatch、device_busy、runner_unavailable、protocol_mismatch、target_not_found、strict_mode_violation、not_interactable、timeout、cancelled、transport_lost、action_outcome_unknown、cleanup_failed。保留 platform/backend/raw cause，面向用户提供可执行修复建议。等待 hidden/detached 时连接错误不能被当作元素消失；否定断言也必须有有效快照。

每个动作/断言进入已有 RunSession 和 timeline 节点，metadata 记录 surface、backend、device identity 摘要、scope、selector、requestId、实际预算及耗时。写操作结果未知以失败保留，不自动重复。

失败证据优先从对应 surface 获取：原生整屏截图、原生树、前台 app/window、最近协议错误；可另外附 Flutter 快照，二者独立标记。原生树使用独立 artifact 类型/metadata，不覆盖既有 Flutter snapshot schema。EvidenceCapture 的三通道可作为调度入口，必须同步更新 provider、manifest、export、CLI/Cloud/VS Code viewer 的识别，不能只写新文件没人读取。

保留原始业务错误，截图失败仅使 evidence partial。每通道有预算和取消；ADB dump 可能超过现有默认 1 秒，按 provider 使用明确预算，总采集不超 attempt finalization 预算。图像与树标记采集时间和 generation，不声称两个非原子采样完全同一帧。

密码与敏感输入不进入文本日志；节点树默认掩码密码值。整屏截图可能包含 SDK 或系统内容，沿用项目证据策略并提供禁用/遮罩能力；未经遮罩的图像不得被标为“已脱敏”。

## 11. 支持矩阵与验收

以下矩阵是目标范围；已验证范围以本节的实际证据为准。iOS 26.5 / Xcode 26.6 / Flutter 3.47.8、专用英文 Simulator 上，自研 XCTest Runner 已由真实 managed CLI 跑通四个用例：Flutter 打开 UIKit 确认框并确认/取消，以及 Flutter 请求麦克风、native 在 SpringBoard 系统作用域点击 Allow/Don’t Allow、Flutter 断言 granted/denied。确认/取消同次运行使用不同 managed app 和 Adapter generation；每次均重新绑定当前 VM PID。

维护的源码与复现方式见 [form_demo](../../../examples/form_demo/README.md#mixed-flutter-and-native-ios-fixture)；生成的 Flutter/Xcode 宿主仅放临时目录。宿主显式给 Debug 配置增加 `FLIWRIGHT_NATIVE_FIXTURE`，Swift 通道同时要求 Simulator；不假设 Flutter Runner 自动定义 Swift `DEBUG`。iOS 26 实际 `UIKitApplication:<bundle>[hex][rb-legacy]` 标签按完整格式与精确 bundle/PID 核验，不使用 bundle 前缀匹配。

两个麦克风用例分别由外部 `simctl privacy reset microphone <app>` 准备，仅证明真实系统 UI 与业务回传，不证明高层权限场景、权限自动恢复或音频采集。原始失败记录保留；四个通过用例不构成每平台 20 次无重试验收。Android、Face ID/指纹、相机画面、物理硬件和其余故障矩阵继续独立验收，不据此提升支持状态。 Android 维护宿主现可通过 staging 脚本生成，并已完成 Debug APK 构建及 manifest 核验；六个业务用例仍待可运行专用设备验收。app-owned readPermissions 只观察 granted/rationale，不提供权限 mutation 或恢复凭据；细节见实施计划第 22 节。

| 能力 | Android Emulator | Android 真机 | iOS Simulator | iOS 真机 |
| --- | --- | --- | --- | --- |
| 原生树/点击/滑动 | 首期，需无障碍节点 | 首期，需授权 ADB | 首期，经 XCTest 验证 | 后续，签名/通信验证 |
| 基础输入 | 首期，字符集受限 | 同左 | 首期，XCTest 验证 | 后续 |
| 中文输入 | 后续 Runner | 后续 Runner | 经 XCTest 验证后声明 | 后续 |
| 权限 UI | 按 OS/权限验证 | 按 OS/权限验证 | 按 OS/权限验证 | 后续 |
| 指纹结果注入 | 首期，已录入基线 | 不支持，真人 | iOS 生物识别技术验证 | 不支持，真人 |
| Face ID 结果注入 | 不由指纹推断 | 不支持，真人 | 技术验证后开放 | 不支持，真人 |
| 固定图片业务结果 | app 测试能力 | app 测试能力 | app 测试能力 | app 测试能力 |
| 真实镜头/虚拟镜头 | 虚拟镜头另验 | 实际镜头 | 不承诺镜头输入 | 实际镜头 |

发布门槛：

1. Android 与 iOS Simulator 各完成 Flutter → 系统 UI → Flutter 的测试，包含允许/拒绝/取消，业务结果有断言；无 Appium/WDA 进程或依赖。
2. 每个平台单独验证重复文字、节点不存在、节点不暴露、旋转、键盘、后台覆盖；错误能区分查找失败与驱动故障。
3. 同设备两个本地进程不能同时操作；两设备可独立操作；取消、Runner 崩溃、工具缺失、断线未知结果均不误报成功或重复点击。
4. Android 指纹 match/reject 各验证实际业务结果；未录入、锁定、真机误用明确失败。iOS 未通过技术验证不能发布 supported。
5. 固定相机图片、取消、错误分别完成 app 业务验证；拍摄 UI 和硬件验证单独列出，不合并覆盖率。
6. 同一专用设备连续 20 次混合流程，无状态串扰、未归属的常驻 Runner/转发或未清理临时文件；报告成功率、p50/p95 查询及动作耗时，不以重试掩盖失败。
7. 非原生 Flutter suite 不启动原生工具，原有 CLI/场景/录制/断言回归通过；artifact 导出后可离线辨别 Flutter 与 native 证据。

## 12. 决策和待验证项

已确定：不接 Appium/WDA；保留 native/device 语法；平台实现使用 Android 系统工具和 XCTest；设备独占、命名场景、结构化失败和证据是首期必要部分。

实施前技术验证：iOS Runner 执行与通信；受保护系统 UI 可操作范围；iOS 生物识别注入；Android dump/输入局限；权限重置行为；当前工具链下的相机来源。每项交付复现脚本、实际版本、结果与限制，未通过则对应能力保持 unverified，不阻止其他已通过能力交付。

后续：Android Runner、真机 iOS、虚拟相机、原生动作录制/代码生成与系统 UI 的完整语义封装。首版不把 Flutter 录制器捕捉不到的原生动作生成成已验证脚本；混合录制需显式显示缺口或人工步骤。

## 13. 补充契约：安装、启动与专项验收

本节定义设计补充，不提升平台能力状态。Android owner 安装/无重装启动已接入 CLI/Worker retained owner，并有独立主机构建、确定性及真实 child 回归；普通 attempt 的独立 readback 与 durable permission baseline 见实施计划第 27—30 节。尚未通过 Android 设备业务验收，也未开放非空高层权限场景。可执行工作拆分、源码依据和验收顺序见[第 23 节](../plans/2026-11-03-native-device-automation.md#23-补充方案首次安装无重装启动及剩余专项)。

### 安装与启动必须分开

Android 权限场景必须采用 build → 获得设备所有权 → install/核验既有安装 → stop/确认 UID 退出 → 捕获权限基线 → prepare → launch installed app → 验证 VM/Bridge/PID → child 独立复核的顺序。构建可以在设备租约之前执行，但探测后的一切设备操作均持有租约。仅准备镜头来源的场景还要把设备所有权和 cameraSource 配置提前到 Emulator boot 之前。

当前 Flutter 3.47.8 的 Android `startApp` 在 prebuilt 分支后仍调用 install；install 失败还可能卸载重试，`flutter install` 的默认工作流也可能先卸载。故 `--use-application-binary` 不能作为“准备后绝不安装”的保证。权限准备完成之后，首次运行、retry 和普通 peer 都不得再次经过该安装路径；也不得为取得初始 VM URL 先启动一次 app。该限制覆盖 CLI 和 Worker。

首个实现仅接纳两种安装状态：本次在专用设备上拥有的新安装，或经完整产物摘要验证的同一既有安装。不同版本、未知签名、split APK 未支持、无法验证的安装均在修改前失败，不能自动卸载或覆盖。权限恢复基线是该已核验安装的原始权限状态；不承诺回滚应用升级或任意用户数据。只有本次新安装且身份仍匹配时才能在最终清理中卸载，既有安装保留。

运行已安装的 Debug app 后，原生平台实现发现当前进程的 VM service，拥有并追踪必要的转发；core 负责验证 VM/Bridge，现有 PID 绑定再独立核验设备和目标 app。发现过程按设备、启动代次和当前 PID 过滤，不读取旧缓存 URL，不清空全设备 logcat，不关闭 service auth。完整 URI、认证路径和转发凭据不进入公开 artifacts。有限 run/script 无需为此强制增加 `flutter attach` 常驻进程；热重载所需的 attach 另行验证，不能静默退回 flutter run。

启动与 endpoint 发现属于同一次有界操作。launch、install 等写结果未知时不自动重发；底层进程/工具停止未确认则 quarantine。运行中失去应用或安装身份时不盲目恢复；权限恢复仍必须满足已停止、相同包/UID/安装身份及原始状态可解释的条件。

### 场景、恢复与可观察状态

首次 selected attempt 和之后每个 attempt 走同一准备管线。无场景、app-only 和空权限声明都表示替换为本次完整声明；不能因没有 device layer 而遗留前次权限状态。child 的只读观察在允许用户动作前校验预期 grants/flags，并绑定 scenario fingerprint、attempt、安装身份、managed generation、VM PID 和 Adapter generation；应用启动阶段已改变权限时明确 setup failure，不悄悄重新准备。

存在权限 mutation 或设备基线恢复的 run 与 `keepAppAlive` 冲突：在任何设备写操作前拒绝该组合。恢复会终止或要求停止 app，不能同时承诺保活。此判断来自 supervisor 的冻结声明，不能由 child 临时关闭恢复。普通只读 native run 的保活行为不受此条扩大限制。

owner 的恢复记录存放本机受控 runtime，保存安装归属、权限原始值、写操作状态和拥有的资源；不包含输入明文或认证 URL，不写入仓库。写前记录进行中状态，确认 readback 后记录完成。权限记录只有 retained parent 可拥有；child 只能独立读取当前事实。每次首次出现的权限捕获原始 grants/flags 与隔离 UID，完整声明替换不能覆盖旧原始值。每个 force-stop/grant/revoke/flag 操作派发前先完成私有文件及目录同步；已有记录不能覆盖或接管。读取成功后也必须提交 verified checkpoint，写盘失败不能宣称准备/恢复成功。最终停止与恢复验证、owned app 清理完成后才删除本会话自己的已恢复记录，再释放设备；即使缺失 dirty marker，残留记录也阻止 release。宿主崩溃后残留的未确认记录阻止下一次自动复用；不依靠进程退出或租约超时推断恢复成功，不自动重放未知写。当前未实现自动恢复命令；人工恢复仍需独立核对设备、安装身份与实际状态，不能把删除 lock/记录当作恢复成功。

### 生物识别挑战

`baselineVerified: true` 这样的调用方布尔值不足以证明当前设备已录入。该配置已移除，传入 true 或 false 均拒绝；候选 enrolled/unenrolled IDs 不授予能力，Android 模拟器指纹注入当前仍是 unverified/not ready。专项准备须产生活的、绑定专用设备/boot/OS/基线版本的观察凭据，并在使用前复查；这部分设备证据尚未交付，不能用另一个配置布尔值替代。

app-owned 生物识别观察不设置认证成功。当前 bridge 只远程提供 reset/getStatus；beginChallenge/recordRejection/completeChallenge 由 app 本地在真实平台调用/回调处报告。core/Vitest 的 biometricTest 已实现 challenge identity、generation、pending、非终态失败序号、终态及单次事件验证；平台错误详情和受保护业务示例仍需补齐。match 注入后断言业务成功；reject 先断言对应挑战收到失败事件，若平台仍保持 pending，再由真实取消控件结束并断言取消。一次不匹配不必使 authenticate 返回终态。旧挑战、挑战超时、取消后事件和锁定后的事件均不得被后一个挑战认领。观察器 reset 不代表 OS prompt 已关闭，也不代表设备已恢复。

锁定、无录入和设备凭据 fallback 分别验收；不从一次 reject 推断锁定，不用固定 sleep 证明恢复。Face ID、Touch ID、Android 指纹按独立能力探测和发布；Android 人脸不由指纹推导。iOS 自动注入仍须公开可定向接口、headless 和多设备验证，物理传感器自动注入保持 unsupported。

### 相机与媒体资源归属

媒体夹具清单使用可移植 fixture ID、内容摘要、格式/大小与预期可见标识；设备准备负责实际分发和记录拥有的资产。若平台只提供导入而无可验证的资产 ID/定向删除，则仅在本次拥有的可恢复专用模拟器上开放，恢复须确认不会删除他人资源；不能凭相同文件名删除图库图片。

虚拟镜头必须证明指定夹具经相机管线返回；仅配置启动参数、看到预览控件或从图库选到同名图片均不够。图片方向、前后镜头镜像、视频时间进展和 headless 各有断言。第三方人脸活体或拍照 SDK 对真实镜头的要求另验；app-test-seam、模拟镜头、系统 UI 和物理镜头分别记录覆盖层次。

## 14. 补充契约：失败诊断与显式设备恢复

### 启动失败必须可定位

managed preparation 的公开错误必须指出最后进入的固定阶段：preparation、validate-scenario、build-app、install-app、stop-app、prepare-device、launch-app 或 verify-endpoint。阶段是受校验的枚举，不接受工具错误文本、路径或 URL。deadline 到期时即使底层工作尚未返回，也记录其当时阶段；结果未知的语义和后续 attempt 围栏保持不变。阶段名称只帮助定位，不证明操作是否已执行。

原始异常与 cause 只通过 supervisor 的 onError 交给本机受控诊断；不得原样传入 child 错误、公开 artifacts 或 Worker 上报。诊断 callback 自身失败不改变原始失败、取消、清理或隔离语义。CLI 分别标记 daemon 启动/VM endpoint 验证；Android installed 路径分别标记构建、安装、停止、准备、启动和验证。Worker endpoint resolver 内尚未拆开的步骤仍按实际可观察范围报告，不能推断更细阶段已经完成。该诊断契约已实现，验证与限制见实施计划第 33 节。

### 恢复是独立工作流

当前已有公开只读 `inspectDeviceLease` / `native recovery inspect` 和内部 recovery claim，见实施计划第 34 节；Runner-only `restoreIosRunner` / `native recovery restore` 已按实施计划第 47 节公开；Android 和通用 clear 不开放。检查只读取有界本机记录，不改变隔离；claim 仅保留独占恢复资格，不授予恢复成功。完整恢复由 native 包拥有，CLI/Worker 只调用同一实现。不能以新增 `force`、`baselineVerified` 或删除 dirty 文件作为恢复入口。

恢复顺序为 inspect → 独占恢复 claim → 核验旧进程退出与设备/安装身份 → 恢复已知原始状态 → 独立 readback → 持久化恢复成功 → 解除隔离。恢复 claim 与普通 acquisition、delegation 和 operation 共用设备排斥；旧 parent、delegate 或 operation 活跃时拒绝接管。无效记录、身份变化和未知派发不能自动重放，须保留证据并停止恢复。

有 dirty 但无原 lock 的设备仍然需要恢复 claim 及完整核验。PID 不存在不等于 Runner/模拟器内 app 已退出；卸载 app 不等于图库/权限/录入基线已恢复；观察器 reset 不等于认证 prompt 已结束。逐项验证实际受影响资源，不能只核对主机 ps。

首次支持范围限定为可验证的专用设备与本次拥有资源。匹配的既有安装必须保留；替换安装、未知 UID/签名、无法归属的图库资产或录入状态不得写入。若需回到版本化整机基线，必须有该设备归属和该基线可重复恢复的证据。恢复预算独立且有界，中断/回复丢失/恢复写失败继续隔离，不因超时自动清记录。临时新建设备可在确认所有 owned 工作退出后销毁；销毁记录不是其他设备已恢复的证据。

恢复报告包含设备身份摘要、原会话/记录摘要、检查项、已派发步骤、readback 和最终状态；本机恢复凭据/路径不进入公开报告。源错误、恢复错误、清理错误分别保留。发布前必须覆盖真实子进程互斥、parent/delegate/operation 存活、stale/损坏/缺失记录、安装身份变化、失败与中断，并用专用设备验证一次故障 → 隔离 → 恢复 → 新 attempt 的完整流程。

### 正常清理与崩溃恢复的边界

正常 owner 必须完成 active work/Adapter 退出 → 校验安装身份 → 停止并独立确认 UID 下全部进程退出 → 原始权限恢复/readback → owned forward/App 清理 → 权限 journal 完成 → 安装 journal 完成，之后才能释放设备锁。`quiesce` 完成这些工作但保留设备排斥，Worker reset 完成后再 `dispose/release`。匹配的既有 App 保留安装和数据；只有本次安装的 App 可以卸载。

安装 journal 的完成是独立的内部动作，不能通过“文件存在就删除”实现。当前实现使用 app v3 记录，包含随机 journalId、设备摘要、lease key 与 owner generation；首次发布必须排他，后续写入和完成必须核验原始文件身份、内容及目录身份，拒绝 byte-identical replacement、symlink、hardlink 和不规则/超大文件。只有本实例已确认 stopped/removed、无未知结果且权限 journal 已完成后，retained owner 才调用安装 journal 完成；取消、记录变化或写盘未确认不得被报告为清理成功。遗留记录仍由租约层保留和隔离。这是正常生命周期，不授权接管旧 journal。

### 崩溃恢复尚缺的持久化证据

现有 app v3 / permission v2 记录已关联共同 lease key / owner generation；permission journal 记录 managed installation 提供的 APK 摘要与本次安装归属，校验 UID、原始 baseline 的保留和扩展，并拒绝 caller 覆盖绑定字段。后续写入及完成检查文件身份、单 hard link、精确有界字节和目录身份。inspection 额外校验两份记录的身份及声明/desired/readback/restored 语义；缺少安装摘要或配套 app record 时保持隔离并拒绝 claim。旧版 app v2 / permission v1 不能授权恢复。这些本机证据仍不是完整可恢复资源清单。macOS/Linux 设备互斥区内受管 ADB/host 工具现在在启动受控进程组后、实际命令派发前保存 operation token、opaque resource ID、owner PID 与 wrapper/process-group PID；inspect 独立读取 host `ps` inventory，把实际活跃的同组后代暴露为 `hostTool=live`，并把僵尸条目视为已退出。真实 owner SIGKILL 回归已证明 wrapper 消失但后代仍活跃时 recovery claim 拒绝接管；待整组退出可获得 claim，但该 claim 仍不移除 dirty 或原 journal。Windows 保留直接 child executor 和 write-ahead journal；由于尚无受检进程树 readback，遗留工具记录一律 `invalid` 且不能 claim。该证据覆盖设备 operation 内经 `executeTool` 执行的 host commands，不覆盖所有资源；恢复实现仍必须补齐以下关联后才能进行平台写入：

| 证据 | 必须记录和核验的内容 | 缺少时的处理 |
| --- | --- | --- |
| 设备与启动代次 | host/platform、稳定租约 identity、实际 serial/UDID、boot/OS identity；Android AVD name 与 serial 的受检映射 | 不把 configured serial 的另一个 key 当作原 AVD owner；拒绝写入 |
| 安装与权限关联 | app/permission journal 的共同 owner/generation；安装摘要、package/user、隔离 UID、签名/构建身份与原始 baseline 摘要 | permission journal 单独有 UID 不足以向当前安装恢复权限；拒绝写入 |
| owned 主机资源 | 平台工具/Runner/日志观察器的进程与进程组身份、创建/派发/退出 checkpoint；owned port/forward 的实际分配结果 | PID 不存在或 parent 已退出不足以证明后代退出；旧记录不补造 provenance |
| 平台资源 | App/Runner UID/PID、精确 forward mapping、媒体资产 IDs、录入/相机基线及恢复方式 | 不按包名前缀、端口号或相册名称推断归属；无法定向归属则继续隔离 |
| 恢复进度 | 原记录摘要、每个恢复步骤的 pending/observed/verified、独立 readback、durable completion 与归档身份 | 崩溃/回复丢失不自动重放；重新 reconcile 后决定下一步 |

恢复事务不得改写原 journal；恢复进度和 readback 写入本次 claim 拥有的新证据。先保存可验证的完成 checkpoint，再以带身份校验且可续查的归档/退役步骤移出原锁和 quarantine，最后释放 claim。任何中间崩溃仍必须阻止普通 acquire；启动检查需能辨认未完成的归档事务。不能先删 dirty 再写成功，也不能将 callback 返回值作为解除隔离凭据。crashed recovery claim 的接管需要独立协议，当前拒绝自动采用。

Android 首条恢复闭环限定单用户专用 emulator、已验证单 APK、camera/microphone 普通 flags 与 default package app-op；先 reconcile 当前安装/UID/进程/forward，再恢复已捕获原始值并分别读取 grants、flags、app-op 和停止状态。iOS 需要 Runner/目标进程、权限和专用 Simulator 基线各自的证据；历史 dirty-only 设备无法从当前记录重建原始状态，必须保留隔离，不能复用新建设备的验收替代它。

## 15. 当前交付边界与后续方案（2026-11-04）

### 15.1 能力交付必须分别验收

| 用户需求 | 采用的接入方式 | 当前证据 | 仍需交付 |
| --- | --- | --- | --- |
| Flutter 与原生页面混合操作 | `page` + `native`；Android ADB / iOS 自研 XCTest Runner | 定位、动作、fixture 和证据已接入；iOS 专用 Simulator 的确认/取消、麦克风允许/拒绝已跑通 | Android 混合业务验收、输入/遮挡等矩阵、真机范围及稳定性 |
| Face ID / Touch ID | app 先触发真实挑战；Simulator 专项 Adapter 注入结果 | app-owned 挑战观察已有实现；iOS 注入仍 unverified | 定向、录入、match/reject、无头 CI、多 Simulator 的技术验证；逐项通过后开放 |
| Android 指纹 | 专用已录入 AVD；发送匹配/未录入 ID 事件 | 底层事件实现与挑战观察已存在 | 受检基线、真实 app 消费事件和成功/失败/取消/锁定恢复；不能凭调用方 ready 值开放 |
| 相机业务流程 | app-owned `cameraTest` 固定结果 | 固定图片、取消、错误、重拍和上传接缝有真实 CLI 证据 | 目标 app 自己注册接缝和夹具；该覆盖单独标记为 `app-test-seam` |
| 系统相机与图库 | `native` 操作权限、选择器及拍摄控件 | iOS 麦克风系统弹窗证明混合通路；不代表 camera 权限/拍摄已验收 | camera/photos 逐项权限准备、图片资源归属、允许/拒绝/取消与业务断言 |
| 指定镜头画面 | Android 官方 Emulator 启动相机来源；真机用实际镜头 | 尚无真实帧验收 | boot 前配置和夹具分发、app 实际读帧、方向/镜像、headless、清理恢复；iOS 不承诺通用帧注入 |

Android/iOS 真机自动通过生物识别均不开放；真机专项由真人完成并断言业务结果。Face ID、指纹、相机分别交付，不能用一种模拟器的通过结果替代其他平台或真实硬件覆盖。

### 15.2 Android 稳定设备身份：本次实现的范围

managed owner 在 install、stop、权限准备或 launch 前，使用已发现的 `avd:<name>` 租约，定向读取当前 serial、AVD name、boot ID、build fingerprint 与 SDK；复读 boot/AVD/serial，确认捕获过程没有切换设备。父 owner 排他、同步写入 `device-recovery.json`，仅保存摘要及 lease/owner generation，随后每次相关 mutation 派发前、operation 完成后和清理前重新核验。文件、目录、字节或设备身份不符时保留证据并隔离；同一 binding 失败后即使旧值再次出现也不能恢复写入。

该记录为父 owner 私有，不进入 delegated grant；普通未使用 managed 准备的 owner 保持惰性。只有 app/permission 清理已确认且设备复核一致时，才能完成自身记录；任意遗留记录都会阻止正常 lease release。离线 inspection 返回 `deviceRecord` 和固定 `invalid-device-record` / `inconsistent-device-record` issues；可以按稳定 AVD identity 校验 app/permission 中保存的 serial 摘要。它不会为了把 serial 转成 AVD 名称而启动 ADB。

2026-11-04 后续实现已把该 binding 接到普通 Android NativeSession 的操作锁及每条 ADB 命令派发前；managed parent 复用同一 session binding，delegated child 只读 owner journal 并自行复核 AVD/serial/boot/OS，不能捕获、完成或删除父记录。缺少或不一致证据会在 Adapter 操作前失败。正常 direct NativeSession 在 Adapter 确认关闭后完成自己的记录；managed parent 仍在所有 managed 清理成功后完成记录。该接线是主机测试与受控 executor 证据，尚未通过真实 Android reboot/serial reuse 设备验收。Runner 在设备内的进程、forward 实际分配和平台恢复事务也未完成。AVD 名称与 boot/OS 摘要不能证明完整磁盘快照或相机/录入基线，恢复器必须另核验具体资源。

普通物理 Android NativeSession 使用发现到的 serial 作为稳定 lease identity，不查询 `emu avd name`；模拟器继续使用 `avd:<name>`，同时核对 serial 与 AVD 映射。两种路径都捕获并复核 serial、boot ID 和 OS 摘要。该物理设备接线目前只覆盖普通原生 UI 操作，不代表 managed install、权限修改或设备恢复已支持真机；这些路径仍受各自的平台验收门槛约束。

Android managed VM forward 在派发前记录意图，动态端口返回后先读回唯一完整 mapping，再立即持久化 serial、host port 和 device port，之后才完成 app PID 复核并返回 endpoint。`running` 与 `remove-forward` 记录必须含 exact mapping。若派发结果未知，不能通过相似端口扫描推断归属或删除；保留意图和 quarantine，等待具有独立 provenance 的恢复器。当前还没有该恢复器，也没有覆盖 ADB server 响应丢失后的真实设备故障验收。

iOS Simulator Runner 的 authenticated `/ready` 带有 Simulator 内 PID。启动前拒绝已存在的精确 XCTest Runner label；握手后与 `launchctl list` 的唯一 PID 交叉核对，正常关闭前还复核最初的 Simulator boot generation。父 lease 同步保留 `ios-runner-recovery.json`：launch intent 与 `simulatorBootedAt` 先落盘，PID 绑定后 checkpoint；只有 host group 与 Simulator Runner 均确认退出才完成记录。owner crash 后离线 inspection 能识别未解决 Runner 并拒绝普通 recovery claim。在线 `inspectIosRunnerRecovery` / `native recovery verify` 复读 boot generation、完整 launchd inventory 和本机 fingerprint，返回 `runner-absent` / `runner-matches-record` / `runner-mismatch`；它不占有 claim、不终止进程、不解除隔离。同一次 boot 内 PID 仍可能复用，`runner-matches-record` 不能授权恢复终止。只读 verify 本身不授权恢复；后续 Runner-only restorer 已按实施计划第 46/47 节接入认证主动退出、独立 readback 与持久化归档，其他资源恢复仍未完成。

### 15.3 剩余工作依赖与失败出口

实施计划第 39 节是接下来可执行的交付清单：先补全所有执行入口的身份约束及 Runner/forward 归属，再完成 R3/R4 的恢复事务，接着开放经过真实设备验收的权限场景；Android 指纹和 iOS 生物识别、图库和镜头来源分别通过专项门槛。已有 app 固定结果可独立使用。每项需要源码回归、明确工具链版本和平台业务证据；测试尚未执行或依赖模拟平台观察时，保留 unverified。

不引入 Appium/WDA，不新增通用 shell 执行接口。调用方继续只使用 `page` / `native` / `device` 与命名 `TestScenario`；构建、租约、代次、平台命令、恢复记录和取消集中在所属 Module 内。未通过能力在准备阶段失败，写入结果未知时停止后续操作、保留证据，恢复必须独立 readback 后才可归还设备。

## 16. 补充设计：Runner 主动退出与恢复事务

本节是目标契约。认证主动退出及有效 Runner/已退出宿主工具的内部恢复事务已有实现和专用 Simulator 证据，见实施计划第 45—47 节；Runner-only 公开 restore 已接入，其他资源和完整平台矩阵仍待完成。只读检查结果的含义不变。

### 16.1 Module 与调用方 Interface

恢复由 `@fliwright/native` 的恢复 Module 拥有；当前公开 `restoreIosRunner` 和 `native recovery restore` 只接受明确 Simulator UDID、先前 inspection 的 fingerprint、总预算和取消信号，返回资源范围固定为 XCTest Runner 的恢复摘要。该入口不接纳 Android，也不声称恢复权限、app、device 或 media journal。CLI/Worker 不提供任意 PID、bundle、平台命令、原始 journal 或“已确认恢复”布尔值；更广泛的平台 restore 需各自完成事务及验收后再扩展。

Module 内部分为平台状态读取、平台恢复 Adapter 和事务存储三个内部 Seam。平台 Adapter 只产生逐项实际观察与有限恢复动作；事务存储独自决定何时可以归档证据和退役隔离。平台命令成功、Adapter 返回成功或 Runner 的 shutdown ACK 都不能直接删除原锁。

### 16.2 活跃 Runner 的恢复路径

优先验证独立于旧 Node broker 的、经认证的 Runner 控制通道。恢复通过该通道要求对应 generation 的 Runner **主动退出**，避免使用旧 PID 向当前进程发送终止信号。正常关闭也应复用此证明，不能把读到 label/PID 后调用 bundle terminate 的时间窗口视为原子操作。

Simulator Runner 的 loopback listener 使用 Apple Network 承载有限消息、CryptoKit HMAC 认证。两个系统框架及 `RunnerRecoveryControl.swift` 已登记到 stack，控制端与内部 Node 客户端有交叉语言测试。生产 `testServe` 已接入控制端，主协议 v2 ready 绑定端口；journal v2 启动前保存 session/密钥，平台读回和 fresh challenge 后才写 running。正常关闭已改为认证后主动退出，再独立读回，不再按 bundle/PID 终止。真实 Simulator 已验证两次生产会话及实际 owner SIGKILL 后进程退出、原证据不变与 acquire 拒绝；恢复事务与 Runner-only 公共入口后续已实现，见实施计划第 46/47 节。其他平台/版本的反向通道仍需验证，不用私有 API、全进程环境转储或通用命令作为替代。

协议要求：

- 每 generation 生成独立随机恢复密钥。启动意图和密钥须在启动前同步保存在 owner 私有存储；密钥通过受控 Runner 启动环境传递，不能进入普通 inspection、CLI JSON、timeline、构建缓存或公开 artifacts。
- listener 只绑定 loopback，禁止任意操作。先在 authenticated ready 中绑定 endpoint 与 session、generation、设备、boot generation、Runner PID，再 checkpoint；endpoint/端口本身不证明归属。
- 恢复端发出新的随机 challenge。请求与响应分别绑定协议版本、方向、操作、challenge、session、generation、设备、boot generation 和 PID，使用恢复密钥认证；限定消息大小、连接数和总预算。旧响应、跨设备/代次消息、错误密钥和重复命令不能被接受。
- `identify` 只观察；`shutdown` 只允许当前 Runner 停止接受新 UI 命令并结束自身测试，不提供 kill、launch、click 或任意代码执行。收不到 ACK 时结果未知，不盲目重发；后续只能重新读取平台状态。
- owner broker 丢失后，Runner 必须在独立且有界的预算内自行结束。控制通道与 UI 工作的取消必须可收敛；不能因主线程正等待 UI 或旧 broker 而无限阻塞恢复。

launching journal 尚未绑定 endpoint、密钥缺失、协议不匹配或进程无响应时，不尝试凭 PID 终止。允许等待 Runner 自行退出并读取真实 absence；预算耗尽继续隔离。历史记录没有新的认证材料时不能补造证明。新的 journal schema、构建缓存 key、握手版本和严格 decoder 必须同步更新，不增加旧格式恢复的兼容通道。

### 16.3 恢复事务及故障语义

状态顺序为 `inspected → claimed → reconciled → restoring → readback-completed → archiving → retired`。这是内部事务状态，不是当前已有的公开返回类型。每次平台写入前持久化对应 pending step；写入后先独立观察，再记录 verified step。断线或崩溃后以当前平台状态 reconcile，不能仅依据 pending 重发。

claim 必须通过专用恢复资格判断接纳它确实能够处理的 journal，例如有效且错绑检查通过的 `unresolved-ios-runner`；不能简单过滤所有 inspection issues。其他 invalid、未知或非该 restorer 所有的资源继续阻止恢复。原 owner、delegate、operation 与 host tool 任一仍活跃或不可核验时，不派发平台写入。

原 journal 与 dirty 证据保持字节不变。新事务绑定原 fingerprint、claim generation、资源清单和每步读回摘要。平台状态恢复完成后先同步 completion，再逐项身份核验、归档原锁与隔离记录，并记录可续查的归档位置/摘要；恢复 reservation 在最后一步才退役。普通 acquisition 在原锁移走后仍必须因恢复 reservation 而拒绝。任何 fsync/rename/unlink 失败或崩溃都不得暴露可重新 acquire 的中间状态。

crashed recovery claim 的显式接管是同一交付的必要部分：必须核验旧恢复进程和它派发的工具均已退出、事务/归档清单没有替换、原证据仍可追溯，并使并发接管者互斥。当前内部算法使用非空步骤目录的原子发布、不可变 hash chain 和新 owner epoch，已覆盖真实子进程持久化边界的崩溃矩阵；不以“claim 的 PID 不在”直接删除 reservation。旧 generic claim、格式错误或无法确认工具已退出时继续拒绝接管，Runner-only 公开恢复已见实施计划第 47 节，Android 和通用恢复仍未完成。

正常并发发布期间，候选 `.pending-*` 目录可以在 inspection 枚举后原子改名。恢复竞争者将此变化分类为 `device_busy`；只读 inspection 对该明确竞态进行有界重读，避免把合法的发布窗口误报为损坏证据。临时目录内容不授权平台操作，任何结构异常仍按无效证据处理。

Runner absence 只完成 Runner 资源检查。存在 app、permission、forward、媒体或设备基线记录时，必须由对应 restorer 全部完成才可解除设备隔离。首个 iOS 恢复切片可限定为只有 Runner/已退出 host 工具证据的专用 Simulator；不能将它宣传为 iOS 权限或整机恢复。

### 16.4 验收证据

先证明 listener 在明确 Simulator、headless 和两 Simulator 下的定向/隔离，再验证 owner SIGKILL 后的认证与主动退出。覆盖同 boot/PID 复用、端口复用、旧 challenge、假 ACK、launch 前后崩溃、尚未 ready、Runner 卡住、平台读回失败、取消和恢复进程崩溃。断言错误进程未收到终止操作、原始证据可追溯、未完成恢复不能 acquire；最后在真实专用 Simulator 完成故障 → 隔离 → 检查 → 恢复 → 新 attempt。

此切片通过不提升 Face ID、Touch ID、Android 指纹、camera 权限、图库或镜头输入的支持状态。它们仍按第 15.1 节独立验收。
