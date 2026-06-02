---
package: "@fliwright/vitest"
version: "0.1.0"
layer: integration
status: implemented
generated: "2026-06-02"
---

# @fliwright/vitest

> Vitest integration providing `test()` fixture and `expect()` assertion with auto-healing and failure context writing.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| `test` | Vitest test fixture with auto-managed FliwrightDriver | [test.md](./test.md) |
| `expect` | Assertion with healing integration and MCP failure context | [expect.md](./expect.md) |

## Dependencies

- `@fliwright/core` workspace:* — core SDK
- `vitest` ^2.0.0 — test framework

## Usage Example

```typescript
import { test, expect } from '@fliwright/vitest';

test('login flow', async ({ page }) => {
  await page.locator({ text: 'Email' }).fill('user@example.com');
  await page.locator({ text: 'Password' }).fill('secret123');
  await page.locator({ text: 'Login' }).click();

  await expect(page.locator('text=Welcome')).toBeVisible();
});
```
