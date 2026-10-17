# 自动化录制剩余验收：跨机器交接

更新：2026-10-17。用户已确认原生 macOS 权限与 exio 真实验收需要在另一台电脑完成。对应任务继续保持待验收，不再要求当前机器补权限或提供不存在的 App 路径。

关联：[设计 §10](../specs/2026-10-16-automation-recording-completion-design.md)、[实施计划](./2026-10-16-automation-recording-completion.md)、[41 项证据核对](./2026-10-16-automation-recording-completion-acceptance-audit.md)。本文件只列交接工作及完成条件，最新实现状态以源码和测试为准。

## 迁移前保存

当前工作区包含尚未提交的实现和回归测试。另一台电脑必须拿到完整当前工作区或包含这些改动的 Git 快照，仅拉取旧分支不足以复验。不要传输 `node_modules`、`dist`、Flutter 构建目录、本机 VM URL、设备配置或凭据；在目标机器按锁文件重新安装、构建，并启动加载当前 bridge 的 App。

源码迁移附件另存为 `.codex/recording-completion-source-2026-10-17.zip`，包含相对基线提交 `1e514cfc55527049b8ba097e368b6e07c4287884` 的 tracked patch、新源码/测试、当前生成式 feature docs 和校验清单。按包内 README 在该提交的全新独立 checkout 执行 `apply.py`；它先检查基线及冲突，再还原并核对 286 个验收源码指纹。该附件不包含依赖或运行产物；证据继续使用独立 handoff 包。生成式 feature docs 是当前生成器输出的原样副本。

本次本机可下载的补充附件放在仓库忽略目录 `.codex/recording-completion-handoff-2026-10-17/`，压缩包同名加 `.zip`。它包含六份 iOS 原生捕获生成的原样 TypeScript、SHA256、严格回放脚本、首次 macOS 扩展失败的便携导出、100 次简化诊断记录及本文。`source-identity.json` 记录当前 286 个源码/锁文件（含新增 settle 回归）的哈希，供迁移完整工作区时比对；修复前的 285 文件版本另存。`fixture/` 是初次验收时的临时宿主源快照。附件不是全部历史验收的归档，也不包含 exio、原生捕获会话或本机运行端点。传输后先核对附件的 `files.sha256.json`；不要把旧的 passed 报告当作目标机器新验收。

## 目标机器准备

1. 准备受仓库版本约束的 Node、pnpm、Flutter、Dart 和 VS Code；按锁文件安装，不升级框架。执行 `pnpm install --frozen-lockfile`、`pnpm build`、`pnpm lint`。Dart 需要时执行 `melos bootstrap`，再执行 `melos run analyze` 和 `melos run test`，保留实际诊断与跳过项。
2. macOS 原生自动输入需要实际执行程序具有辅助功能和事件发送权限；由目标机器用户在系统设置授权。记录授权后的检查结果。人工键鼠录制同样需要真实输入来源证据；bridge 合成动作不算原生录制。
3. 确认 exio 本机实际目录；原约定为 `/Users/leo.he/projects/exio/exio_app`。使用目标机器的实际路径，确认 app-owned `auth.seedLoggedIn`、HTTP mock 与业务可观察结果入口。不要用其他 App 替代此门槛。
4. 在目标 App 启动当前 bridge。端点通过目标项目的 `.fliwright/config.json` 或 `FLIWRIGHT_VM_URL` / `FLIWRIGHT_VM_SERVICE_URL` 提供；运行文件与证据包中不保存端点 token。
5. 在 App 项目中运行当前仓库 CLI 的 `doctor`，确认握手、录制协议与能力；连接到旧 App 时先完整重建启动。每条验收记录源码版本、App 构建、系统、设备、窗口逻辑尺寸、输入来源、scenario 名与指纹。

```sh
# 在仓库根目录执行
node packages/fliwright-cli/dist/index.js --help
node packages/fliwright-cli/dist/index.js doctor

# 在目标 App 目录执行，REPO_DIR 为当前仓库绝对路径
node "$REPO_DIR/packages/fliwright-cli/dist/index.js" scenario list --json
node "$REPO_DIR/packages/fliwright-cli/dist/index.js" doctor
```

## 待验收工作包

