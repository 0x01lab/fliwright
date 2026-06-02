---
module: "expect"
package: "@fliwright/vitest"
source: "src/index.ts"
generated: "2026-06-02"
---

# `expect`

> Drop-in replacement for Vitest's `expect` that returns a `@fliwright/core` `Assertion` wired to the active test's driver for self-healing and MCP failure-context capture.

## Overview

`@fliwright/vitest` re-exports an `expect(locator)` function. Inside a `test()` body, it pulls the current `{ driver, testName }` from the `AsyncLocalStorage` store and constructs an `Assertion` that:

- Routes matcher verification through `driver.healing` so `SelfHealingEngine.tryHeal()` runs when a selector misses.
- Tags any captured failure with `testName` so `writeMcpFailureContext()` can attach the latest `HealingReport` to the MCP failure entry.
- Falls back to `createExpect(locator)` (a plain `Assertion` with no healing) when called outside a Fliwright test context.

## Signature

```typescript
import type { Locator, Assertion } from '@fliwright/core';

export function expect(locator: Locator): Assertion;
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locator` | `Locator` | Yes | The locator under assertion, e.g. `page.locator('text=Save')`. |

**Returns:** `Assertion` — Fluent chain with matchers like `.toBeVisible()`, `.toHaveText(...)`, `.toContainText(...)`, `.toBeEnabled()`, `.toBeDisabled()`, and `.not` for negation. See the [Assertion module](../core/Assertion.md) for the full matcher catalog.

## Public Methods

`expect()` itself returns an `Assertion`, so all behavior is documented in [`@fliwright/core` Assertion](../core/Assertion.md). The vitest-specific extensions happen behind the scenes:

### Healing Integration

When a matcher fails, the `Assertion` consults `driver.healing` (a `SelfHealingEngine`) with the failing selector and the snapshot store. If healing succeeds, the assertion retries with the suggested selector and the `HealingReport` is recorded against `testName`.

### Failure Context Capture

When the `test()` fixture catches a thrown error from the body, it calls the internal `writeMcpFailureContext()` helper which:

1. Resolves the MCP output path from `process.env.FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH`. If unset, returns immediately.
2. Builds an `McpFailureEntry` via `collectFailureEntry()`:
   - For `AssertionError`: invokes `new FailureCollector(...).collect(error, timeout)` to fetch the widget tree and source snippet from the running app.
   - For other errors: records `matcher: 'unknown'`, the message as `actual`, and empty widget tree.
3. Attaches the latest `HealingReport` (if any) as `healingSuggestion` with `originalSelector`, `suggestedSelector`, `confidence`, and `scores`.
4. Reads existing entries from the file, appends, and writes back atomically.

The resulting JSON file (one entry per failure) is the contract consumed by `@fliwright/mcp`'s `fliwright_get_failure` tool.

```typescript
interface McpFailureEntry {
  testName: string;
  assertion: { matcher: string; expected: unknown; actual: unknown; timeout: number };
  widgetTree: object;
  source: { file: string; line: number; snippet: string };
  healingSuggestion?: {
    originalSelector: string;
    suggestedSelector: string;
    confidence: number;
    scores: HealingReport['scores'];
  };
  timestamp: string;
}
```

## Example

```typescript
import { test, expect } from '@fliwright/vitest';

test('login flow', async ({ page }) => {
  await page.locator('text=Email').fill('leo@example.com');
  await page.locator('text=Password').fill('hunter2');
  await page.locator('text=Sign in').click();

  // Healing runs automatically if 'Welcome, Leo!' drifts.
  await expect(page.locator('text=Welcome, Leo!')).toBeVisible();

  // Negation works as expected.
  await expect(page.locator('text=Sign in')).not.toBeVisible();
});
```

When run via `fliwright run` (or with `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH` set), any failure appends an entry to that JSON file with the screenshot path, widget tree, source snippet, and healing suggestion.

## Related

- **Depends on:** [`Assertion` / `createExpect`](../core/Assertion.md), [`FailureCollector`](../core/FailureCollector.md), [`SelfHealingEngine`](../core/SelfHealingEngine.md) via the active `FliwrightDriver`
- **Used by:** Every Fliwright test file
- **Companion modules:** [test.md](./test.md) (provides the AsyncLocalStorage context), [reporter.md](./reporter.md) (prints screenshot paths in the Vitest report)
- **Source:** `packages/fliwright-vitest/src/index.ts` (the `expect` export and the private `writeMcpFailureContext` / `collectFailureEntry` / `appendFailureEntry` helpers)
