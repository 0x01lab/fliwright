import { test, expect } from '@fliwright/vitest';

test('counter increments when the increment button is tapped', async ({ page, logger }) => {
  logger.info('Check initial counter value');
  await expect(page.getByText('Count: 0')).toBeVisible();

  logger.info('Tap increment button');
  await page.getByText('Increment').click();

  await expect(page.getByText('Count: 1')).toBeVisible({ timeout: 3_000 });
  logger.success('Counter incremented');
});
