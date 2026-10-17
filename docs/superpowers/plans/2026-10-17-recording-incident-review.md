# 三次历史失败的专项诊断

日期：2026-10-17。关联[实施计划](./2026-10-16-automation-recording-completion.md)与[验收审计](./2026-10-16-automation-recording-completion-acceptance-audit.md)。本次针对历史首动作失败、故障版启动后截图超时、iOS 首次提交空值，不扩大为完整发布验收。

## 结论及证据边界

| 历史现象 | 本次定位 | 仍缺的证据 |
| --- | --- | --- |
| macOS 第 14 轮首个长按失败，context 中有 counter_increment，诊断为 transientCallbacks=1 / hasScheduledFrame=true | 已用真实窗口隐藏→旧 settle 提前返回→恢复窗口→立即长按稳定复现相同报错、诊断和上一页画面，5/5。当前 settle 等待恢复后实际完成路由，5/5 正常长按。 | 原历史现场没有 lifecycle/framesEnabled/窗口状态，尚不能证明当时确由隐藏、最小化或其他帧暂停事件触发。现有证据定位到可复现机制，不补写不存在的历史触发记录。 |
| 故障版重启后六个首动作失败、所有截图超时 | 隐藏/最小化会进入 Flutter hidden，关闭帧调度。旧 settle 只看 hasScheduledFrame，忽略排队路由 ticker；新页面未可操作却允许执行。真实窗口两种方式各 3 轮，旧实现 6/6 复现首动作失败；当前实现 6/6 在准备阶段正确超时；12/12 恢复后成功。开始截图均在 1,000ms 观察预算内超时，窗口恢复后原请求返回。 | 历史启动时具体窗口/宿主事件未记录；不能把当前实验的窗口动作当成历史日志。故障业务断言尚未开始，历史 run 仍为 failed/partial。 |
| iOS 首次保存为空 | 原始 XCTest 录像显示 typeText 后表单仍为空，随后 Submitted 为 Saved: 空值。同期录制 session 有焦点和三组正确目标的点击，没有文字事件；当前聚合器回放也只产生三个点击。问题可定位到系统输入应用到 Flutter 的阶段，早于代码生成和回放。 | 无该轮 TextInput channel/实际 controller 变更探针，不能进一步断言是 XCTest、键盘就绪、系统投递还是 Flutter engine 输入处理的哪一项。没有为此修改录制输入逻辑，也不宣称系统输入问题已修复。 |

## macOS 的因果链

真实 Cocoa `NSWindow.miniaturize` / `orderOut` → Flutter `AppLifecycleState.hidden` → `framesEnabled=false` → 重建路由将 ticker 排队而不产生新帧 → 旧 settle 观察到 `hasScheduledFrame=false`，约 40–46ms 误报稳定 → selector 对应控件尚未完成布局/可操作状态 → `No widget found matching selector`。

context dump 是诊断树遍历；动作解析要求可操作目标。树中出现 Key 不等于当时屏幕上存在已布局、可点击的目标。恢复窗口时 `hasScheduledFrame` 又变为 true，路由仍在动画中；因此历史诊断为 true 也不能排除此前发生过暂停。恢复竞态实验五次失败的截图实际仍显示 Repeated text / Saved: secondary，与历史失败画面一致。

当前产品修复已在前一轮落地：[settle_extension.dart](../../../packages/fliwright-bridge/lib/src/extensions/settle_extension.dart) 同时检查 scheduled frame 和 transient callback；[Page.ts](../../../packages/fliwright-core/src/Page.ts) 导航默认抛出 settle timeout。窗口一直隐藏时正确失败；窗口及时恢复时等待路由完成，再执行操作。不自动激活用户窗口，不改变生成代码、默认超时或 selector。

本轮将 [settle_test.dart](../../../packages/fliwright-bridge/test/settle_test.dart) 的真实路由回归扩展到 hidden 和 paused 两种生命周期。将同一测试放入临时 bridge 副本、使用修复前实现，得到 1 passed / 3 failed，失败点为预期 timedOut 却得到 null；当前实现 4 passed。产品 Dart/TypeScript 源码没有新增修改。

## iOS 原始现场复核

- 失败 XCTest：`native-1792212460789.xcresult`，12:47:58 开始的测试录像。导出了活动树、屏幕录像、输入合成事件和失败层级。
- 同期 session：`24da086b-97a9-4c17-8205-09dc8d87b6a4`，归档序号 1–11 连续；focus true/false 均存在；Open form、输入框和 Save 的目标正确；没有 textInput。该轮终态 lastSequence 未保留，不能单凭连续序号证明完整投递，但录像独立证明输入框没有预期文字。
- XCTest 合成事件确实请求 `NativeIOS265`，typingSpeed=60；这只证明输入请求已发起，不证明 App 收到编辑值。旧验收脚本在提交前缺少输入值断言；后续脚本已增加 `field.value` 检查，避免把输入准备失败归到保存/录制阶段。
- 后续成功 session：`250cd5ac-abf7-4b21-898b-89f314f1aaf2`，有 12 条从 N 到 NativeIOS265 的文字事件。相同当前 EventAggregator 合并为 Open form → fill(NativeIOS265) → Save。没有用后续的 typed-field.json 或 partial-capture.json 冒充首轮现场。

