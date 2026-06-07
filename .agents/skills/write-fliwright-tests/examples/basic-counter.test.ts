import { test, expect } from '@fliwright/vitest';

test('counter increments when the increment button is tapped', async ({ page }) => {
  await expect(page.getByText('Count: 0')).toBeVisible();

  await page.getByText('Increment').click();

  await expect(page.getByText('Count: 1')).toBeVisible({ timeout: 3_000 });
});