| ID | 执行内容 | 完成证据 |
| --- | --- | --- |
| M3.12 / M4.3：macOS 原生 | 原生键鼠打开表单、输入、提交并销毁；600ms 长按；清空、选择替换、自动聚焦粘贴；真实系统 IME composing/提交；列表慢拖动；相同 Save 文案的第二目标。unsupported 手势应保留 draft/partial。 | 保存原生操作记录、原始事件、冻结 selector、确认检查点、生成文件与 SHA256；输入先于提交，空值不丢失，时长/目标正确。每条关键流程在两种窗口尺寸下分别连续 20 次原样回放；每次命名 scenario 重置并重建控件树。失败后保留该轮，并重新计算后续连续次数。 |
| M4.3：业务反例 | 同一生成文件依次面对正常 App、保存不生效/错误文案/目标消失、恢复后的正常 App；拖动另验证禁滚动，第二 Save 验证回调不生效。故障只注入临时 fixture，记录 diff 并恢复重建。 | 正例通过，反例在原确认断言处失败，恢复后再通过；不换 selector、不改弱断言、不借 healing 成功。对照 result/Timeline/Trace 与实际画面，failed/partial 保持原状态。 |
| M4.2：exio | 在 exio 中声明具名、可组合 `TestScenario`；使用 app-owned `auth.seedLoggedIn` 和 mock 准备认证状态，完成至少一个认证业务闭环与一个错误分支。 | 提交实际业务状态/持久化或请求断言和错误 UI 断言，记录 scenario 指纹、mock 场景、生成源身份与 run。不能仅以退出码、动作成功或真实登录替代。若目标 App 缺 seed 能力，先补 App 自有测试能力，不能通用 Riverpod 覆盖认证。 |
| 跨机器产物 | 每个新增关键正反例导出后移走原 run，在独立目录/IDE Viewer 打开。 | manifest、result、Timeline、Trace 一致；全部截图/快照/日志引用可读，PNG 可解码、尺寸正确、关键画面与断言一致。partial 默认导出拒绝，显式 allow-partial 保留 missing。 |

运行顺序：先完成单条原生捕获→原样正例→业务反例→恢复，确认守门有效；再扩展双窗口连续回放；随后完成 exio 与导出读回；最后更新计划、审计及兼容性声明。无需重复已经独立通过的 Android/iOS 指定切片，除非目标机器更改了相关实现。

### 录制和严格回放入口

fixture 入口为 [recording_fixture_main.dart](../../../examples/form_demo/lib/recording_fixture_main.dart)，能力表面在 [recording_fixture.dart](../../../examples/form_demo/lib/recording_fixture.dart)。默认 fixture 不含全部反例开关，保存失效、目标移除、禁滚动等需在临时副本注入并留 diff；不得声称已有相应 CLI 开关。启动：

```sh
# examples/form_demo；项目已有桌面平台工程时执行
flutter run -d macos --debug --target lib/recording_fixture_main.dart
```

项目 `fliwright.config.ts` 中的最小具名 scenario 为：

```ts
export default {
  recording: { mode: 'standard' },
  scenarios: {
    'fixture-home': {
      name: 'fixture-home',
      layers: [{ kind: 'navigation', route: '/' }],
    },
  },
};
```

CLI `record --mode test --scenario fixture-home --assertions checkpoints.json --verify` 可录制并严格验证。`checkpoints.json` 是显式确认的检查点数组，例如提交页：

```json
[{"id":"saved-value","query":{"match":{"key":"saved_value"}},"matcher":"toHaveText","expected":"Saved: NativeMacOS","source":"runtime","confirmed":true}]
```

先 apply 对应 scenario，再录制原生操作。测试输出放项目 `.fliwright/tests/`，配套 flow 放 `.fliwright/recordings/`；候选为 draft 时保留原因，不能只移动文件后宣称 verified。IDE 也可审阅后确认检查点、回放验证、保存，操作内容变化后必须重新验证。

附件 `replay.mjs` 通过当前 `@fliwright/cli/run` 公共 `runCommand` 并指定 `recordingReplay: true` 执行，避免普通 authored test 的自动 healing 干扰反例。它在专用 workspace 建立具名 scenario，每轮仅一个 worker、无 retry；默认每文件 20 轮，首个失败即保留并退出，不改生成代码。输入是六份 **iOS 原生捕获** 文件，所以该附件只能补跨平台回放证据，不能代替在目标 macOS 新录制。

```sh
# 在目标机器运行；VM URL 从当前 shell 或目标项目 runtime config 提供
node "$HANDOFF_DIR/replay.mjs" \
  --repo "$REPO_DIR" --runtime "$APP_DIR/.fliwright/config.json" \
  --label 640x720 --output "$EVIDENCE_DIR/640x720-positive"
```

更换尺寸后停止并重启自己的 Flutter App、重新发现端点，确认截图实际尺寸后用新的 output 路径重复。`--label` 只断言截图尺寸，不调整窗口。`--expect failed --rounds 1` 用于已注入反例的 App；脚本要求每个文件均在业务断言处失败，所以只注入某个流程时须使用 `--case` 选择该流程。恢复后用新的 output 再运行。每个 output 必须为空/不存在，禁止覆盖旧失败。

