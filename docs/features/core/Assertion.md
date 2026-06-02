---
module: "Assertion"
package: "@fliwright/core"
source: "src/Assertion.ts"
tests: "tests/Assertion.test.ts"
generated: "2026-06-02"
---

# Assertion

> Playwright-style auto-waiting assertion wrapper around a `Locator`, with optional self-healing on failure.

## Overview

`Assertion` polls a matcher up to a timeout (default 5s, 100ms interval). On failure it can invoke `SelfHealingEngine.tryHeal` to look up a replacement selector and retry once. Negation is supported via the `.not` property. `createExpect(locator, options)` is the public factory; the `@fliwright/vitest` `expect()` wraps it to attach the current driver's healing engine.

## Constructor

```typescript
constructor(
  locator: Locator,
  negated?: boolean,
  failureCollector?: FailureCollector,
  healingEngine?: SelfHealingEngine,
  testName?: string,
  sendRequest?: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locator` | `Locator` | Yes | The locator to assert against |
| `negated` | boolean | No | Default `false`. Set via `.not` |
| `failureCollector` | `FailureCollector` | No | Used to capture context on failure |
| `healingEngine` | `SelfHealingEngine` | No | Triggers self-healing retry |
| `testName` | string | No | Test name — required for healing lookup |
| `sendRequest` | function | No | RPC channel — required for healing |

## Public Methods

### `toBeVisible(options?): Promise<void>`

Asserts the locator matches at least one widget with a render `rect`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `options.timeout` | number | Max wait in ms (default 5000) |

---

### `toHaveText(text, options?): Promise<void>`

Asserts the first match's `text` equals `text` exactly.

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | string | Expected exact text |
| `options.timeout` | number | Max wait in ms |

---

### `toContainText(text, options?): Promise<void>`

Asserts the first match's `text` contains `text` as a substring.

---

### `toBeEnabled(options?): Promise<void>` / `toBeDisabled(options?): Promise<void>`

Assert the widget's `enabled` property.

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `not` | `Assertion` | Returns a negated copy |

## `AssertionError` (class)

```typescript
export class AssertionError extends Error {
  readonly matcher: string;
  readonly expected: string;
  readonly actual: string;
  readonly selector: string;
}
```

Thrown after polling exhausts and (optionally) healing fails.

## `createExpect(locator, options?)`

```typescript
function createExpect(
  locator: Locator,
  options?: { healing?: SelfHealingEngine; testName?: string; sendRequest?: SendRequest },
): Assertion;
```

Convenience factory that returns a fresh `Assertion` bound to the supplied healing context. Used by `@fliwright/vitest`'s `expect()`.

## Example

```typescript
import { createExpect } from '@fliwright/core';

const expect = createExpect(page.locator({ text: 'Welcome' }), {
  healing: driver.healing,
  testName: 'login flow',
});

await expect.toBeVisible();
await expect.not.toHaveText('Loading...');
```

## Related

- **Depends on:** [Locator](./Locator.md), [SelfHealingEngine](./SelfHealingEngine.md), [FailureCollector](./FailureCollector.md)
- **Source:** `packages/fliwright-core/src/Assertion.ts`
