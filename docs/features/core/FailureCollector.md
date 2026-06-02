---
module: "FailureCollector"
package: "@fliwright/core"
source: "src/FailureCollector.ts"
generated: "2026-06-02"
---

# FailureCollector

> Collects screenshot, widget tree, and source location on assertion failure.

## Overview

When an `AssertionError` is caught, `FailureCollector` gathers diagnostic context: a screenshot (via `ext.fliwright.screenshot` or `ext.flutter.driver.screenshot`), the widget tree (via `ext.fliwright.snapshot` or `ext.fliwright.inspect`), and the source location from the error stack trace.

## Constructor

```typescript
constructor(sendRequest: SendRequest)
```

## Public Methods

### `collect(error: AssertionError, timeout: number): Promise<FailureContext>`

Collects full failure context including screenshot, widget tree, and source info.

## Related

- **Used by:** [Assertion](./Assertion.md), @fliwright/vitest
- **Source:** `src/FailureCollector.ts`
