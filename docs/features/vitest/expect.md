---
module: "expect"
package: "@fliwright/vitest"
source: "src/index.ts"
generated: "2026-06-02"
---

# expect()

> Assertion function with healing integration and MCP failure context writing.

## Overview

The `expect` export creates an `Assertion` for a given `Locator`. Within a test context, it automatically wires up the `SelfHealingEngine` and test name from the active fixture, enabling self-healing on assertion failure.

## Signature

```typescript
function expect(locator: Locator): Assertion
```

## Behavior

- **Inside test context:** Creates Assertion with healing engine and test name from the fixture context
- **Outside test context:** Falls back to `createExpect(locator)` without healing

## Available Matchers

| Matcher | Description |
|---------|-------------|
| `toBeVisible()` | Assert widget is visible |
| `toHaveText(text)` | Assert exact text match |
| `toContainText(text)` | Assert text contains substring |
| `toBeEnabled()` | Assert widget is enabled |
| `toBeDisabled()` | Assert widget is disabled |
| `.not` | Negate the next matcher |

## Example

```typescript
await expect(page.locator('text=Success')).toBeVisible();
await expect(page.locator({ text: 'Title' })).toHaveText('Welcome');
await expect(page.locator({ text: 'Submit' })).toBeEnabled();
await expect(page.locator({ text: 'Loading' })).not.toBeVisible();
```
