---
module: "EventAggregator"
package: "@fliwright/core"
source: "src/EventAggregator.ts"
generated: "2026-06-01"
---

# EventAggregator

> Aggregates raw pointer and text input events into semantic operations.

## Overview

`EventAggregator` converts a stream of `RawInputEvent` entries into `RecordedOperation` entries. It classifies pointer down/up pairs as taps, long presses, or drags based on duration and displacement thresholds, and merges text input events with nearby operations.

## Constructor

```typescript
constructor()
```

## Public Methods

### `aggregate(events: RawInputEvent[]): RecordedOperation[]`

Converts raw events into semantic operations.

## Classification Thresholds

| Constant | Value | Description |
|----------|-------|-------------|
| `TAP_MAX_DURATION` | 500ms | Max duration for a tap (vs long press) |
| `TAP_MAX_DISPLACEMENT` | 10px | Max displacement for a tap (vs drag) |
| `TYPE_INPUT_WINDOW` | 1000ms | Time window for merging text input |

## Classification Logic

| Condition | Classification |
|-----------|----------------|
| Duration < 500ms AND displacement < 10px | `tap` |
| Duration >= 500ms AND displacement < 10px | `longPress` |
| Displacement >= 10px | `drag` |
| `textInput` event type | Merged with nearby tap/type |

## Related

- **Used by:** [RecorderController](./RecorderController.md)
- **Source:** `src/EventAggregator.ts`