## 本次执行和归档

实际执行命令及结果：

```sh
node /tmp/fliwright-incident-review/window-regression.mjs
# passed；12 次旧/新窗口状态对照，含 12 次恢复。
node /tmp/fliwright-incident-review/resume-race-enabled.mjs
# exit 0；5/5 复现恢复后的 hasScheduledFrame=true 首动作失败。
node /tmp/fliwright-incident-review/resume-race-current.mjs
# exit 0；5/5 等待恢复后正常长按。
node /tmp/fliwright-incident-review/ios-event-replay.mjs
# passed；首轮无文字事件，成功轮文字合并正确。
flutter test test/settle_test.dart
# 当前 bridge：4 passed；临时旧实现：1 passed / 3 failed。
```

原始证据及诊断脚本保存于忽略目录 `.codex/recording-incident-review-2026-10-17/`，另有同名 zip；交接包包含其副本。运行脚本中的临时路径是本次诊断现场，需要当前临时 App、诊断扩展及本机端点，不是可直接用于正式项目的公开命令。归档 runtime log 已移除端点。原始历史 run 保持不变。

归档保留三种额外试验失败：临时扩展重复注册、首次隐藏窗口后连接退出、截图仍赶上最小化末帧而未按预期超时；这些不是上述产品回归红灯。另一个恢复探针在生命周期尚未 resumed 时已发送动作，复现 hidden 状态，未达到 hasScheduledFrame=true 的特定断言，也单独保留。正式对照使用原生窗口事件，并等待观察到所需生命周期；120ms 恢复定时器仅用于制造诊断时序，不进入产品和生成测试。

临时 main、Swift 窗口及 AppDelegate 已恢复，旧 settle 诊断文件已移除，自有 Flutter/App/Node 进程已退出。新增持续维护的改动仅为 hidden 路由回归及本文档/证据索引；已有发布门槛继续按计划验收。

## 后续推进：iOS 原生输入边界诊断

在同日后续诊断中，进一步从原模拟器保留的 unified log 提取历史失败秒级日志，并与历史成功轮交叉对照。失败轮 12:48:03.083059 发起 `Typing NativeIOS265`，12:48:03.096190–03.273607 间 Runner/UIKit 收到 12 个 `Keyboard receives keyEvent type: 4`，12:48:03.476299 返回 `Typing complete`。这比单凭 XCTest 输入请求更进一步：合成按键确已抵达 UIKit，随后原始录像输入框仍为空、录制 session 没有文字事件。

不能将同期 `backing type: 30; shouldSend: 0` 解读成丢弃原因：成功轮 13:23:29 的 12 个按键也各有同一日志，并最终正确保存。失败轮输入窗口内出现 InputUI 建立会话的记录，也只能视作后续检查线索，尚没有因果对照证明其导致空值。故障边界收窄为原生键盘处理到 Flutter 编辑值更新之间；历史现场没有 Flutter TextInput channel/controller 探针，仍不能进一步区分 UIKit、Flutter engine 与编辑连接处理，也不据此排除整个 bridge 集成。

为下一次复现补齐临时观测：使用只转发消息的 BinaryMessenger 包装，记录 `flutter/textinput` 的收发方法和参数；通过诊断 extension 同步读取所有 EditableText controller、焦点、selection/composing 与生命周期；录制开启轮同时保留真实 session。没有替换用户输入、设置 controller、修改产品 binding 或向系统注入伪造 TextInput 消息。探针会增加观测开销，因此成功结果也不能排除原时序问题。

实际运行 `node /tmp/fliwright-ios-input-review/run.mjs` 的三组 XCTest 对照及 `python3 /tmp/fliwright-ios-input-review/verify.py`：

| 组别 | 轮数 | 变量 | 结果 |
| --- | --- | --- | --- |
| baseline | 6 | 录制开/关交替；开启轮关闭截图；tap 后直接 typeText | 6/6 输入与保存正确，开启录制的 3 轮均 captured |
| screenshot-keyboard | 12 | 录制开/关交替；开启轮恢复截图；后 6 轮增加键盘及 n 键可见等待，前 6 轮无此等待 | 12/12 正确，开启录制的 6 轮均 captured |
| cold-device | 6 | 新建独立 iPhone 15 / iOS 26.5 模拟器，保留首次输入；录制开/关交替；开启轮采集截图；无额外键盘等待 | 6/6 正确，开启录制的 3 轮均 captured |

24 轮均在提交前观察到系统值和 Flutter controller 为 NativeIOS265；输入通道收到对应 updateEditingState，提交值为 Saved: NativeIOS265。12 个录制轮均产生 tap → type(NativeIOS265) → tap。三个 XCTest result bundle 均为 Passed，没有 retry。此处只是输入诊断，不包含新增生成代码回放、业务反例或完整平台验收；不能以 24 次未复现关闭历史故障，也不能宣称某项键盘等待已修好问题。

