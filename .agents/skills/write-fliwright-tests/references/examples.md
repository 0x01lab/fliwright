# 示例

可直接复制、带注释的完整测试脚本。每个都改编自 `e2e/` 或
`.agents/skills/write-fliwright-tests/examples/` 下的真实文件。套用时请去掉解释性注释。

## 1. Timeline-native 注册流程（新版推荐）

新测试默认用 `{ flow, mock, agent }` 和 `expect(locator, title?)`。每个关键动作和 locator 断言都会进入 `timeline.json`。

```typescript
import { test, expect } from '@fliwright/vitest';
import { expect as viExpect } from 'vitest';

test('register flow succeeds', async ({ page, flow, mock }) => {
  await mock.rules('Use successful registration API', async () => {
    await mock.clearRoutes();
    await mock.clearCalls();
    await mock.route('/api/register', {
      method: 'POST',
      status: 200,
      body: { success: true, message: '注册成功' },
    });
  });

  await flow.page('Open register page', { route: '/register' }, async () => {
    await page.navigate('/register');
    await expect(page.getByText('请输入手机号'), 'Phone field is visible').toBeVisible();
  });

  await flow.step('Fill registration form', async () => {
    await page.formHelper.fill({ skipObscureFields: false });
  });

  await flow.step('Submit registration form', async () => {
    await page.getByText('提交').click();
  });

  await expect(page.getByText('注册成功'), 'Registration succeeded').toBeVisible();
  const calls = await mock.findCalls({ method: 'POST', path: '/api/register' });
  viExpect(calls.length).toBeGreaterThanOrEqual(1);
});
```

## 2. 自动化脚本（`script`）

适合一次性数据录入、账号注册、录制产物清理。`script` 会写 timeline，但不强制要求断言。

```typescript
import { script } from '@fliwright/vitest';

script('fill registration form', async ({ page, flow, agent }) => {
  await flow.page('Open register page', { route: '/register' }, async () => {
    await page.navigate('/register');
  });

  const user = await agent.generate<{ phone: string; password: string }>('Generate registration data', {
    fallback: { phone: '13800138000', password: 'Passw0rd!' },
  });

  await flow.step('Fill phone', async () => {
    await page.getByText('请输入手机号').fill(user.phone);
  });

  await flow.step('Fill password', async () => {
    await page.getByKey('passwordField').fill(user.password);
  });

  await flow.frame('Registration form filled', { screenshot: true, snapshot: true });
});
```

## 3. 最小计数器（默认 fixture）

标准的 `@fliwright/vitest` fixture —— 共享 driver、自带自动等待断言。改编自
`examples/basic-counter.test.ts`。

```typescript
import { test, expect } from '@fliwright/vitest';

test('counter increments when the increment button is tapped', async ({ page }) => {
  await expect(page.getByText('Count: 0')).toBeVisible();
  await page.getByText('Increment').click();
  await expect(page.getByText('Count: 1')).toBeVisible({ timeout: 3_000 });
});
```

## 4. 自定义配置登录（显式超时 + 截图模式）

改编自 `examples/custom-config-login.test.ts`。当某个文件需要显式处理 VM URL 时使用。

```typescript
import { createFliwrightTest, defineConfig, expect } from '@fliwright/vitest';

const test = createFliwrightTest(defineConfig({
  vmServiceUrl: process.env.FLIWRIGHT_VM_URL ?? '',
  timeout: 10_000,
  screenshot: 'file',
}));

test('user can sign in', async ({ page }) => {
  await page.getByKey('emailField').fill('alice@example.com');
  await page.getByKey('passwordField').fill('correct-horse-battery-staple');
  await page.getBySemantics({ label: 'Sign in', role: 'button' }).click();
  await expect(page.getByText('Welcome, Alice')).toBeVisible();
});
```

## 5. Mock + 表单 + 提交 + 断言请求（timeline `mock`）

改编自 `e2e/form-mock-e2e.test.ts`。这是典型的“完整 E2E”形态：mock 一个 API，通过 UI 填表单，
提交，再断言**可见结果**和**被拦截到的请求**。

