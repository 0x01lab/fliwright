# 人机校验 / Captcha（滑块、WebView 覆盖层、第三方 SDK）

读这一页的时机：被测流程里出现**人机校验、滑块、拼图、行为验证**（例如阿里云、腾讯防水墙、
极验等 captcha SDK），或任何**不在 Flutter 控件树里**的覆盖层（WebView 叠层、
广告、第三方 H5）。下文以“滑块”泛指这类组件；不同 SDK 的约束相同。

> 这类组件是 Fliwright E2E 里**最常见的卡点**：它由第三方 SDK 在 WebView/PlatformView
> 里绘制，**桥接的 `ext.fliwright.snap` / `ext.fliwright.action` 看不到它**，也拿不到
> 它内部的滑块/按钮。如果按普通 Flutter 控件去 `getByKey` / `getByText`，必然找不到。

## 先理解滑块人机校验的约束

滑块 captcha（阿里云/腾讯/极验等，原理相同）的流程是：

```
App 调 SDK 出图 → 用户操作滑块 → SDK 现场生成 sig/sessionid/cscene token
   → app 把 token 发给自己后端 → 后端调 SDK verify 接口验签
```

两条硬约束，决定了哪些绕法可行、哪些不可行：

1. **token 是 SDK 现场算出来的，不存于任何 Riverpod provider / Dart 单例。** 所以
   `driver.state.override(...)` 覆盖一个 "captcha provider" 通常**无法**让后端验签通过
   ——除非你的 app 后端在测试环境关掉了 captcha 验签，或 app 暴露了测试专用的 bypass。
2. **滑块 UI 在 WebView/PlatformView 里**，不走 Flutter semantics 树。桥接的
   `getByKey`/`getByText`/`snapshot` 对它无效，只能靠坐标。

## 决策树（按这个顺序选）

```
被测路径会不会触发 captcha？
│
├─ 否（纯校验态、不点触发按钮） → 不处理，正常写。
│
└─ 是 ──► 第一优先：能不能用 flow.manual 让人拖？
          │
          ├─ 能（有真人/CI 可挂人工步骤） → ✅ 方案 A：flow.manual + resumeWhen
          │                                      （最稳，对所有 captcha 通用）
          │
          └─ 不能（必须无人值守的 CI 回归）
                    │
                    ├─ 滑块起点固定、分辨率确定 → 方案 C：slideTo / dragFrom 按坐标自动滑
                    │                              （脆弱，仅作为退路）
                    │
                    └─ 坐标也不可靠 → 方案 D：把该用例拆成
                                     "校验态断言" + "mock HTTP 接口断言"，
                                     不真过 captcha。
```

**不要用 `driver.state.override` / Riverpod override 去绕 captcha。** captcha 的 token 是
第三方 SDK 在 WebView 里现场生成的，后端会验签；覆盖 Dart 侧一个 provider 既绕不过 WebView 弹出，
也绕不过后端验签。override 只会让模型在「这个 provider 能不能 override」上空转，产出看似 mock 了
实际跑不通的方案。**唯一可靠的过 captcha 方式是方案 A（人工拖）；绕不开时用方案 D（拆用例）。**

## 方案 A：`flow.manual` + `resumeWhen`（推荐，默认选这个）

让人在运行中的 app 里把滑块拖完，脚本**轮询"下一业务态"**自动继续。这是 SKILL
对第三方人机校验的**默认推荐**。

关键点：**完成信号必须来自 app 内可观察的下一状态**（路由标题、新表单、成功页），
不要依赖 captcha 文案消失、终端回车、VS Code 按钮、touch 文件。

```typescript
import { test, expect } from '@fliwright/vitest';

test('过完滑块校验进入下一步', async ({ page, flow, mock, logger }) => {
  // 1. mock 掉 captcha 之后的业务接口（这些是 app 自己的后端，可以 mock）
  await mock.rules('发送验证码返回成功', async () => {
    await mock.clearRoutes();
    await mock.clearCalls();
    await mock.routeFlutter('/api/send-code', {
      method: 'POST',
      status: 200,
      body: { success: true },
    });
  });

  // 2. 填好前置表单并点触发按钮，captcha 弹出
  await flow.step('填表并点提交触发 captcha', async () => {
    await page.getByKey('myForm.fieldA').fill('value-a');
    await page.getByKey('myForm.fieldB').fill('value-b');
    await page.getByKey('myForm.nextButton').click();
  });

  // 3. 暂停，让人在 app 里拖滑块；拖完 app 会进入下一业务步
  await flow.manual('完成滑块验证', {
    message: '请在运行中的 app 内手动完成滑块验证。',
    timeoutMs: 180_000,
    pollIntervalMs: 700,
    // resumeWhen 必须是"下一业务态"，不是"captcha 消失"
    resumeWhen: async () =>
      page.getByKey('myForm.nextStepField').isVisible(),
  });

  // 4. 继续自动流程
  await expect(
    page.getByKey('myForm.nextStepField'),
    '下一步的输入框可见',
  ).toBeVisible({ timeout: 10_000 });
});
```

