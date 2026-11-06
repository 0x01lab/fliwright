# 基础测试模板

先选最接近的一种用例结构，再根据真实目标补齐前置状态、操作和断言。每个 Flutter 用例模板都在脚本内显式声明生命周期 hooks；复制其中一个模板即可，不要在同一文件重复注册 hooks。

| 需求 | 模板 |
| --- | --- |
| 每条 Flutter 用例前回首页，结束后清除全部 HTTP Mock 路由 | [脚本内生命周期](#脚本内生命周期) |
| 一个前置状态、一种行为 | [单条业务用例](#单条业务用例) |
| 相同场景和行为，多个输入，需要 fixtures | [test.for 参数化](#testfor-参数化) |
| 普通数据逻辑，沿用位置参数风格 | [test.each 参数化](#testeach-参数化) |
| 共用操作，但前置状态不同 | [不同 scenario](#不同-scenario) |
| 提交行为需要同时验证 UI 和请求 | [提交与请求验证](#提交与请求验证) |

## 套用前

- Flutter 测试放 `.fliwright/tests/*.test.ts`，从项目 support 导入扩展了 fixtures 的 `test` 和 Fliwright `expect`，相对导入使用 `.js`。下面以 Exio 的 `../support/exio-test.js`、`exio` fixture 和已实现的 `exio.openHome()` 为例；其他 App 使用其实际 support、fixture 和回首页方法。
- 场景名、Key、路由、接口和数据均为示例。确认并替换为真实契约；场景须已在项目配置中注册，包含必要的 Mock、认证和入口状态。配置方式见 [scenarios.md](./scenarios.md)，不要靠复制名称假设环境存在。
- 保留“前置状态 → 用户操作 → 可见结果 → 必要请求事实”的结构；不要求给每行增加注释。需要命名业务步骤时使用 `flow.step`，不把所有调用机械包装为步骤。
- 同一个 Flutter app 串行执行。版本、API 签名和收集要求见 [vitest-authoring.md](./vitest-authoring.md)。

## 脚本内生命周期

在每个 `.fliwright/tests/*.test.ts` 文件中显式写出 `beforeEach` 和 `afterEach`。support 提供项目 fixtures、业务方法与断言，不通过导入自动导航或注册这些 hooks。回首页的实现留在 support，调用显式写在测试脚本中；下面的业务模板已包含这两个 hooks。

```typescript
import { test } from '../support/exio-test.js';

test.beforeEach(async ({ exio }) => {
  await exio.openHome();
});

test.afterEach(async ({ driver, flow }) => {
  await flow.step('清除全部 App HTTP Mock 路由', async () => {
    await driver.mock.clearFlutterRoutes();
  });
});

```

写 hooks 前，先检查目标项目 `.fliwright/support/` 中回首页方法的实际实现与调用方，确认它适用于当前认证状态和入口。Exio 的 `ExioRuntime.openHome()` 会使用配置中的 `homeRoute`，尝试 `resetToHome`、关闭业务提示，并通过 `avatarButton` 检查已登录首页；需要时回退到 `goto`。不要用 onboarding 专用的 `returnHome()` 替代通用重置。其他 App 按实际封装替换，不能仅凭方法名复用，也不能假设首页一定是 `/home`。

项目已有适用封装时直接调用，不在脚本中重写 `page.goto(homeRoute)`。缺少封装时，在项目 support 中基于真实路由、弹层处理与就绪条件补充一个明确的方法；调用仍写在每个脚本的 `beforeEach` 中。访客或启动专用用例需要适合其状态的回首页实现，不能使用要求已登录的 helper。

场景先准备认证、Mock 等数据，hooks 调用项目方法回首页，用例随后点击入口或导航到目标页。场景的 ready 条件不得依赖只有测试体才会触发的目标页面状态；能调整的导航基线优先统一为项目首页。

`afterEach` 在用例成功或失败后执行，每次重试也重新执行文件内的 hooks。清理失败应让该 attempt 失败，不捕获后忽略。连接或 fixture 本身不可用时无法保证清理完成，须报告失败。

这里的“全部”是当前 App HTTP Mock store 中的全部活动路由，包括 VS Code 应用的路由；`clearFlutterRoutes()` 同时清理工具侧镜像，不删除磁盘上的 Mock JSON 或场景定义。下一条用例重新应用自身场景。不要换成 `mock.clearRoutes()`，它会保留编辑器路由；也不把 `clearCalls()` 当作规则清理。WebSocket Mock 属于另一套能力，涉及它时另行清理。

需要恢复语言等临时状态时，在清除规则之前完成相关恢复，例如在本文件 `afterEach` 的 `try/finally` 中最后清理 Mock。不要在清理规则后的 cleanup 中执行依赖这些规则的页面操作。`onTestFinished` 不适合访问已释放的 driver/page；细节见 [hooks 规范](./vitest-authoring.md#hooks清理与隔离)。

## 单条业务用例

用于默认的“一个测试验证一个行为”。示例场景在首页建立已登录基线，保留打开账户页这个被测动作。

```typescript
import { test, expect } from '../support/exio-test.js';

test.beforeEach(async ({ exio }) => {
  await exio.openHome();
});

test.afterEach(async ({ driver, flow }) => {
  await flow.step('清除全部 App HTTP Mock 路由', async () => {
    await driver.mock.clearFlutterRoutes();
  });
});

test.scenario('home.logged-in')(
  '[ACCOUNT-001] 点击账户入口后显示当前用户资料',
  async ({ page }) => {
    await expect(page.getByKey('home.accountButton'), '账户入口可见').toBeVisible();

    await page.getByKey('home.accountButton').click();

    await expect(page.getByKey('account.profile'), '用户资料可见').toBeVisible();
    await expect(
      page.getByKey('account.profile').getByText('Demo User', { exact: true }),
      '显示场景中的当前用户',
    ).toBeVisible();
  },
);
```

容器没有 own text 时定位其实际文字后代；不要直接对 wrapper 使用 `toHaveText`，也不要拼接整棵子树。

## test.for 参数化

相同场景、相同断言、不同输入，优先使用此模板。每行独立准备场景、执行、重试和报告。

```typescript
import { test, expect } from '../support/exio-test.js';

test.beforeEach(async ({ exio }) => {
  await exio.openHome();
});

test.afterEach(async ({ driver, flow }) => {
  await flow.step('清除全部 App HTTP Mock 路由', async () => {
    await driver.mock.clearFlutterRoutes();
  });
});

test.scenario('home.logged-in').for([
  { id: 'NAV-001', entryKey: 'home.assetsButton', targetKey: 'assets.page' },
  { id: 'NAV-002', entryKey: 'home.accountButton', targetKey: 'account.profile' },
] as const)('[$id] $entryKey 打开对应页面', async ({ entryKey, targetKey }, { page }) => {
  await page.getByKey(entryKey).click();

  await expect(page.getByKey(targetKey), '目标页面可见').toBeVisible();
});
```

第一参数是完整数据行，第二参数是 fixtures。用字面量表格与 `$property` / `%s` 等标准标题，不使用顶层 `for` 拼接测试。若已有计划绑定，保持其完整名称，或同步更新绑定。

## test.each 参数化

适合普通数据逻辑的单元测试。本例使用原生 Vitest，不连接 Flutter；应放进项目单元测试目录，而非作为 Flutter E2E。实际使用时导入待测的真实函数，避免只测模板里的恒等关系。

```typescript
import { test, expect } from 'vitest';

// 示例被测函数；在项目中替换为真实业务函数的 import。
function normalizeMessage(input: string): string {
  return input.trim();
}

test.each([
  ['前后空格', '  hello  ', 'hello'],
  ['全为空格', '   ', ''],
] as const)('%s：消息正文归一化', (_label, input, expected) => {
  expect(normalizeMessage(input)).toBe(expected);
});
```

`each` 将数组行展开为位置参数。本例第二参数是 `input`，不是 `{ page }`；需要 Flutter fixtures 时优先使用上面的 `test.for`。

## 不同 scenario

成功和空数据等不同前置条件分别显式声明。共用 helper 接收业务参数，不在 helper 或循环中隐藏测试注册。

```typescript
import { test, expect } from '../support/exio-test.js';
import type { Page } from '@fliwright/core';

test.beforeEach(async ({ exio }) => {
  await exio.openHome();
});

test.afterEach(async ({ driver, flow }) => {
  await flow.step('清除全部 App HTTP Mock 路由', async () => {
    await driver.mock.clearFlutterRoutes();
  });
});

async function openAssets(page: Page): Promise<void> {
  await page.getByKey('home.assetsButton').click();
  await expect(page.getByKey('assets.page'), '资产页面可见').toBeVisible();
}

test.scenario('home.assets-funded')('[ASSETS-001] 有余额时显示资产列表', async ({ page }) => {
  await openAssets(page);

  await expect(page.getByKey('assets.balanceList'), '余额列表可见').toBeVisible();
  await expect(page.getByKey('assets.emptyState'), '不显示空状态').not.toBeVisible();
});

test.scenario('home.assets-empty')('[ASSETS-002] 无余额时显示空状态', async ({ page }) => {
  await openAssets(page);

  await expect(page.getByKey('assets.emptyState'), '空状态可见').toBeVisible();
  await expect(page.getByKey('assets.balanceList'), '不显示旧余额').not.toBeVisible();
});
```

两个场景都从首页开始，区别是资产响应。不能在 `.for(rows)` 的外层使用尚不存在的 `row.scenario`；不能进入测试体后才补做场景准备。

## 提交与请求验证

场景准备首页基线与成功响应，测试体从首页进入表单，不预先注入提交后的最终状态。示例契约为 `POST /api/preferences`，请求体是 `{ displayName: string }`；先沿真实接口与解析逻辑核对再替换。

```typescript
import { test, expect } from '../support/exio-test.js';
import { expect as valueExpect } from 'vitest';

test.beforeEach(async ({ exio }) => {
  await exio.openHome();
});

test.afterEach(async ({ driver, flow }) => {
  await flow.step('清除全部 App HTTP Mock 路由', async () => {
    await driver.mock.clearFlutterRoutes();
  });
});

test.scenario('preferences.save-success')(
  '[SETTINGS-001] 保存后显示新名称且只提交一次',
  async ({ page, mock }) => {
    await page.goto('/settings/preferences');
    await expect(page.getByKey('preferences.nameInput'), '设置表单可见').toBeVisible();
    await page.getByKey('preferences.nameInput').fill('Demo User');
    await page.dismissKeyboard();
    await mock.clearCalls();

    await page.getByKey('preferences.saveButton').click();

    // 此结果必须在响应处理完成后出现，不能只是提交前已存在的页面。
    await expect(page.getByKey('preferences.savedBanner'), '保存完成').toBeVisible();
    await expect(page.getByKey('preferences.savedName'), '显示新名称').toHaveText('Demo User');
    await page.waitForNetworkIdle({ quietMs: 500, timeout: 10_000 });

    const requests = await mock.findCalls({ method: 'POST', path: '/api/preferences' });
    valueExpect(requests.length, '本次操作只提交一次').toBe(1);

    // 仅适用于已经确认记录为 JSON 的接口；不是通用 Dart Map 文本解析器。
    const raw = requests[0].body;
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
    valueExpect(body).toMatchObject({ displayName: 'Demo User' });
  },
);
```

`preferences.savedName` 必须定位实际 text 控件；若 Key 在容器上，改为定位它的文字后代。请求体不是可靠 JSON 时使用项目已验证的合同解析器，不用正则猜测。敏感字段不要输出整个请求体。

调用静默只是结果完成后的补充观察窗口；有排队或重试任务时还需等待其完成信号，不能据此证明未来永远没有重复请求。当前操作、记录窗口和次数验证的边界见 [请求断言](./assertions.md#请求断言)。

套用后按 [收集与交付](./vitest-authoring.md#用例收集与交付)检查名称、数量、类型和真实运行结果；模板能够通过类型检查不代表目标业务已验证。
