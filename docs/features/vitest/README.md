---
package: "@fliwright/vitest"
version: "0.1.0"
layer: integration
status: implemented
generated: "2026-06-01"
---

# @fliwright/vitest

> Vitest integration layer providing test fixtures, assertion factory, and auto-driver lifecycle management.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| `test` | Vitest test fixture with auto-managed driver | [test.md](./test.md) |
| `expect` | Assertion factory with healing + failure context | [expect.md](./expect.md) |

## Dependencies

- `@fliwright/core` — workspace:*
- `vitest` — ^2.0.0

## Usage Example

```typescript
import { test, expect } from '@fliwright/vitest';

test('login flow', async ({ page }) => {
  const email = page.locator({ text: 'Email' });
  await email.type('user@example.com');

  const submit = page.locator({ text: 'Login' });
  await submit.click();

  await expect(page.locator({ text: 'Welcome' })).toBeVisible();
});
```
