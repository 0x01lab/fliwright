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
