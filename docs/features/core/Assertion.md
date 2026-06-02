---
module: "Assertion"
package: "@fliwright/core"
source: "src/Assertion.ts"
generated: "2026-06-02"
---

# Assertion

> Playwright-style auto-wait polling assertion with `.not` negation and self-healing integration.

## Overview

`Assertion` wraps a `Locator` and provides matcher methods (`toBeVisible`, `toHaveText`, `toContainText`, `toBeEnabled`, `toBeDisabled`) that poll until the condition is met or a timeout elapses. On failure, it attempts self-healing via `SelfHealingEngine.tryHeal()`. On success, it records a snapshot for future healing.

## createExpect

```typescript
function createExpect(locator: Locator, failureCollector?: FailureCollector): Assertion
```

Creates an Assertion for the given Locator.

## AssertionError

```typescript
class AssertionError extends Error {
  readonly matcher: string;
  readonly expected: string;
  readonly actual: string;
  readonly selector: string;
}
```

## Public Methods

### `toBeVisible(options?: { timeout?: number }): Promise<void>`

Asserts the element is visible. Default timeout: 5000ms. On failure, attempts self-healing before throwing.

### `toHaveText(text: string, options?: { timeout?: number }): Promise<void>`

Asserts the element has the exact text.

### `toContainText(text: string, options?: { timeout?: number }): Promise<void>`

Asserts the element contains the given text substring.

### `toBeEnabled(options?: { timeout?: number }): Promise<void>`

Asserts the element is enabled (checks `properties.enabled`).

### `toBeDisabled(options?: { timeout?: number }): Promise<void>`

Asserts the element is disabled (delegates to `toBeEnabled` with negation).

### `not` (property)

Returns a new Assertion with negation applied. Negated assertions flip the check: `toBeVisible` checks not-visible, etc.

## Related

- **Depends on:** [Locator](./Locator.md), [SelfHealingEngine](./SelfHealingEngine.md), [FailureCollector](./FailureCollector.md)
- **Source:** `src/Assertion.ts`