```typescript
import { test, expect } from '@fliwright/vitest';
import { expect as viExpect } from 'vitest';

const hasVmUrl = Boolean(process.env.FLIWRIGHT_VM_URL ?? process.env.FLIWRIGHT_VM_SERVICE_URL);
const liveTest = test.skipIf(!hasVmUrl);   // skip cleanly in CI without a VM

liveTest('register flow: mock → fill → submit → verify request', async ({ page, flow, mock }) => {
  // 1. Mock the API before interacting
  await mock.rules('Use register success API', async () => {
    await mock.clearRoutes();
    await mock.clearCalls();
    await mock.route('/api/register', {
      method: 'POST',
      status: 200,
      body: { success: true, message: '注册成功', userId: 42 },
    });
  });

  // 2. Fill the form via the UI
  await flow.step('Fill form', async () => {
    await page.formHelper.fill({ skipObscureFields: false });
  });

  // 3. Submit
  await flow.step('Submit', async () => {
    await page.locator({ text: '提交' }).click();
  });

  // 4. Assert the visible outcome (response came from our mock)
  const success = await page.waitFor('text=注册成功', 5000);
  await expect(success, 'Registration success is visible').toBeVisible();

  // 5. Assert the app actually sent the request, with the right body
  const calls = await mock.findCalls({ method: 'POST', path: '/api/register' });
  viExpect(calls.length).toBeGreaterThanOrEqual(1);
  const body = typeof calls.at(-1)!.body === 'string'
    ? JSON.parse(calls.at(-1)!.body as string)
    : calls.at(-1)!.body;
  viExpect(body.phone).toMatch(/^1[3-9]\d{9}$/);
});
```

## 6. 跨路由导航（go_router）

改编自 `e2e/go-router-navigation-e2e.test.ts`。要求应用把它的 router 传给
`FliwrightBridge.init(router: …)`。

```typescript
import { expect } from 'vitest';
import { test, beforeEach } from '@fliwright/vitest';

beforeEach(async ({ page }) => {
  await page.navigate('/');      // known starting route
});

test('navigates between routes', async ({ page }) => {
  await page.navigate('/register');
  await page.waitFor('text=请输入手机号', 5000);

  await page.navigate('/profile/edit');
  await page.waitFor('text=输入昵称', 5000);

  await page.goBack();
  expect(await page.currentRoute()).toContain('register');
});
```

## 7. 表单分析 + 定向填充

改编自 `e2e/form-fill-e2e.test.ts`。用 `analyze()` 检视，用 `fillFields()` 针对性地填一部分字段，
再按语义类型断言。

```typescript
import { expect } from 'vitest';
import { test } from '@fliwright/vitest';

test('analyzes and selectively fills a form', async ({ page }) => {
  const analysis = await page.formHelper.analyze();
  expect(analysis.fields.length).toBeGreaterThanOrEqual(6);

  // Match precisely by selector to avoid hintText substring collisions
  const phone = analysis.fields.find(f => f.selector === 'text=请输入手机号');
  expect(phone?.semanticType).toBe('phone');
  expect(phone?.generatedValue).toMatch(/^1[3-9]\d{9}$/);

  const result = await page.formHelper.fillFields(['手机号', '验证码'], { skipObscureFields: true });
  expect(result.fields.find(f => f.semanticType === 'phone')?.status).toBe('filled');
  expect(result.fields.find(f => f.semanticType === 'email')?.status).toBe('skipped');
});
```

## 8. 传输层 Mock API

改编自 `e2e/mock-api-e2e.test.ts`。通过测试扩展用应用的 `HttpClient` 发出一次请求，再检查记录到的
调用，从而验证 `HttpOverrides` 代理本身。

```typescript
import { describe, expect } from 'vitest';
import { test } from '@fliwright/vitest';

const hasVmUrl = Boolean(process.env.FLIWRIGHT_VM_URL);
const liveTest = test.skipIf(!hasVmUrl);

describe('Mock API E2E', () => {
  liveTest('registers a route and intercepts a request', async ({ driver }) => {
    await driver.mock.clear();
    await driver.mock.clearCalls();
    await driver.mock.route('/api/ping', { method: 'GET', status: 200, body: { message: 'pong' } });

    const result = await driver.sendRequest('ext.fliwright.mock.testRequest',
      { url: 'http://test.local/api/ping', method: 'GET' }) as { status?: number; body?: string };
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body!).message).toBe('pong');

    const calls = await driver.mock.getCalls('/api/ping');
    expect(calls.at(-1)!.method).toBe('GET');
  });

  liveTest('returns 404 for unmatched route', async ({ driver }) => {
    await driver.mock.clear();
    const result = await driver.sendRequest('ext.fliwright.mock.testRequest',
      { url: 'http://test.local/api/missing', method: 'GET' }) as { status?: number };
    expect(result.status).toBe(404);
  });
});
```

## 9. 旧版 / 原始 driver（较老的 bridge）

适用于暂时无法升级 bridge 的目标。注意其中的
`skipIf`、WS URL 转换、原始的 `sendRequest` 扩展调用，以及可由环境变量覆盖的坐标。

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FliwrightDriver, type FormFieldMeta } from '@fliwright/core';

const vmServiceUrl = process.env.APP_VM_SERVICE_URL ?? process.env.FLIWRIGHT_VM_SERVICE_URL;

