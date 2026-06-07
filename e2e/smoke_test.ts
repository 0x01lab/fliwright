import { expect } from 'vitest';
import { test } from '@fliwright/vitest';

test('finds and clicks the Increment button', async ({ page }) => {
  await expect(page.locator('text=Count: 0').isVisible()).resolves.toBe(true);

  await page.locator('text=Increment').click();

  const counter1 = await page.waitFor('text=Count: 1', 3000);
  await expect(counter1.isVisible()).resolves.toBe(true);
});
