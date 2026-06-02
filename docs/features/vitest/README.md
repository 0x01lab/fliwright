---
package: "@fliwright/vitest"
version: "0.1.0"
layer: integration
status: implemented
generated: "2026-06-02"
---

# @fliwright/vitest

> Vitest integration that wraps `test()` and `expect()` with an auto-managed `FliwrightDriver` and MCP-ready failure context.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| `test` | `test()` fixture and `createFliwrightTest` factory with auto-driver lifecycle. | [test.md](./test.md) |
| `expect` | `expect()` assertion with self-healing integration and failure-context writer. | [expect.md](./expect.md) |
| `setup` | Optional `globalSetup` / `globalTeardown` / `getDriver` helpers for advanced cases. | [setup.md](./setup.md) |
| `reporter` | `FliwrightReporter` — Vitest reporter that prints screenshot paths for failed tests. | [reporter.md](./reporter.md) |

## Dependencies

- `@fliwright/core` — `workspace:*` (FliwrightDriver, Assertion, FailureCollector, createExpect)
- `vitest` — `^2.0.0`

## Usage Example

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { FliwrightReporter } from '@fliwright/vitest/reporter';

export default defineConfig({
  test: {
    globals: true,
    reporters: ['default', new FliwrightReporter()],
  },
});

// tests/counter.test.ts
import { test, expect } from '@fliwright/vitest';

test('counter increments', async ({ page }) => {
  const counter = page.locator('text=Count: 0');
  await expect(counter).toBeVisible();

  await page.locator('text=Increment').click();

  await expect(page.locator('text=Count: 1')).toBeVisible();
});
```

Run with `FLIWRIGHT_VM_URL=ws://127.0.0.1:8181/ws vitest run` — the driver connects once per process and is reused across tests. Failures automatically append rich context (screenshot, widget tree, source snippet, healing suggestion) to the path in `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH` when set.
