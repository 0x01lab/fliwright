import { createFliwrightTest, defineConfig, expect } from '@fliwright/vitest';

const test = createFliwrightTest(defineConfig({
  vmServiceUrl: process.env.FLIWRIGHT_VM_URL ?? '',
  timeout: 10_000,
  screenshot: 'file',
  log: {
    level: 'info',
    outputs: ['jsonl-file'],
  },
}));

test('user can sign in', async ({ page, logger }) => {
  logger.info('Fill login credentials');
  await page.getByKey('emailField').fill('alice@example.com');
  await page.getByKey('passwordField').fill('correct-horse-battery-staple');

  logger.info('Submit login form');
  await page.getBySemantics({ label: 'Sign in', role: 'button' }).click();

  await expect(page.getByText('Welcome, Alice')).toBeVisible();
  logger.success('User signed in');
});
