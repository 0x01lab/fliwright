---
module: "FailureCollector"
package: "@fliwright/core"
source: "src/FailureCollector.ts"
tests: "tests/FailureCollector.test.ts"
generated: "2026-06-02"
---

# FailureCollector

> Capture screenshot, widget tree, and source location for a failed assertion.

## Overview

On assertion failure, `FailureCollector.collect()` runs three calls in parallel:

1. `ext.fliwright.screenshot` (falls back to `ext.flutter.driver.screenshot` if absent)
2. `ext.fliwright.snapshot` (falls back to `ext.fliwright.inspect` with empty selector)
3. Stack-trace parsing for `{ file, line, snippet }`

Errors at any step are swallowed so a partial `FailureContext` is always returned.

## Constructor

```typescript
constructor(sendRequest: SendRequest)
```

## Public Methods

### `collect(error, timeout): Promise<FailureContext>`

| Parameter | Type | Description |
|-----------|------|-------------|
| `error` | `AssertionError` | The failure |
| `timeout` | number | Assertion timeout (carried into context) |

**Returns:** `Promise<FailureContext>`:

```typescript
{
  assertion: { matcher, expected, actual, timeout };
  screenshot: Buffer | null;
  widgetTree: object;
  source: { file, line, snippet };
  timestamp: string;  // ISO
}
```

## Example

```typescript
const collector = new FailureCollector(driver.sendRequest.bind(driver));
try {
  await expect(locator).toBeVisible();
} catch (e) {
  if (e instanceof AssertionError) {
    const ctx = await collector.collect(e, 5000);
    // ...report...
  }
}
```

## Related

- **Used by:** [Assertion](./Assertion.md), `@fliwright/vitest` failure writer
- **Source:** `packages/fliwright-core/src/FailureCollector.ts`
