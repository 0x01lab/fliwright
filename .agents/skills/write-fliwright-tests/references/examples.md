# Examples

Copyable, commented full test scripts. Each is adapted from a real file in `e2e/` or
`.agents/skills/write-fliwright-tests/examples/`. Strip the explanatory comments when you adapt.

## 1. Minimal counter (default fixture)

Standard `@fliwright/vitest` fixture — shared driver, auto-wait assertions. Adapted from
`examples/basic-counter.test.ts`.

```typescript
import { test, expect } from '@fliwright/vitest';

test('counter increments when the increment button is tapped', async ({ page }) => {
  await expect(page.getByText('Count: 0')).toBeVisible();
  await page.getByText('Increment').click();
  await expect(page.getByText('Count: 1')).toBeVisible({ timeout: 3_000 });
});
```

## 2. Custom config login (explicit timeout + screenshot mode)

Adapted from `examples/custom-config-login.test.ts`. Use when a file needs explicit VM URL handling.

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

## 3. Mock + form + submit + assert request (fixture `driver`)

Adapted from `e2e/form-mock-e2e.test.ts`. The canonical "full E2E" shape: mock an API, fill a form
through the UI, submit, assert the visible result **and** the intercepted request.

```typescript
import { expect } from 'vitest';
import { test } from '@fliwright/vitest';

const hasVmUrl = Boolean(process.env.FLIWRIGHT_VM_URL ?? process.env.FLIWRIGHT_VM_SERVICE_URL);
const liveTest = test.skipIf(!hasVmUrl);   // skip cleanly in CI without a VM

liveTest('register flow: mock → fill → submit → verify request', async ({ page, driver }) => {
  // 1. Mock the API before interacting
  await driver.mock.clear();
  await driver.mock.clearCalls();
  await driver.mock.route('/api/register', {
    method: 'POST',
    status: 200,
    body: { success: true, message: '注册成功', userId: 42 },
  });

  // 2. Fill the form via the UI
  await page.formHelper.fill({ skipObscureFields: false });

  // 3. Submit
  await page.locator({ text: '提交' }).click();

  // 4. Assert the visible outcome (response came from our mock)
  await expect(page.waitFor('text=注册成功', 5000)).toBeVisible();

  // 5. Assert the app actually sent the request, with the right body
  const calls = await driver.mock.getCalls('/api/register');
  expect(calls.length).toBeGreaterThanOrEqual(1);
  const body = typeof calls.at(-1)!.body === 'string'
    ? JSON.parse(calls.at(-1)!.body as string)
    : calls.at(-1)!.body;
  expect(body.phone).toMatch(/^1[3-9]\d{9}$/);
});
```

## 4. Navigation across routes (go_router)

Adapted from `e2e/go-router-navigation-e2e.test.ts`. Requires the app to pass its router to
`FliwrightBridge.init(router: …)`.

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

## 5. Form analysis + targeted fill

Adapted from `e2e/form-fill-e2e.test.ts`. Use `analyze()` to inspect, `fillFields()` to target a
subset, then assert on semantic types.

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

## 6. Mock API at the transport level

Adapted from `e2e/mock-api-e2e.test.ts`. Verifies the `HttpOverrides` proxy itself by firing a
request through the app's `HttpClient` via the test extension, then checking the recorded call.

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

## 7. Legacy / raw-driver (older bridge)

Adapted from `e2e/exio-app-e2e.test.ts`. Only for targets that can't yet upgrade the bridge. Note
the `skipIf`, the WS conversion, raw `sendRequest` extensions, and environment-overridable
coordinates.

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FliwrightDriver, type FormFieldMeta } from '@fliwright/core';

const vmServiceUrl = process.env.EXIO_VM_SERVICE_URL ?? process.env.FLIWRIGHT_VM_SERVICE_URL;

describe.skipIf(!vmServiceUrl)('Exio app live E2E (legacy bridge)', () => {
  let driver: FliwrightDriver;

  beforeAll(async () => {
    driver = new FliwrightDriver();
    await driver.connect(toWsUrl(vmServiceUrl!));
  });
  afterAll(async () => { await driver?.dispose(); });

  it('opens login and fills credentials', async () => {
    const { fields = [] } = await driver.sendRequest('ext.fliwright.extractForm') as { fields?: FormFieldMeta[] };
    const username = fields.find(f => f.semanticsId === 'login.username')!;
    await driver.sendRequest('ext.fliwright.type',
      { selector: username.selector, text: 'test@example.com', replaceAll: 'true' });
    // … click submit via coordinates (legacy) …
  });
});

function toWsUrl(url: string): string {
  const c = url.replace('http://', 'ws://').replace('https://', 'wss://');
  return c.endsWith('/ws') ? c : c.replace(/\/?$/, '/ws');
}
```

> Migrate legacy scripts to the current bridge (`ext.fliwright.snap` / `ext.fliwright.action` /
> `ext.fliwright.extractForm`) as soon as the app upgrades. See [driver-lifecycle.md](./driver-lifecycle.md).

## How to run any of these

```bash
# Via the CLI (full report + screenshots + reproduce command)
fliwright run --test path/to/example.test.ts \
  --vm-url "ws://127.0.0.1:54321/abc=/ws" --reporter ai-json

# Quick smoke (no report)
FLIWRIGHT_VM_URL="ws://127.0.0.1:54321/abc=/ws" pnpm vitest run path/to/example.test.ts
```

See [getting-started.md](./getting-started.md) and [cli.md](./cli.md).
