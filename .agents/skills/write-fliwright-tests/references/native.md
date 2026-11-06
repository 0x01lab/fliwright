# Native UI 与 Flutter 混合测试

当目标在 Flutter widget tree 之外时使用：原生弹窗、系统权限界面、原生文本输入。`page` 操作 Flutter，`native` 操作平台 UI，`device` 查询能力。App 内 `cameraTest` / `biometricTest` 是单独的显式测试接口，不能据此宣称摄像头或生物识别硬件支持。

## 配置与执行

先读 [CLI native 工作流](../../fliwright-cli-workflows/references/native.md) 设置平台、明确的 deviceId/targetAppId、iOS Runner 或 Android 工具路径。`native.enabled` 必须为 true，当前 VM PID 必须属于该设备的目标 App。不要在 fixture 已持有设备时额外创建 `createNativeSession()` 或运行 CLI native snapshot。

将业务基线与设备要求组合成命名场景，并在同一项目配置注册：

```ts
const scenarios = {
  'native.screen': {
    name: 'native.screen',
    // 替换为目标 App 注册的真实能力；nativeDemo 是仓库演示接口。
    layers: [{ kind: 'app', capability: 'nativeDemo', method: 'reset' }],
  },
  'native.ready': {
    name: 'native.ready', extends: ['native.screen'],
    layers: [{ kind: 'device', requiredCapabilities: ['native.query', 'native.click'] }],
  },
  'native.input': {
    name: 'native.input', extends: ['native.screen'],
    layers: [{ kind: 'device', requiredCapabilities: ['native.query', 'native.click', 'native.fill.basic'] }],
  },
};
```

一个组合场景只允许一个 device 层，输入场景不要继承已有 device 层的 ready 场景再补一个。`requiredCapabilities` 在启动/连接之前及每个 attempt/retry 检查，使用 live 能力报告验证，不删除要求来让测试勉强通过。当前 device 的 baseline、permissions、biometricBaseline、media、cameraSource 声明尚未开放通用执行。

## 测试写法

```ts
import { test, expect } from '@fliwright/vitest';

// Keys、App 能力与文案均需从目标 App 确认。
test.scenario('native.ready')('原生确认结果返回 Flutter', async ({ page, native }) => {
  await page.getByKey('native_confirm').click();
  await native.getByText('Confirm native').click();
  await expect(page.getByKey('native_status')).toHaveText('Native: confirmed');
});

// iOS 目前仍为 unverified，会在准备阶段拒绝；仅作为平台验收目标。
test.scenario('native.input')('替换原生文本并检查实际业务值', async ({ page, native }) => {
  await page.getByKey('native_input').click();
  await native.getById('native_text_input').fill("Second 'value' & 42");
  await native.getByText('Confirm input').click();
  await expect(page.getByKey('native_input_value')).toHaveText("Second 'value' & 42");
});
```

- 使用 accessibility identifier / Android resource-id 优先；`getByText`、`getByLabel` 默认 exact/app scope。多匹配立即报 strict mode，不能取任意第一个。
- 系统权限按钮必须明确 `native.getByText('Allow', { scope: 'system' })`，且配置正确的 systemAppIds；其他 App 用 `scope: { appId }` 并加入 externalAppIds。确认系统语言与实际文案。
- 断言来自 `@fliwright/vitest`：`toBeVisible`、`toBeEnabled`、`toHaveText`、`.not`。输入的 `value` 不等于节点 label/text，优先检查 Flutter 接收到的业务值。
- iOS 的 `native.fill.basic` 与 Unicode 输入当前均为 `unverified`，运行时拒绝执行；不要通过删除 requiredCapabilities 来绕过。Android 基础 ASCII 输入可用，须分别检查平台能力。
- `fill` 是替换，`fill('')` 是清空；基础输入限可打印 ASCII 和非密码控件，iOS 限最多 4096 字符、可读文本框、英文 Select All 与精确读回。Unicode、密码、其他语言编辑菜单不在已验证范围。
- `count`、`isVisible`、`waitFor({ state: 'visible' })` 可用于探索；不存在与传输失败不同。不要把 transport error 捕获后当成元素消失。
- `native.snapshot()` 返回原生结构，node id 只属于当次快照，不能写进长期测试。`native.screenshot()` 返回 PNG Buffer，已有 timeline 证据时通常无需手工存图。
- swipe 坐标属于平台屏幕：iOS 点、Android 像素；优先 locator，避免从截图像素直接推算 iOS 点。

## 权限与结果

允许/拒绝系统弹窗必须有独立可重复的权限基线。App reset 不能恢复系统权限。仅在专用模拟器、无活动测试时显式设置测试目标 App 的前置权限；iOS 演示可用 `xcrun simctl privacy DEVICE reset microphone APP_ID`，每条相反决定分别重置并运行。不要在通用业务测试中自动擦除设备或操作其他 App 权限。若环境没有该准备能力，报告具体缺口，不用假授权代替。

用 CLI `run --recording-mode full` 保存 Flutter/native 动作、原生快照及截图。这是动作证据，不是连续录屏；Flutter 截图可能看不到系统弹窗。动作 acknowledgement 不能替代业务断言。

失败先检查首个错误和 timeline：能力缺失应显示具体能力与 unsupported/unverified/not-ready/missing 状态，平台原始路径/URL 不进入公开准备错误。unknown outcome、超时或 cleanup_failed 后保留 journal/quarantine，使用 CLI recovery 检查；不要自动重发动作或删锁。
