# Native 模块工作流

用于 Flutter tree 外的原生弹窗、系统权限界面与原生输入。使用项目已安装 CLI；Fliwright 源码仓库根目录没有 bin 时可调用构建后的 `node packages/fliwright-cli/dist/index.js`。创建/修改自动化测试时同时使用 `write-fliwright-tests`，其 [native 参考](../../write-fliwright-tests/references/native.md) 说明 locator、fixture 和命名场景。

## 选择平台并准备

1. `fliwright devices list --json`：选择明确且在线的设备，使用专用 Simulator/Emulator。设备 ID、VM URL、Runner 产物及工具路径放本机环境，不能提交。
2. iOS 在 macOS/Xcode 上显式 `fliwright native prepare --json`，读取 `data.xctestrunPath`。不自动 boot/install/launch。Android managed Emulator 要有 SDK APK Analyzer；停止的 avd:<name> 不能直接作为 run 的 device-id。
3. 配置 `native.enabled/platform/deviceId/targetAppId`，iOS 的 `ios.xctestrunPath`，Android managed Emulator 的 `tools.apkAnalyzer`。系统 UI 需正确的 `systemAppIds`，其他 App 需 `externalAppIds`。环境变量名称由项目自行读取，没有通用自动拾取的 NATIVE_* 配置。

```ts
// fliwright.config.ts 的 native 部分；用 required(name) 对缺失环境明确报错。
native: {
  enabled: true, platform: 'ios',
  deviceId: required('NATIVE_DEVICE_ID'),
  targetAppId: required('NATIVE_APP_ID'),
  ios: { xctestrunPath: required('NATIVE_XCTESTRUN') },
  systemAppIds: ['com.apple.springboard'],
  timeoutMs: 20000,
},
```

Android 改 platform 为 android，去掉 ios，按实际系统配置 systemAppIds，并指定 tools.apkAnalyzer。不要复制 iOS bundle 或 Android permission-controller 包名到另一平台。

## 检查与发现

- `native doctor --strict --json`：只读环境检查，不启动 Runner、不构建/安装 App。目标 App 需已安装；iOS doctor 的 supported 能力仍可能 ready=false，直到 live Runner 握手。
- `native snapshot --json`：短期拥有设备，启动所需 Runner，并在结束时清理；不启动目标 App。不要与活动测试争抢设备。测试内用 native.snapshot()。
- iOS 优先缩小快照 query，避免全树遍历超时。使用 --input 文件：

```json
{"query":{"field":"label","value":"Allow","exact":true,"scope":"system"}}
```

具体输入见 `schema native.snapshot --json`。Flutter 的 app snapshot 不包含原生系统叠层。

## 运行与证据

```sh
fliwright scenario resolve native.ready --json
fliwright run --device-id "$NATIVE_DEVICE_ID" --target lib/main_fliwright.dart \
  --test .fliwright/tests/native.test.ts --timeout 180000 --deadline 600000 \
  --recording-mode full --json
# 已启动 App 的 attach 运行改用 --vm-url "$VM_URL"，两者互斥。
```

`page`、`native`、`device` 来自 @fliwright/vitest；CLI 设置 runner，直接 Vitest 需 fliwrightPreset。native 与 managed 使用同一设备，并验证 VM PID/bundle。managed 每个 attempt/retry 重新停止、准备、启动并验证 endpoint；静态 skip 不启动 App。多场景套件用 test.scenario，避免全局 --scenario 冲突。

设备场景当前支持 requiredCapabilities 只读检查，不把 schema 中的 permissions/baseline/media/cameraSource 当作已开放能力。先查 live device.capabilities() 的 support/ready/reason。iOS 基础 ASCII 与 Unicode 填充仍为 unverified，运行时拒绝，不能通过存在 fill API 或测试文件推断已可用。Android 基础 ASCII 填充可用；密码和生物识别注入不作为已验证能力。

系统权限已决定就不会再次提示；演示 Allow/Don’t Allow 必须分别建立 prompt 基线。仅在专用 Simulator 且无活动运行时，对目标 App 用 `xcrun simctl privacy DEVICE reset microphone APP_ID`，单独选择每条用例；不能用 App reset 代替权限 reset。结束后清理自己改变的测试状态。高层权限恢复、麦克风录制与真实传感器不由此证明。

保留返回的 runId/reportPath/timeline，使用项目默认 runsRoot：

```sh
fliwright artifacts failures RUN_ID --json
fliwright artifacts timeline RUN_ID --json
fliwright artifacts report RUN_ID --json
```

`--recording-mode full` 是动作前后截图/结构证据，不是视频。报告含 skipped、缺失计划/发布信息时 releaseReady=false，不代表选中用例失败，也不能当作发布通过。

## 失败与恢复

prepare-device 的固定诊断可显示具体能力和 unsupported/unverified/not-ready/missing 状态；原始平台错误只留在 supervisor。后续 lifecycle unusable 是此前失败的结果，先看第一条错误。超时、未知写结果或清理未确认不能自动重放；保留 lease/journal/quarantine。

`native recovery inspect --json` 只读本地证据；iOS 可 `native recovery verify --json` 核对当前 Simulator 与记录。restore 使用 inspect 的最新 fingerprint，且只恢复 receipt 声明的 resourceScope；输入以 `schema native.recovery.restore --json` 为准。PID/boot/签名挑战不匹配时停止恢复，不能删锁或终止不属于当前会话的进程。Android recovery 有实现但设备验收仍有限；恢复成功也不证明所有权限/媒体/硬件基线已就绪。

原生底层自定义宿主用 createNativeSession(config) 并在 finally await runtime.dispose()。Vitest 已管理 owner 时不再手工创建会话。cameraTest / biometricTest 是独立的 App 显式测试接口，不等价于相机或生物识别硬件注入。
