---
module: "SelfHealingEngine"
package: "@fliwright/core"
source: "src/SelfHealingEngine.ts"
generated: "2026-06-02"
---

# SelfHealingEngine

> Records successful selector snapshots and attempts to heal broken selectors on assertion failure using multi-dimensional similarity scoring.

## Overview

When assertions pass, `SelfHealingEngine` saves widget snapshots via `SnapshotStore`. When assertions fail, it loads the stored snapshot and compares it against current widget candidates using a `HealingStrategy`. If a match exceeds the confidence threshold, the engine suggests an alternative selector and re-runs the assertion.

## Constructor

```typescript
constructor(store: SnapshotStore, strategy: HealingStrategy)
```

## Public Methods

### `recordSuccess(locator: Locator, testName: string, fetchSnapshot: FetchSnapshot): Promise<void>`

Saves the widget snapshot for the given (testName, selector) pair.

### `tryHeal(locator: Locator, testName: string, failure: FailureContext, fetchCandidates: () => Promise<WidgetSnapshot[]>): Promise<{ healed: boolean; report?: HealingReport }>`

Attempts to find a replacement selector. Returns `{ healed: true, report }` if healing succeeds.

### `getReports(testName?: string): HealingReport[]`

Returns healing reports, optionally filtered by test name.

### `setEnabled(enabled: boolean): void`

Enables or disables the healing engine.

## Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `enabled` | `boolean` | Yes | Whether healing is enabled |

## Related

- **Depends on:** [SnapshotStore](./SnapshotStore.md), [MultiDimensionalHealingStrategy](./MultiDimensionalHealingStrategy.md)
- **Used by:** [Assertion](./Assertion.md)
- **Source:** `src/SelfHealingEngine.ts`
