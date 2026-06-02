---
module: "SelfHealingEngine"
package: "@fliwright/core"
source: "src/SelfHealingEngine.ts"
tests: "tests/SelfHealingEngine.test.ts"
generated: "2026-06-02"
---

# SelfHealingEngine

> Records baseline widget snapshots on assertion success and, on failure, asks the healing strategy to find the best candidate match in the current widget tree.

## Overview

The engine sits between `Assertion` and `SnapshotStore`. On every successful assertion, it persists the widget snapshot keyed by `(testName, selector)`. When an assertion fails after timeout, the engine loads the baseline, fetches live candidates, runs them through a `HealingStrategy`, and (if a match exceeds the threshold) emits a `HealingReport` containing the suggested selector and per-dimension scores.

## Constructor

```typescript
constructor(store: SnapshotStore, strategy: HealingStrategy)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `store` | `SnapshotStore` | Yes | Disk-backed snapshot persistence |
| `strategy` | `HealingStrategy` | Yes | Scoring/matching algorithm (default `MultiDimensionalHealingStrategy`) |

## Public Methods

### `recordSuccess(locator, testName, fetchSnapshot): Promise<void>`

Persists a widget snapshot for `(testName, locator.selectorString)`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `locator` | `Locator` | The locator that succeeded |
| `testName` | string | The current test name |
| `fetchSnapshot` | `() => Promise<WidgetSnapshot | WidgetSnapshot[]>` | Callback returning the snapshot |

---

### `tryHeal(locator, testName, failure, fetchCandidates): Promise<{ healed, report? }>`

Attempts to heal a failing locator. Returns `{ healed: true, report }` if a candidate exceeds the strategy's threshold.

| Parameter | Type | Description |
|-----------|------|-------------|
| `locator` | `Locator` | The failing locator |
| `testName` | string | Test name (for snapshot lookup) |
| `failure` | `FailureContext` | Context from the failing assertion |
| `fetchCandidates` | `() => Promise<WidgetSnapshot[]>` | Callback returning live candidate widgets |

**Returns:** `{ healed: boolean; report?: HealingReport }`

---

### `getReports(testName?): HealingReport[]`

Returns a copy of all stored healing reports, optionally filtered by test name.

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `enabled` | boolean | Read/set; when `false`, `tryHeal` short-circuits |

## Example

```typescript
import { SelfHealingEngine, MultiDimensionalHealingStrategy, SnapshotStore } from '@fliwright/core';

const engine = new SelfHealingEngine(new SnapshotStore(), new MultiDimensionalHealingStrategy());
await engine.recordSuccess(locator, 'login', fetchSnapshot);
const { healed, report } = await engine.tryHeal(locator, 'login', failure, fetchCandidates);
```

## Related

- **Depends on:** [SnapshotStore](./SnapshotStore.md), [MultiDimensionalHealingStrategy](./MultiDimensionalHealingStrategy.md), `HealingStrategy` interface
- **Used by:** [Assertion](./Assertion.md), [FliwrightDriver](./FliwrightDriver.md)
- **Pipeline:** [self-healing-pipeline.md](../self-healing-pipeline.md)
- **Source:** `packages/fliwright-core/src/SelfHealingEngine.ts`
