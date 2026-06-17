import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';
import { test } from '@fliwright/vitest';

const hasVmUrl = Boolean(process.env.FLIWRIGHT_VM_URL ?? process.env.FLIWRIGHT_VM_SERVICE_URL);
const liveTest = test.skipIf(!hasVmUrl);

liveTest('loads active mock rules, fills the form, and verifies the submit request', async ({ driver, page }) => {
  await driver.mock.clearFlutterRoutes();
  await driver.mock.clearCalls();

  await driver.mock.loadRules(findMockDir());
  await driver.mock.switchRule('/api/register', 'success', 'POST');

  expect(driver.mock.listRules()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        endpoint: '/api/register',
        method: 'POST',
        activeRule: 'success',
      }),
    ]),
  );
  expect(await driver.mock.listRoutes()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ method: 'POST', path: '/api/register' }),
    ]),
  );

  const analysis = await page.formHelper.analyze();
  expect(analysis.fields.length).toBeGreaterThanOrEqual(6);
  expect(analysis.fields.find((field) => field.semanticType === 'phone')?.generatedValue).toMatch(/^1[3-9]\d{9}$/);
  expect(analysis.fields.find((field) => field.semanticType === 'email')?.generatedValue).toContain('@');

  const fill = await page.formHelper.fill({ skipObscureFields: false });
  expect(fill.errors).toHaveLength(0);
  expect(fill.filled).toBeGreaterThanOrEqual(6);
  expect(fill.skipped).toBe(0);

  await page.locator({ text: '提交' }).click();

  const success = await page.waitFor('text=注册成功', 5000);
  expect(await success.isVisible()).toBe(true);

  const calls = await driver.mock.getCalls('/api/register');
  expect(calls.length).toBeGreaterThanOrEqual(1);

  const lastCall = calls[calls.length - 1];
  expect(lastCall.method).toBe('POST');
  expect(lastCall.path).toBe('/api/register');

  const body = typeof lastCall.body === 'string' ? JSON.parse(lastCall.body) : lastCall.body;
  expect(body.phone).toMatch(/^1[3-9]\d{9}$/);
  expect(body.email).toContain('@');
  expect(body.name).toBeDefined();
});

function findMockDir(start = process.cwd()): string {
  let dir = start;
  while (true) {
    const candidate = join(dir, '.fliwright', 'mocks');
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) return '.fliwright/mocks';
    dir = parent;
  }
}
