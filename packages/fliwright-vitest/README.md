# @fliwright/vitest

Vitest fixtures for Fliwright Flutter E2E tests.

```ts
import { expect, test } from '@fliwright/vitest';

test('increments the counter', async ({ page }) => {
  await page.locator('text=Increment').click();
  await expect(page.locator('text=Count: 1')).toBeVisible();
});
```

Use `fliwright init` to create compatible configuration and a test-only Flutter
entrypoint. The current supported Vitest version is 4.1.11.
