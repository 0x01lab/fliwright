---
module: "SnapshotStore"
package: "@fliwright/core"
source: "src/SnapshotStore.ts"
generated: "2026-06-01"
---

# SnapshotStore

> Persistent file-based storage for widget snapshots used in self-healing.

## Overview

`SnapshotStore` saves and loads widget snapshots to `.fliwright/snapshots/` on disk. Each snapshot is keyed by test name and selector, enabling the self-healing engine to compare current widget trees against previously successful states.

## Constructor

```typescript
constructor(baseDir?: string)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `baseDir` | `string` | No | Default: `<cwd>/.fliwright/snapshots` |

## Public Methods

### `save(testName: string, selector: string, snapshot: WidgetSnapshot): Promise<void>`

Persists a widget snapshot to disk.

### `load(testName: string, selector: string): WidgetSnapshot | null`

Loads a previously saved snapshot. Returns `null` if not found.

### `list(testName: string): Map<string, WidgetSnapshot>`

Returns all snapshots for a given test name.

## Related

- **Used by:** [SelfHealingEngine](./SelfHealingEngine.md)
- **Source:** `src/SnapshotStore.ts`
