# Native 原生测试使用指南

Native 模块用于操作 Flutter widget tree 以外的界面：UIKit / Android 原生弹窗、系统权限提示，以及已获平台能力支持的原生文本框。Flutter 控件继续使用 `page`；原生控件使用 `native`；`device` 查询设备能力。两种操作和断言会保存到同一测试时间线。

`@fliwright/core` 提供 locator、断言和能力契约，`@fliwright/native` 提供 Android ADB 与 iOS Simulator XCTest 适配器，`@fliwright/vitest` 管理 fixture、进程绑定和清理，CLI 负责启动与报告。无需 Appium 或 WebDriverAgent。

## 1. 准备环境

目标 Flutter App 的 Debug 测试入口应已初始化 `fliwright_bridge`。Node 项目安装 `@fliwright/cli`、`@fliwright/vitest` 和兼容的 Vitest；自定义宿主直接使用底层会话时再安装 `@fliwright/native`。仓库内修改源码后先构建相关包；仓库根目录没有 CLI bin 时，用 `node packages/fliwright-cli/dist/index.js` 替代下面的 `pnpm exec fliwright`。

```sh
pnpm exec fliwright devices list --json
```

明确选择一个专用设备。不要把设备 ID、VM Service URL、工具绝对路径或 `.xctestrun` 产物提交到仓库。

- **iOS**：macOS、Xcode、已启动的 Simulator。当前不支持物理 iOS 的签名与传输。需先显式构建 Runner：

  ```sh
  pnpm exec fliwright native prepare --json
  ```

  检查 `ok: true`，将返回的 `data.xctestrunPath` 放入本机环境变量。此命令不启动模拟器或目标 App，缓存按源码与工具链变化失效。
- **Android**：ADB 可访问且已授权的设备；managed emulator 还需要 Android SDK APK Analyzer。使用运行中设备的实际 serial，停止的 `avd:<name>` 不能直接用于启动测试。设备恢复命令的 AVD 选择规则另见其 schema。

## 2. 配置项目

以下环境变量由项目配置自行读取，名称并非 CLI 内置的自动发现约定。缺失时应明确报错，不要退回任意设备。

```ts
// fliwright.config.ts — iOS 示例
import type { FliwrightProjectConfig } from '@fliwright/core';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before running native tests.`);
  return value;
}

