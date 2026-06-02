---
module: "EventAggregator"
package: "@fliwright/core"
source: "src/EventAggregator.ts"
tests: "tests/EventAggregator.test.ts"
generated: "2026-06-02"
---

# EventAggregator

> Transforms a stream of raw pointer / text-input events into semantic `RecordedOperation` entries (tap / longPress / drag / type).

## Overview

Pointer-down/up pairs are classified by duration and displacement:

| Condition | Operation |
|-----------|-----------|
| displacement > 10px | `drag` |
| duration ≥ 500ms (and displacement ≤ 10px) | `longPress` |
| otherwise | `tap` |

Text-input events within 1s of an editable operation merge into a single `type` operation; otherwise they emit standalone `type` operations.

## Constructor

```typescript
constructor()
```

## Public Methods

### `aggregate(events: RawInputEvent[]): RecordedOperation[]`

| Parameter | Type | Description |
|-----------|------|-------------|
| `events` | `RawInputEvent[]` | Raw events from the bridge |

**Returns:** `RecordedOperation[]` — sorted by timestamp.

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `TAP_MAX_DURATION` | 500 ms | Tap upper duration bound |
| `TAP_MAX_DISPLACEMENT` | 10 px | Tap upper displacement bound |
| `TYPE_INPUT_WINDOW` | 1000 ms | Window after an editable op within which text events merge |

## Example

```typescript
const ops = new EventAggregator().aggregate(rawEvents);
```

## Related

- **Used by:** [RecorderController](./RecorderController.md)
- **Source:** `packages/fliwright-core/src/EventAggregator.ts`
