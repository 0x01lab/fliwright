---
module: "SnapshotStore"
package: "@fliwright/core"
source: "src/SnapshotStore.ts"
tests: "tests/SnapshotStore.test.ts"
generated: "2026-06-02"
---

# SnapshotStore

> Disk-backed key/value store for baseline `WidgetSnapshot` objects, keyed by `(testName, selector)`.

## Overview

Used by `SelfHealingEngine` to persist the "last known good" widget snapshot for each (test, selector) pair. The on-disk layout is `.fliwright/snapshots/<sanitized-testName>/<encodeURIComponent(selector)>.json`. Each file holds `{ testName, selector, snapshot, firstSeen, lastUpdated }`. The store preserves `firstSeen` across updates.

## Constructor

```typescript
constructor(baseDir?: string)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `baseDir` | string | `<cwd>/.fliwright/snapshots` | Root directory for snapshot files |

## Public Methods

### `load(testName, selector): WidgetSnapshot | null`

Returns the stored snapshot, or `null` if missing/unreadable. Errors are swallowed.

### `save(testName, selector, snapshot): Promise<void>`

Writes the snapshot to disk. Creates intermediate directories. Preserves `firstSeen` if the file already existed.

### `list(testName): Map<string, WidgetSnapshot>`

Returns all snapshots for a given test name, keyed by selector. Returns an empty map if the directory doesn't exist or contains only malformed files.

## Example

```typescript
const store = new SnapshotStore();
await store.save('login test', 'text=Login', widgetSnapshot);
const baseline = store.load('login test', 'text=Login');
const all = store.list('login test');
```

## Related

- **Used by:** [SelfHealingEngine](./SelfHealingEngine.md)
- **Source:** `packages/fliwright-core/src/SnapshotStore.ts`