## 尚未定位的真实失败

2026-10-17，六份 iOS 原生生成文件在 macOS 640×720 扩展回放第 14 轮失败：`iOS native long press clear and selected replacement` 第一动作约 459ms 后报 `No widget found matching selector`，随后 context dump 仍有 `FilledButton key=counter_increment` / `Count: 0`。该 attempt 的开始截图先超时，result/Timeline/Trace 均 failed，evidence partial。原 run 为 `run-2026-10-17T07-16-31-556Z`，其余五个测试通过。

简化为同一 App 上“具名 scenario 重置→长按 606.761ms→Count:10”的 100 次循环全部通过，未保留完整 runner/截图条件，不能证明修复。扩展回放需要保留截图时序与真实 runner 再缩小复现；尚未据此修改产品逻辑或放宽预算。附件保存原失败报告、便携 partial run、逐轮记录及简化循环结果；后续成功不得覆盖这次失败或计作修复。

失败画面的进一步核对：`action-1-failure.png` 仍显示上一页 Repeated text / Saved: secondary；同次 snapshot 含新旧页面，diagnostics 为 `transientCallbacks=1`、`hasScheduledFrame=true`；末帧已进入首页，但画面左侧仍有过渡痕迹。这些证据应一起移交，不把 context dump 有 key 等同于动作当时可点击，也不在缺少复现时推断根因。原诊断脚本保留了当时机器的模块路径，属于历史现场；跨机器复跑使用附件 `replay.mjs`。

随后以相同六文件、真实 runner/standard 截图、相同 640×720 尺寸和具名重建条件独立复跑 30 轮，共 180 attempt 均 passed/complete，1,050 张 PNG 的 CRC/IDAT 解码与尺寸检查通过。原失败保留且没有产品修复；该复跑只补单尺寸的后续观测，不关闭第二尺寸、原生 macOS 或偶发失败原因。附件仅携带这 30 轮汇总，canonical runs 仍在原机器 `/tmp/fliwright-native-files-macos-diagnosis/640x720/positive/runs/`，不声称它们全部已便携归档。

迁移脚本本身已在当前真实 App 上执行一轮六文件，passed/complete；`diagnosis/helper-live-acceptance.json` 是摘要，不包含该轮所有 run。原失败 partial 便携包的 28 张 PNG 均完整解码。自有 Flutter、App 和复跑 Node 进程已确认退出，临时窗口 Swift 源恢复；没有修改产品源码、依赖或提交。Harness、文档链接、任务 ID 数量及 diff whitespace 检查通过。

历史 iOS 首次原生保存空值仍未确定原因；M1.4 已修复的直接 Vitest/IDE 终态恢复有稳定红绿回归，但不能据此解释缺现场的所有历史缺 Trace。完整验收前，这些未解决事实应继续如实列出。

## 回交结果

每个任务附：状态（通过/失败/未验收）、版本与设备/窗口、输入来源、scenario 指纹、生成源码 SHA256、逐轮 run/attempt ID、反例与恢复证据、独立便携包、资源退出记录及尚缺项。只有满足相应设计门槛才关闭任务；整体发布完成需所有必需门槛闭合。

## 后续补证：双窗口与全部便携包（2026-10-17）

前文关于“第二尺寸尚未完成、30 轮仅有摘要”的描述是初次交接现场。后续已补齐这六份 iOS 原生生成文件在 macOS 的跨平台回放切片：640×720 独立 30 轮、821×777 连续 20 轮；各尺寸另有六文件业务反例与正常恢复，共 54 run/324 attempt。300 个正例 attempt、12 个确认断言 failed、12 个恢复 passed，均 complete。每轮具名 scenario 重建，无 retry，无 healing，无生成源码修改。完整 macOS 原生捕获、exio 与历史失败根因仍待验收。

更新后的附件 `followup/portable/` 收录全部 54 个 run，各包均在移走源 run 后独立读取 manifest/result/Timeline/Trace 与所有 evidence 引用；所有 1,902 张 PNG 的 CRC/IDAT 与尺寸通过（1,126 张 640×720、776 张 821×777）。`followup/portable-acceptance.json`、`image-verification.json` 和两张 contact sheet 记录证据；36 个正反/恢复末帧目视核对。粘贴反例故意移除原 saved_value key 而保留文案，须结合 snapshot 和原 key 的断言失败核对。

`followup/failed/` 保留两次期望 821×777 却得到 640×720 的设置失败及一次故障版启动失败，不能作为业务反例或连续正例通过。启动失败 run-2026-10-17T07-59-35-000Z 为六个首动作失败、所有截图超时、failed/partial；默认导出拒绝，明确 allow-partial 后保留状态。临时宿主改为首帧后设置尺寸并显式激活窗口，之后正确尺寸的反例/恢复通过，但不据此断言此前所有异常都由窗口状态引起，也未改产品。历史第 14 轮失败仍在初始 `portable/`。

