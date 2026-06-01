---
module: "expect"
package: "@fliwright/vitest"
source: "src/index.ts"
generated: "2026-06-01"
---

# expect

> Assertion factory that enables self-healing and failure context capture.

## Overview

The `expect` function creates an `Assertion` for a `Locator`. When called within a test context, it automatically enables self-healing via the test's driver instance and captures failure context for the MCP server.

## Signature

```typescript
function expect(locator: Locator): Assertion
```

## Behavior

### In test context (recommended)

- Enables `SelfHealingEngine` from the shared driver
- Sets test name for healing reports
- Attaches `sendRequest` for snapshot fetching
- On failure: captures screenshot, widget tree, and source location
- Writes failure context to `FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH`

### Outside test context

- Falls back to `createExpect(locator)` — basic assertion without healing

## Usage

```typescript
import { test, expect } from '@fliwright/vitest';

test('button is visible', async ({ page }) => {
  const btn = page.locator({ text: 'Submit' });
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('Submit');
  await expect(btn).not.toBeDisabled();
});
```