**怎么选 `resumeWhen` 的目标**（从最稳到次稳）：

1. 下一页面/步骤的**稳定 Key**（如下一步表单的字段 Key）——首选。
2. 下一页面**精确的标题/文案**（`getByText('Verification required', { exact: true })`）。
3. 新出现的路由（`await page.currentRoute()` 等于预期路由）。

**避免**：把"captcha 那层覆盖层消失 / 原表单不可见"当成完成条件——太宽，captcha
加载中、网络抖动都可能让覆盖层暂时消失，导致脚本过早继续。

### 生产级封装（可开关、留证据、抗抖动）

把方案 A 拆成可复用的 helper，生产脚本建议照这个结构写。它来自实战经验，三个要点：

1. **可开关** —— 用环境变量 + `flow.optional` 包住，让 captcha 在 CI 里能被显式跳过，且“跳过”也是一条 timeline 记录。
2. **截图先行** —— `flow.frame` 在 `flow.manual` 之前抓一帧，给事后排查留下“校验那一刻屏幕长什么样”的证据。
3. **抗抖动** —— `resumeWhen` 的 poller 用 try/catch `isVisible` + 短 `settleQuietly`，避免在动画帧上采样或因瞬时 locator 异常崩溃。

```typescript
// config（脚本顶部集中读取，便于 CI 覆盖）
const config = {
  handleCaptcha: process.env.SOLVE_CAPTCHA !== 'false', // 默认开启，CI 可关
  captchaManualTimeoutMs: parsePositiveInt(process.env.CAPTCHA_MANUAL_TIMEOUT_MS) ?? 180_000,
  captureScreenshots: process.env.CAPTURE_SCREENSHOTS !== 'false',
  captureSnapshots: process.env.CAPTURE_SNAPSHOTS === 'true',
  captureDiagnostics: process.env.CAPTURE_DIAGNOSTICS === 'true',
};
function parsePositiveInt(value?: string) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// 主流程里、触发 captcha 之后
await flow.optional('Handle captcha', { when: config.handleCaptcha }, async () => {
  await solveCaptcha(page, flow);
});
// 校验通过后立刻续跑下一步（填 SMS / OTP 等），写在一起最稳

async function solveCaptcha(page, flow) {
  // 先留证据：这一帧是“交给人之前”的屏幕
  await flow.frame('Captcha ready for manual handling', {
    screenshot: config.captureScreenshots,
    snapshot: config.captureSnapshots,
    diagnostics: config.captureDiagnostics,
    metadata: { manual: true, completion: 'app-state' },
  });

  // 暂停等人拖；resumeWhen 看“校验成功后才会出现的下一业务态”
  await flow.manual('Complete captcha', {
    message: '请在运行中的 app 里手动完成滑块校验，越过校验页后脚本会自动继续。',
    timeoutMs: config.captchaManualTimeoutMs,
    pollIntervalMs: 700,
    metadata: { completion: 'app-state' },
    resumeWhen: async () => captchaResolved(page),
  });

  await settleQuietly(page, { timeout: 2_000, fallbackDelay: 1_000 });
}

// resumeWhen 的判定函数：先短 settle 抗抖动，再看“下一业务态”是否可见
// 这里以“进入下一步的某个字段”为例，换成你流程的真实下一状态
async function captchaResolved(page) {
  await settleQuietly(page, { timeout: 700, stableFrames: 1, fallbackDelay: 100 });
  return isVisible(page.getByKey('myForm.nextStepField'));
}

// 容错的可见性探测：任何 locator 异常都当作“还没出现”，不要让 poller 抛错
async function isVisible(locator) {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

// settle 偶尔因 app 还在动画而超时；把它降级成一次小的兜底延迟，不破坏流程
async function settleQuietly(page, options = {}) {
  try {
    await page.settle({
      timeout: options.timeout ?? 2_500,
      stableFrames: options.stableFrames ?? 3,
      throwOnTimeout: true,
    });
  } catch {
    await delay(options.fallbackDelay ?? 300);
  }
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

要点：

- **靠 app 状态、不靠外部信号**：`completion: 'app-state'` 这个 metadata 是给 reviewer 的约定——本节点“完成”由 app 状态判定，而非人工在终端/IDE 点按钮。脚本在 CLI、CI、MCP 任意 runner 下行为一致。
- **宽超时**：真人拖滑块可能要几十秒，`captchaManualTimeoutMs` 默认 180s；窄超时会在人还没拖完时就失败。
- **CI 跳过**：CI 设 `SOLVE_CAPTCHA=false`，`flow.optional` 会留下一条“已跳过校验”的显式记录，而不是默默跳过。

## 方案 C：`slideTo` / `dragFrom` / `clickAt` 自动滑（脆弱，最后才用）

当必须无人值守、且方案 A 不可行时，可以对覆盖层按坐标操作。这些方法发的是
`ext.fliwright.click` / `ext.fliwright.dragFrom`，**绕过 Flutter 控件树**：

```typescript
// 把滑块旋钮从当前 X 拖到目标 X（actions.md）
await page.getByKey('sliderKnob').slideTo(340, { steps: 25 });