export default {
  native: {
    enabled: true,
    platform: 'ios',
    deviceId: required('NATIVE_DEVICE_ID'),
    targetAppId: required('NATIVE_APP_ID'),
    ios: { xctestrunPath: required('NATIVE_XCTESTRUN') },
    systemAppIds: ['com.apple.springboard'],
    timeoutMs: 20000,
  },
  scenarios: {
    'native.screen': {
      name: 'native.screen',
      // nativeDemo.reset 是演示 App 自行注册的能力，不是通用内置方法。
      layers: [{ kind: 'app', capability: 'nativeDemo', method: 'reset' }],
    },
    'native.ready': {
      name: 'native.ready',
      extends: ['native.screen'],
      layers: [{ kind: 'device', requiredCapabilities: ['native.query', 'native.click'] }],
    },
    'native.input': {
      name: 'native.input',
      extends: ['native.screen'],
      layers: [{ kind: 'device', requiredCapabilities: ['native.query', 'native.click', 'native.fill.basic'] }],
    },
  },
} satisfies Partial<FliwrightProjectConfig>;
```

真实项目把 `nativeDemo.reset` 换成自己的命名业务基线。设备层是单例：父场景已有 device 层时，子场景不能再叠加一个 device 层；像上例一样从仅含 App 基线的场景分支组合。

Android 将 `native` 部分替换为：

```ts
native: {
  enabled: true,
  platform: 'android',
  deviceId: required('NATIVE_DEVICE_ID'),
  targetAppId: required('NATIVE_APP_ID'),
  // 从当前系统快照确认真实包名；不要假设不同 Android 系统一致。
  systemAppIds: [required('NATIVE_PERMISSION_APP_ID')],
  tools: { apkAnalyzer: required('NATIVE_APK_ANALYZER') },
  timeoutMs: 20000,
},
```

`systemAppIds` / `externalAppIds` 是原生查询允许访问的应用范围。配置目标 App 与 managed launch 的设备必须相同。fixture 还会核对当前 Flutter VM PID 与目标 App 进程，不能用另一台设备或另一个 App 的 VM URL。

## 3. 检查前置条件与发现定位器

```sh
pnpm exec fliwright native doctor --strict --json
pnpm exec fliwright native snapshot --json
pnpm exec fliwright scenario resolve native.ready --json
```

先安装目标 App，再运行 doctor / snapshot。Doctor 只读，不构建、不启动 Runner；`ready: true` 仅证明环境检查通过。iOS doctor 中能力的 `ready: false` 可表示还没有 live Runner 握手，不等同于不支持。`scenario resolve` 只解析组合，不验证实时设备。

`snapshot` 临时持有设备并启动所需的 XCTest 会话，但不启动或重置目标 App。不要在活动测试持有设备期间另外运行 native snapshot；测试内用 `native.snapshot()`。iOS 全树遍历较慢，可通过结构化输入缩小范围：

```json
{
  "query": { "field": "label", "value": "Allow", "exact": true, "scope": "system" }
}
```

保存为本机 `native-query.json` 后：

```sh
pnpm exec fliwright native snapshot --input native-query.json --json
```

## 4. 编写混合测试

测试放在目标项目的 `.fliwright/tests/*.test.ts`，从 `@fliwright/vitest` 导入 `test`、`expect`。以下 Keys、按钮和 App 状态来自仓库的 native fixture，业务项目按真实界面替换。

```ts
import { test, expect } from '@fliwright/vitest';

test.scenario('native.ready')('确认原生弹窗并返回 Flutter', async ({ page, native }) => {
  await page.getByKey('native_confirm').click();
  await expect(native.getByText('Confirm native')).toBeVisible();
  await native.getByText('Confirm native').click();
  await expect(page.getByKey('native_status')).toHaveText('Native: confirmed');
});

// iOS 当前为 unverified，此用例会在准备阶段被拒绝；用于将来的平台验收。
test.scenario('native.input')('替换原生输入并校验业务接收值', async ({ page, native }) => {
  await page.getByKey('native_input').click();
  await native.getById('native_text_input').fill('Replacement with spaces');
  await native.getById('native_text_input').fill("Second 'value' & 42");
  await native.getByText('Confirm input').click();
  await expect(page.getByKey('native_input_value')).toHaveText("Second 'value' & 42");
});

test.scenario('native.ready')('允许系统麦克风请求', async ({ page, native }) => {
  await page.getByKey('native_microphone').click();
  await native.getByText('Allow', { scope: 'system' }).click();
  await expect(page.getByKey('native_status')).toHaveText('Microphone: granted');
});
```

| API | 用法与限制 |
| --- | --- |
| `native.getById(id)` | Android resource-id / iOS accessibility identifier；优先于文案 |
| `native.getByText(text)` / `getByLabel(label)` | 默认 exact、App 范围；系统界面显式用 `{ scope: 'system' }` |
| `getById(id, { scope: { appId } })` | 其他 App 必须先加入 `externalAppIds` |
| `locator.click()` / `fill(value)` | 重新查询唯一、可见、启用且可交互的目标；`fill('')` 清空 |
| `locator.count()` / `isVisible()` / `waitFor({ state })` | state 为 attached / detached / visible / hidden；传输错误不会当成“未找到” |
| `expect(locator).toBeVisible()` / `toBeEnabled()` / `toHaveText(text)` | 原生断言自动进入 timeline；支持 `.not` |
| `native.snapshot()` / `screenshot()` | 原生结构 / PNG Buffer；原生 node id 是临时引用，不写进长期测试 |
| `native.swipe({ from, to, durationMs })` | 原生屏幕坐标；iOS 为点，Android 为像素，不能直接混用 |
| `device.capabilities()` | 查看 `support`、`ready`、`reason`；schema 接受不代表平台已支持 |

原生文本框的输入值是 snapshot 的 `value`，不等于 label / text；不要用 `toHaveText` 假设能检查输入值，优先断言返回 Flutter 的实际业务值。**iOS 基础填充当前仍为 `unverified`，运行时会在查询／输入前拒绝它，不能作为可用能力承诺。** 现有试验实现只处理最多 4096 个可打印 ASCII 字符、可读取的非密码文本框，并依赖英文 `Select All` 菜单与精确读回；本次设备验证发生超时，尚未通过。Unicode、密码、其他语言编辑菜单及其他文本控件同样未验证。Android 的基础 ASCII 填充可用，平台能力须分别检查。

## 5. 执行与权限基线

```sh
# managed：框架持有设备，按 attempt 停止、准备、启动并校验当前 App
pnpm exec fliwright run --device-id "$NATIVE_DEVICE_ID" \
  --target lib/main_fliwright.dart --test .fliwright/tests/native.test.ts \
  --timeout 180000 --deadline 600000 --recording-mode full --json

# attach：App 已启动，URL 必须属于所选设备及 targetAppId
pnpm exec fliwright run --vm-url "$VM_URL" \
  --test .fliwright/tests/native.test.ts --json
```

`--device-id` 与 `--vm-url` 互斥。CLI 自动安装所需 runner；直接执行 Vitest 需先配置 `fliwrightPreset(projectConfig)`。混合多个场景时用 `test.scenario(name)`，不要再传冲突的全局 `--scenario`。测试及重试应通过声明恢复自己的 App 基线。

权限弹窗只有在系统尚未作出决定时才出现。演示中的允许／拒绝必须分开运行，在专用 iOS 模拟器、无活动测试时，只重置演示 App 的麦克风基线：

```sh
xcrun simctl privacy "$NATIVE_DEVICE_ID" reset microphone "$NATIVE_APP_ID"
pnpm exec fliwright run --device-id "$NATIVE_DEVICE_ID" \
  --target lib/native_fixture_main.dart --test native-mixed.test.ts \
  --test-name 'allows the system microphone' --timeout 180000 --deadline 420000 --json
```

拒绝用例先再次重置，再选择 `denies the system microphone`；英文按钮为 `Don’t Allow`。结束后只清理自己改变的测试状态。这里是显式外部 fixture 准备，不是通用自动权限恢复。当前高层 device 场景中的 `permissions`、`baseline`、`biometricBaseline`、`media`、`cameraSource` 以及 `device.permissions.set()` 等不能当成已支持功能使用。

## 6. 结果与故障排查

检查进程退出码、JSON `ok` 和具体结果。保留返回的 runId、reportPath、timeline 路径；本地运行不覆盖 runsRoot，以便 CLI 与 VS Code 共用历史。

```sh
pnpm exec fliwright artifacts failures RUN_ID --json
pnpm exec fliwright artifacts timeline RUN_ID --json
pnpm exec fliwright artifacts report RUN_ID --json
```

`--recording-mode full` 保存动作前后证据，**不是连续视频录屏**。时间线的 `surface: native` 区分原生动作、快照与 Flutter 操作；系统弹窗须使用原生截图，Flutter 自身截图可能不包含系统叠层。HTML 报告可以离线展开证据；按名称筛选的 skipped 项、缺少验收清单或发布信息，都会使发布资格检查不通过，即使选中的演示路径成功。

| 现象 | 排查与处理 |
| --- | --- |
| `prepare-device` + `Required native capability '…' is unverified/unsupported/not-ready/missing` | 使用 live `device.capabilities()` 确认能力；不要删除 requiredCapabilities 或伪造就绪来绕过限制。固定诊断不包含平台原始错误、路径或 URL |
| `lifecycle is unusable` | 同次运行更早的准备失败已停止复用；先看首个错误，确认清理完成后另起运行，不自动重发不确定的写操作 |
| `strict_mode_violation` | 多个匹配；选唯一 accessibility ID，或缩小 App 范围 |
| 权限按钮找不到 | 检查权限已有决定、系统包 allowlist、语言及真实文案 |
| `device_mismatch` | 核对 native 与 managed 的设备，以及当前 VM PID / bundle |
| `device_busy` 或 quarantine | 先读 `native recovery inspect`；不要删 lease / journal。`verify` 只检查，`restore` 必须使用最新 fingerprint 与该平台支持的独立读回流程 |
| 输入失败或结果未知 | 查看原生快照、编辑菜单及动作证据；精确读回不一致会失败，不能按“命令已发出”认定成功 |

详细恢复输入以 `pnpm exec fliwright schema native.recovery.restore --json` 为准。iOS 恢复 receipt 仅针对 XCTest Runner；Android 恢复路径虽有实现与主机契约测试，仍需专用设备验收，不能据此保证整台设备已恢复。

## 已验证范围与相关资料

维护的 [演示 App](../examples/form_demo/README.md#mixed-flutter-and-native-ios-fixture) 提供真实 UIKit 确认／取消、原生输入验收用例和系统麦克风权限流程；原生输入用例存在不代表 iOS 输入能力已通过验收。实际平台覆盖与限制以 [native 包说明](../packages/fliwright-native/README.md) 为准。

App 内固定相机结果使用 `cameraTest` / `FliwrightCameraTestCapability`，生物识别回调观测使用 `biometricTest`。这些是 App 显式接入的测试接口，不能证明摄像头传感器、系统相机 UI 或真实 Face ID / 指纹认证已通过。硬件注入、媒体导入和物理 iOS 不作为当前已验证能力承诺。

- [测试编写 SKILL 原生参考](../.agents/skills/write-fliwright-tests/references/native.md)
- [CLI 工作流 SKILL 原生参考](../.agents/skills/fliwright-cli-workflows/references/native.md)
- [生成式实现 API](./features/native/README.md)
