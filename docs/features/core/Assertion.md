---
module: "Assertion"
package: "@fliwright/core"
source: "src/Assertion.ts"
generated: "2026-06-01"
---

# Assertion & createExpect

> Fluent assertion API with polling, `.not` negation, and self-healing integration.

## Overview

`Assertion` provides a Vitest/Jest-style assertion API for Flutter widgets. Each assertion polls until the condition is met or times out. On failure, if a `SelfHealingEngine` is configured, it attempts to heal the broken selector. The `createExpect` factory function creates an Assertion from a Locator.

## AssertionError

```typescript
class AssertionError extends Error {
  constructor(matcher: string, expected: string, actual: string, selector: string)
  readonly matcher: string;
  readonly expected: string;
  readonly actual: string;
  readonly selector: string;
}
```

## createExpect (function)

```typescript
function createExpect(locator: Locator, failureCollector?: FailureCollector): Assertion
```

Creates an Assertion for the given locator. If a FailureCollector is provided, failure context is captured.

## Assertion

### Constructor

```typescript
constructor(
  locator: Locator,
  negated?: boolean,
  failureCollector?: FailureCollector,
  healingEngine?: SelfHealingEngine,
  testName?: string,
  sendRequest?: SendRequest,
)
```

### Public Methods

#### `toBeVisible(options?: { timeout?: number }): Promise<void>`

Asserts the widget is visible. Default timeout: 5000ms.

#### `toHaveText(text: string, options?: { timeout?: number }): Promise<void>`

Asserts the widget has exact text content.

#### `toContainText(text: string, options?: { timeout?: number }): Promise<void>`

Asserts the widget's text contains the given substring.

#### `toBeEnabled(options?: { timeout?: number }): Promise<void>`

Asserts the widget is enabled (not disabled).

#### `toBeDisabled(options?: { timeout?: number }): Promise<void>`

Asserts the widget is disabled.

### Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `not` | `Assertion` | Yes | Returns a new negated Assertion |

### Healing Integration

When an assertion fails and a `SelfHealingEngine` is available:
1. The engine fetches current widget snapshots from the bridge.
2. It scores candidates using the configured strategy.
3. If a match exceeds the confidence threshold, the selector is healed.
4. A `HealingReport` is recorded.
5. On success, the snapshot is saved for future healing.

## Constants

| Name | Value | Description |
|------|-------|-------------|
| `DEFAULT_TIMEOUT` | `5000` | Default assertion timeout (ms) |
| `DEFAULT_INTERVAL` | `100` | Default polling interval (ms) |

## Related

- **Depends on:** [Locator](./Locator.md), [SelfHealingEngine](./SelfHealingEngine.md), [FailureCollector](./FailureCollector.md)
- **Source:** `src/Assertion.ts`