后续证据存放于上述忽略目录的 `ios-input-followup/`，包括系统原始日志与对照、24 轮通道/controller/录制结果、XCTest 汇总和附件、源探针及本机执行脚本。`ios-input-probe/README.md` 提供给另一台电脑的参数化运行步骤，专用于仓库 form_demo fixture，不直接适配 exio。发生空值时，应保留原失败，按“UIKit 按键 → TextInputClient 更新及 client ID → controller → 录制事件”定位首次缺失的边界。

本轮没有改产品源码或依赖，未新增推测性修复。临时 main 已恢复，运行进程已退出，原模拟器恢复为 shutdown；新建的独立模拟器已删除。复制证据后再次校验交接 ZIP 和源码恢复，完整原生 macOS/exio 发布门槛继续保留。

## 再推进：输入完成通知、提交顺序与观测干扰

历史完整秒级日志中另有可核验差异：失败轮的 Save 合成点击始于 12:48:03.555032，触摸完成于 03.641570；十二个 `Got user testing notification ... KeyEventComplete` 却在 03.773432–03.792033 才出现。成功轮十二个通知在 13:23:29.383087–29.526054 已完成，Save 点击直到 29.820199 才开始。去重时只计 `Got user testing notification`，不重复计同一通知的 `Calling handler` 日志。`historical-submit-order.json` 保存比较结果。

结合失败录像中的实际空值，这支持继续追查“输入处理尚未完成就提交”的竞态。但通知时间本身不等同于 Flutter controller 更新时刻，仍不能将通知滞后单独当作确切根因，更不能据此修改录制器补造文字。前述 24 轮诊断在 typeText 和 Save 之间有一次输入值读取及 HTTP/通道快照，会改变时序；这些结果只证明对应观测流程通过，不能证明原始立即提交流程没有竞态。

因此增加独立的立即提交与被动观测对照：

| 本轮对照 | 次数 | 结果及限制 |
| --- | --- | --- |
| immediate-cold | 12 | 新建隔离模拟器；前六轮 typeText 后直接 Save，不读取输入值、不发诊断 HTTP；后六轮等待原生 value predicate。录制开关交替，均正确保存。首轮 typeText 曾因 keyboard focus 未就绪由 XCTest 自动重试一次，保留原活动树。 |
| keyboard-delay | 4 | 仅在该隔离模拟器暂停 kbd 服务 2,400ms，定时及 finally 保证恢复；立即保存与 value predicate 交替。四次均通过，XCTest 等待将 Save 推迟到服务恢复后，未复现历史空值。不能据此认定“只要键盘变慢就会丢字”。 |
| input-ui-delay | 4 | 同样只暂停该隔离模拟器的 InputUI 服务；四次均正确保存，仍未复现。 |
| passive-observer | 12 | 在 Flutter 指针 down/up 分发前被动记录 EditableText controller/焦点，并给输入通道与指针加 wall clock；前六轮没有输入与 Save 间的值读取或 HTTP，后六轮等待 value predicate。十二次保存正确，Save up 前均有正确 controller 值及对应输入通道更新。首轮 typeText 有一次 XCTest 内部焦点重试。 |

以上 32 轮均成功，16 个开启录制的 session 均 captured 且文字正确；这是本轮独立数字，不覆盖上轮 24 次。外层没有配置测试重跑，但两次 XCTest 内部 action retry 必须如上单列，不能把对应首轮算作首次直接成功。两个服务暂停只用于受控实验，不进入产品或跨机器默认采证脚本，也不据此推断历史服务曾暂停。

采证工具改为不在立即输入/保存间请求快照，通过指针事件记录保存前值，结果仍在提交后读取。另修复失败退出时丢弃最后诊断状态的问题：XCTest 中止后若 recorder 仍在运行，`interrupted.json` 保留最后通道/controller 状态与 stop 返回的录制结果。使用故意错误的原生断言中止来验证该文件，明确属于工具负对照，不是复现了历史空值。

上一版 ZIP 的脱敏规则误将固定回调地址 `http://127.0.0.1:17897` 当作 VM 端点替换，使 Swift 探针无法直接运行；现已保留该固定诊断地址并继续移除动态 VM 端点。更新后的 `ios-input-probe/` 使用实际跑过的被动探针和原生循环，归档后再次检查脚本、固定回调及源码一致性。异机运行仍需按 README 设置仓库、Flutter 与设备参数，不声称已经在另一台电脑验证。

本轮证据为 `ios-immediate-followup/`，包含原始时序对照、四组活动树/录制/通道结果、内部重试、工具故意失败的负对照及截图附件。诊断 instrumentation 只在临时 fixture 副本中，未修改产品源码、依赖或输入语义。临时 main 和自有模拟器/运行进程恢复与清理后同步交接包；iOS 历史空值继续保持未关闭。
