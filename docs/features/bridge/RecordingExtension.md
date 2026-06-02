---
module: "RecordingExtension"
package: "fliwright_bridge"
source: "lib/src/extensions/recording.dart"
generated: "2026-06-02"
---

# RecordingExtension

> Capture live pointer and text-input events from the running Flutter app and emit them as `Extension` stream events.

## Registered Methods

| Method | Description |
|--------|-------------|
| `ext.fliwright.startRecording` | Begin capturing events |
| `ext.fliwright.stopRecording` | Stop capturing events |
| `ext.fliwright.hitTest` | Resolve `(x, y)` to a `WidgetInfo` (used per-op by RecorderController) |

### `ext.fliwright.startRecording`

No params (or optionally `pollIntervalMs`). Installs a `PointerDataEventListener` and a periodic text-polling timer. Each event is emitted via `postEvent('Extension', { kind: 'FliwrightRecording', ... })` on the VM Service `Extension` event stream.

### `ext.fliwright.stopRecording`

Removes the listener, cancels the timer.

### `ext.fliwright.hitTest`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `x` | number | Yes | Screen x |
| `y` | number | Yes | Screen y |

**Returns:** `{ widget: Partial<WidgetInfo> }` — the topmost widget at the location (via `HitTestResult`). Used by `RecorderController.resolveSelector` to attach a stable selector to each recorded operation.

## Reset

`RecordingExtension.reset()` is called by `FliwrightBridge.reset()` to clear state between test runs.

## Related

- **TS counterpart:** [`RecorderController`](../core/RecorderController.md)
- **Source:** `packages/fliwright-bridge/lib/src/extensions/recording.dart`
