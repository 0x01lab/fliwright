---
module: "SnapshotStore"
package: "@fliwright/core"
source: "src/SnapshotStore.ts"
generated: "2026-06-02"
---

# SnapshotStore

> Persists widget snapshots to `.fliwright/snapshots/` for self-healing reference.

## Overview

`SnapshotStore` saves and loads `WidgetSnapshot` objects keyed by (testName, selector). Files are stored under `.fliwright/snapshots/<sanitized-test-name>/` as JSON. Each file preserves `firstSeen` and `lastUpdated` timestamps.

## Constructor

```typescript
constructor(baseDir?: string)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `baseDir` | `string` | No | Default: `.fliwright/snapshots` |

## Public Methods

### `load(testName: string, selector: string): WidgetSnapshot | null`

Loads a snapshot. Returns null if not found.

### `save(testName: string, selector: string, snapshot: WidgetSnapshot): Promise<void>`

Saves a snapshot, preserving `firstSeen` if file already exists.

### `list(testName: string): Map<string, WidgetSnapshot>`

Lists all snapshots for a test name, keyed by selector.

## Related

- **Used by:** [SelfHealingEngine](./SelfHealingEngine.md)
- **Source:** `src/SnapshotStore.ts`
