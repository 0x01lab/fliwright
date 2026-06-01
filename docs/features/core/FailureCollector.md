---
module: "FailureCollector"
package: "@fliwright/core"
source: "src/FailureCollector.ts"
generated: "2026-06-01"
---

# FailureCollector

> Collects failure context including screenshot, widget tree, and source location.

## Overview

`FailureCollector` captures rich failure context when an assertion fails. It takes a screenshot via the bridge, collects the widget tree, and extracts source code location from the error stack trace.

## Constructor

```typescript
constructor(sendRequest: SendRequest)
```

## Public Methods

### `collect(error: AssertionError, timeout: number): Promise<FailureContext>`

Captures failure context.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `error` | `AssertionError` | Yes | The assertion error |
| `timeout` | `number` | Yes | Assertion timeout in ms |

**Returns:** `Promise<FailureContext>`

## FailureContext

| Field | Type | Description |
|-------|------|-------------|
| `assertion` | `{ matcher, expected, actual, timeout }` | Assertion details |
| `screenshot` | `Buffer \| null` | PNG screenshot |
| `widgetTree` | `object` | Widget tree snapshot |
| `source` | `{ file, line, snippet }` | Source code location |
| `timestamp` | `string` | ISO timestamp |

## Related

- **Used by:** [Assertion](./Assertion.md), `@fliwright/vitest`
- **Source:** `src/FailureCollector.ts`
