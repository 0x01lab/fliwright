---
module: "EventAggregator"
package: "@fliwright/core"
source: "src/EventAggregator.ts"
generated: "2026-06-02"
---

# EventAggregator

> Aggregates raw pointer and text input events into semantic operations (tap, longPress, drag, type).

## Overview

Processes raw `RawInputEvent` streams from the Flutter recording extension. Distinguishes taps from long presses by duration (<500ms = tap), and taps from drags by displacement (<10px = tap). Merges text input events with preceding tap operations.

## Public Methods

### `aggregate(events: RawInputEvent[]): RecordedOperation[]`

Converts raw events into semantic operations, sorted by timestamp.

## Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| TAP_MAX_DURATION | 500ms | Threshold for long press detection |
| TAP_MAX_DISPLACEMENT | 10px | Threshold for drag detection |
| TYPE_INPUT_WINDOW | 1000ms | Window for associating text with tap |

## Related

- **Used by:** [RecorderController](./RecorderController.md)
- **Source:** `src/EventAggregator.ts`