describe.skipIf(!vmServiceUrl)('App live E2E (legacy bridge)', () => {
  let driver: FliwrightDriver;

  beforeAll(async () => {
    driver = new FliwrightDriver();
    await driver.connect(toWsUrl(vmServiceUrl!));
  });
  afterAll(async () => { await driver?.dispose(); });

  it('opens login and fills credentials', async () => {
    const { fields = [] } = await driver.sendRequest('ext.fliwright.extractForm') as { fields?: FormFieldMeta[] };
    const email = fields.find(f => f.semanticsId === 'login.email')!;
    await driver.sendRequest('ext.fliwright.type',
      { selector: email.selector, text: 'test@example.com', replaceAll: 'true' });
    // … click submit via coordinates (legacy) …
  });
});

function toWsUrl(url: string): string {
  const c = url.replace('http://', 'ws://').replace('https://', 'wss://');
  return c.endsWith('/ws') ? c : c.replace(/\/?$/, '/ws');
}
```

> 待应用升级后，请尽快把旧版脚本迁到当前 bridge（`ext.fliwright.snap` / `ext.fliwright.action` /
> `ext.fliwright.extractForm`）。详见 [driver-lifecycle.md](./driver-lifecycle.md)。

## 10. 人机校验（captcha / 滑块）+ 2FA 在主流程里的接入位置

滑块这类人机校验无法被自动化稳定驱动，正确做法是**交由真人在运行中的 app 完成，脚本靠
“校验之后的 app 状态”判定通过并续跑**。完整原理、决策树（人工拖 / 坐标 / 拆用例）、
`solveCaptcha` / `captchaResolved` 的完整实现、抗抖动 helper（`isVisible` / `settleQuietly`）、
设计要点和症状表，全部见 **[captcha.md](./captcha.md)**——那是这一主题的唯一权威版本，本节不再重复。

这里只给最顶层的骨架，展示人机校验在主流程里的**接入位置**（在 `flow.optional` 里、紧跟在提交之后、
2FA 之前）。生产级的一次性脚本推荐用 `createFliwrightScript(defineConfig(...))` 的配置形式：从 env 里
解析 VM URL（`FLIWRIGHT_VM_URL` → `FLIWRIGHT_VM_SERVICE_URL` → workspace config）、配置 AI provider 与
截图模式——这些都是真人介入脚本在 CI/本地都跑得稳的前提：

```typescript
import { createFliwrightScript, defineConfig, expect } from '@fliwright/vitest';
import { readWorkspaceConfigSync } from '@fliwright/core';

const config = {
  // 人机校验天然依赖真人，CI 跑不动时设 SOLVE_CAPTCHA=false 跳过
  handleCaptcha: process.env.SOLVE_CAPTCHA !== 'false',
  vmServiceUrl: resolveVmServiceUrl(), // 见下方定义
};

const script = createFliwrightScript(defineConfig({
  vmServiceUrl: config.vmServiceUrl,
  timeout: 10_000,
  screenshot: 'file',
  ai: { provider: process.env.FLIWRIGHT_AI_PROVIDER ?? 'mock' },
}));

script('register with captcha', async ({ page, flow }) => {
  // …打开注册表单、填好字段、点 Next 之后……

  await flow.optional('Handle captcha', { when: config.handleCaptcha }, async () => {
    await solveCaptcha(page, flow);   // 完整实现见 captcha.md「生产级封装」一节
  });
  // 校验通过后立刻续跑下一步（填 SMS / OTP），写在一起最稳
});

// VM URL 解析顺序与 Fliwright runtime 一致：显式 env 优先，回退到 VS Code 插件 / flutter run
// 写入的 workspace config（.fliwright/config.json）。没有这个回退，不带 --vm-url / env 直接跑会报
// "No VM Service URL provided"。
function resolveVmServiceUrl() {
  return process.env.FLIWRIGHT_VM_URL?.trim()
    || process.env.FLIWRIGHT_VM_SERVICE_URL?.trim()
    || readWorkspaceConfigSync().vmServiceUrl
    || '';
}
```

> 若只是想本地快速验证人机校验这一段、不需要 env/CI 脚手架，也可以用默认的 `script(...)` fixture
> （见本文件 §2）。但生产用的一次性注册脚本推荐走 `createFliwrightScript(defineConfig(...))`，
> 把 VM URL 解析、AI provider、截图模式交给配置而非写死。

要点（详见 [captcha.md](./captcha.md)）：用 `flow.optional` 让“跳过”也是一条 timeline 记录；`flow.manual` 的 `resumeWhen` 检查**校验之后的目的地**（如进入验证码步的 SMS 字段、成功后的标题）而非滑块弹层消失；poller 里用 try/catch `isVisible` + 短 `settleQuietly` 抗抖动。

## 如何运行上述任一脚本

```bash
# Via the CLI (full report + screenshots + reproduce command)
fliwright run --test path/to/example.test.ts \
  --vm-url "ws://127.0.0.1:54321/abc=/ws" --reporter ai-json

# Quick smoke (no report)
FLIWRIGHT_VM_URL="ws://127.0.0.1:54321/abc=/ws" pnpm vitest run path/to/example.test.ts
```

详见 [getting-started.md](./getting-started.md) 与 [cli.md](./cli.md)。