// 或对 WebView 覆盖层用绝对坐标拖动
await page.dragFrom(120, 420, 280, 0, { steps: 20 });

// 点一个不在控件树里的位置
await page.clickAt(114, 204);
```

**为什么最后才用**：坐标测试天生依赖分辨率/缩放/DPR，换设备就崩。如果非用不可：

- 坐标走环境变量（`process.env.CAPTCHA_SLIDER_X`），不改代码就能微调。
- 滑动距离/步数按真实设备实测，别套用别的项目的值。
- 配合 `flow.frame({ screenshot: true })` 留证据，便于人工核对。

## 方案 D：拆用例，不真过 captcha

当 A/B/C 都不现实（无人值守 + 后端强制验签 + 滑块起点不固定），把覆盖 captcha
的 happy path 拆成两部分，**都不触发真正的 captcha widget**：

1. **校验态断言**：停在触发 captcha 之前的步骤（如 newPassword 步），断言按钮
   enabled/disabled、错误文案、表单联动——这些不点"触发 captcha"的按钮，所以
   captcha 不弹出。
2. **mock HTTP 断言**：mock 掉 captcha 之后的业务接口，验证 app 在"拿到 token 后"
   会发出正确的请求（`mock.findCalls(...)` 断言 payload）。这里**不验证 token 本身
   怎么来的**，只验证"假设 token 有效，app 的请求对不对"。

这样能保住绝大部分回归价值，代价是放弃了"端到端真过 captcha"这一条。

## 与其它机制的配合

- **mock**：方案 A/C/D 里 mock 的都是**captcha 之后的 app 业务接口**（发验证码、
  提交密码），**不是 captcha 本身**——captcha 的 token 来自第三方 SDK，HTTP mock
  拦不到。别试图 `mock.route` 一个 "captcha 接口"。
- **state**：**不要**用 `driver.state.override` / Riverpod override 去绕 captcha（见决策树）。
  `state.*` 只用于无关 captcha 的常规状态注入（如注入登录态、计数器）。
- **flow.frame / logger**：人工拖滑块前后各留一帧截图，记 `logger.info('captcha
  passed manually')`，便于事后审阅和 AI diagnose。
- **agent**：**不要**把过校验交给 `agent.*`（包括 `agent.verify`/`agent.inspect` 去分析滑块截图）。
  AI 看得见截图但**操作不了** WebView 覆盖层里的滑块，且视觉拖拽成功率低、不可靠——这正是
  要避免的方向。过校验只能走方案 A（人工）或 C（坐标）；`agent` 只用于无关 captcha 的常规视觉断言。

## 常见症状 → 原因 → 修复

| 症状 | 原因 | 修复 |
| --- | --- | --- |
| `tap failed`，contextDump 里**没有**滑块/验证码按钮 | captcha 在 WebView/PlatformView 里，桥接看不到 | 用方案 A（人工）或方案 C（坐标），别用 `getByKey`/`getByText` |
| 人工拖完滑块脚本仍卡住 | 只"提示人操作"，没定义 `resumeWhen` | 方案 A：加 `resumeWhen` 轮询下一业务态 |
| 人工步骤过早继续 | `resumeWhen` 太宽（只判 captcha 消失） | 改成下一页面的稳定 Key/精确文案/路由 |
| 想用 `state.override` / Riverpod override 绕 captcha | override 绕不过 WebView 弹出和后端验签 | 走方案 A（人工）；无人值守则方案 D（拆用例）。**不要用 override** |
| CI 里坐标滑块时过时不过 | 分辨率/DPR 差异 | 坐标走环境变量；或改方案 A/D |

## 相关文档

- `flow.manual` / `resumeWhen` 的通用语义 → [timeline-native.md](./timeline-native.md)
- `slideTo` / `clickAt` / `dragFrom` 签名 → [actions.md](./actions.md)
- mock 业务接口（captcha 之后的请求） → [mocks.md](./mocks.md)