`followup/route-reset-repro.json` 是新增跨页→截图→重置→长按的 100 轮全过诊断，仍未复现原 bug；无阶段记录的首次进程曾长时间未结束并被停止，原因不确定。诊断脚本和临时宿主只作为历史复验资料，不修改目标机器的正式生成文件。当前自有运行进程均已退出，临时源码恢复；本轮无产品或依赖改动。

## 后续产品修复：暂停帧时不能假报稳定

2026-10-17 后续定位到独立、确定性的 settle 错误：生命周期暂停帧调度后启动路由过渡，`hasScheduledFrame=false` 而 transient callback 仍待执行。旧实现按三次检查报稳定，但目的页尚不可点击。bridge 现同时检查两者，预算耗尽返回既有 timedOut，Page 导航默认抛错；恢复帧后正常完成。没有改默认预算或生成内容。

证据包括三个 widget 红绿回归，以及真实 macOS App 的合法生命周期序列探针：修复前约 57.701ms 错误返回成功、目的按钮 hitTestable=0；修复后约 172.618ms 按 160ms 预算报 settle timeout，恢复后长按验证 Count:10。首次临时生命周期调用不合法的 Server error 另行保留，不能作为产品红灯。`settle-fix/controlled-probe/` 保存测试、修复前后源码、日志和实际画面。

这是已有公开 settle 契约的修复。历史第 14 轮缺少当时生命周期/framesEnabled 数据，不能证明同因；原生 macOS 和 exio 的异机任务继续保持待验收。迁移当前工作区时，须包含 `settle_extension.dart`、新 `settle_test.dart` 和重新生成的能力目录；附件 source-identity 会更新，并保留前版本指纹供区分旧验收。

修改后另完成双窗口各 20 轮六流程原样回放：40 run/240 attempt passed/complete。`settle-fix/portable/` 收录全部 run，逐 run 移走源目录后读回；1,400 张 PNG 完整解码并检查尺寸，首末轮 24 个末帧样本目视正确。`settle-fix/portable-acceptance.json`、`image-verification.json` 和两张 contact 图单独记账。bridge 全包 191 passed/2 skipped、core Page/Scenario 44 passed、workspace lint、Dart format、feature docs 再生成与 Harness 检查完成；analyze 仍保留既有 3 条 import info。临时诊断扩展和窗口恢复，自有运行进程已退出，无依赖升级或提交。

## 历史失败专项复核补充

后续[专项诊断](./2026-10-17-recording-incident-review.md)通过真实窗口隐藏/最小化复现相同首动作失败和截图等待；窗口恢复后的 hasScheduledFrame=true 变体也稳定复现，当前 settle 修复两种路径均正确。历史具体窗口触发仍缺证据。iOS 首轮原始录像显示输入值从未出现，同期事件有焦点/点击而无文字；问题收窄到系统输入应用阶段，不能据此声称录制器丢字或系统问题已修复。`incident-review/` 保存本次对照、原始 iOS 附件、回放及 hidden 回归红绿日志；源码迁移指纹已同步新增 hidden 回归。

继续复核后，历史系统日志确认 UIKit 收到 12 个合成按键；同一 shouldSend=0 日志在成功轮也存在，不能当作丢字根因。录制开关、截图、键盘等待及全新模拟器首次输入三组共 24 轮通过，历史空值仍未复现、未关闭。`incident-review/ios-input-followup/` 收录 TextInput 通道/controller/录制结果和 XCTest 附件；`incident-review/ios-input-probe/README.md` 为参数化采证步骤，另一台电脑可在仓库 form_demo fixture 运行，按通道→controller→录制事件判断首次缺失边界。临时探针会改变观测开销，当前成功不能排除原有时序故障。未改产品源码或依赖，临时 App 源已恢复，新建模拟器已删除。

采证工具已再次更新：前述输入/Save 间的 HTTP 快照可能改变时序，现通过被动指针分发前读数观察保存前 controller。新增立即提交、被动观测和两种隔离服务延迟共 32 轮通过，两个首轮的 XCTest 内部焦点重试单列；失败轮按键完成通知晚于 Save 的历史差异及尚未确定的因果边界见专项报告。`incident-review/ios-immediate-followup/` 保留本轮结果。默认工具不会暂停系统服务；中止时保留 interrupted.json，并以故意失败的工具负对照验证。上一版 ZIP 误脱敏固定 17897 回调，已修正；应使用当前包的 ios-input-probe，归档检查仍会移除动态 VM 端点。历史空值未宣布修复。
