---
module: "SelfHealingEngine"
package: "@fliwright/core"
source: "src/SelfHealingEngine.ts"
generated: "2026-06-01"
---

# SelfHealingEngine

> Self-healing engine that recovers from broken selectors by matching widget snapshots.

## Overview

When an assertion fails because a selector no longer matches, the `SelfHealingEngine` uses a `HealingStrategy` to find the best alternative widget. It records successful snapshots for future healing attempts and generates detailed `HealingReport` entries.

## Constructor

```typescript
constructor(store: SnapshotStore, strategy: HealingStrategy)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `store` | `SnapshotStore` | Yes | Snapshot persistence store |
| `strategy` | `HealingStrategy` | Yes | Scoring and matching strategy |

## Public Methods

### `setEnabled(enabled: boolean): void`

Enables or disables the healing engine.

### `recordSuccess(locator: Locator, testName: string, fetchSnapshot: FetchSnapshot): Promise<void>`

Saves a snapshot of the successfully matched widget for future healing.

### `tryHeal(locator: Locator, testName: string, failure: FailureContext, fetchCandidates: () => Promise<WidgetSnapshot[]>): Promise<{ healed: boolean; report?: HealingReport }>`

Attempts to find an alternative widget matching the original snapshot.

### `getReports(testName?: string): HealingReport[]`

Returns healing reports, optionally filtered by test name.

## Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `enabled` | `boolean` | Yes (getter) | Whether healing is active |

## Related

- **Depends on:** [SnapshotStore](./SnapshotStore.md), [MultiDimensionalHealingStrategy](./MultiDimensionalHealingStrategy.md)
- **Used by:** [Assertion](./Assertion.md)
- **Source:** `src/SelfHealingEngine.ts`
