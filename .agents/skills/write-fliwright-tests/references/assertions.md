# Assertions

`expect(locator)` returns an `Assertion` with **Playwright-style auto-wait**: it polls the locator
until the condition holds or the timeout elapses, so you almost never need a manual `sleep` before
an assertion.

```typescript
import { expect } from '@fliwright/vitest';          // Fliwright expect (auto-wait + healing)
import { expect as viExpect } from 'vitest';          // raw Vitest for non-locator checks
```

## Matchers

Every matcher accepts `options?: { timeout?: number }` (default `5000` ms).

| Matcher | Passes when… |
| --- | --- |
| `toBeVisible(options?)` | the locator resolves to a hit-testable widget |
| `toHaveText(text, options?)` | the first match has exactly this text |
| `toContainText(text, options?)` | the first match's text contains the substring |
| `toBeEnabled(options?)` | the first match is enabled (`properties.enabled !== false`) |
| `toBeDisabled(options?)` | the first match is disabled (negation of `toBeEnabled`) |

```typescript
await expect(page.getByText('Welcome')).toBeVisible();
await expect(page.getByKey('submit')).toBeEnabled({ timeout: 10_000 });
await expect(page.getByText('Saved')).toContainText('Saved');
await expect(page.getByText('Count: 1')).toHaveText('Count: 1');
```

## Negation: `.not`

```typescript
await expect(page.getByKey('passwordError')).not.toBeVisible();
await expect(page.getByText('Loading')).not.toBeVisible();
```

`.not` returns a new negated `Assertion`. It disables self-healing (healing only applies to positive assertions).

## Auto-wait behavior

`Assertion` polls the locator roughly every 100 ms:

```typescript
// Polls until "Done" is visible, up to 5s — no sleep needed.
await page.getByKey('submit').click();
await expect(page.getByText('Done')).toBeVisible();
```

If you need a longer window (slow animations, network), pass `timeout`:

```typescript
await expect(page.getByText('Synced')).toBeVisible({ timeout: 15_000 });
```

For boolean checks that are **not** a single-widget visibility/text claim, drop to Vitest:

```typescript
viExpect(await page.getByText('Ready').count()).toBe(1);
viExpect(await page.getByText('Ready').isVisible()).toBe(true);
```

## Self-healing

Positive `expect(...).toBeVisible()` participates in self-healing when the fixture wires a
`SelfHealingEngine` (the default fixture does). On failure it:

1. records a **success snapshot** the first time this `(testName, selector)` passes — the baseline,
2. on a later failure, compares the current snapshot against stored baselines via a
   multi-dimensional healing strategy (n-gram similarity across text/type/semantics),
3. if a confident alternative selector is found, re-runs the assertion against the healed locator.

This makes assertions resilient to small UI changes. Healing is **off** for negated assertions and
for raw-driver scripts that don't wire the engine. The latest healing suggestion for a test is also
surfaced in the failure report (see [troubleshooting.md](./troubleshooting.md)).

## What to assert

Assert through the **UI**, the same thing a user would see — not through internal state.

```typescript
// ✅ visible outcome
await page.getByKey('loginButton').click();
await expect(page.getByText('Welcome, Alice')).toBeVisible();

// ✅ state changed visibly
await page.getByText('Subscribe').click();
await expect(page.getByText('Subscribed')).toBeVisible();
await expect(page.getByText('Subscribe')).not.toBeVisible();
```

## Asserting on mocks

Assert on intercepted HTTP via `driver.mock` (see [mocks.md](./mocks.md)):

```typescript
const calls = await driver.mock.getCalls('/api/register');
viExpect(calls.length).toBeGreaterThanOrEqual(1);
viExpect(calls.at(-1)!.method).toBe('POST');
```

## Failure context

When an `AssertionError` is thrown, it carries structured fields used in reports:

```typescript
class AssertionError extends Error {
  matcher: string;     // 'toBeVisible' | 'toHaveText' | ...
  expected: string;
  actual: string;
  selector: string;
}
// message: `${matcher} failed for "${selector}": expected ${expected}, got ${actual}`
```

When run through `fliwright run` or MCP, the fixture also captures: a screenshot, the widget tree,
recent VM diagnostics, the source location, and any healing suggestion — all persisted to the run's
failure context file. See [cli.md](./cli.md) and [mcp-workflow.md](./mcp-workflow.md).
