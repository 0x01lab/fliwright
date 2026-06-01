---
module: "RecordingExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/recording.dart"
generated: "2026-06-01"
---

# RecordingExtension

> Captures pointer events and text input during user interaction recording.

## Registered Extensions

### `ext.fliwright.startRecording`

**Parameters:** None

**Returns:** `{ recording: true }`

Starts a global pointer route that posts `FliwrightRecording` VM service events (`pointerEvent` type). Starts a 50ms periodic timer polling focused text inputs and posting `textInput` events.

### `ext.fliwright.stopRecording`

**Parameters:** None

**Returns:** `{ recording: false }`

### `ext.fliwright.hitTest`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `x` | `double` | No | X coordinate (default: 0.0) |
| `y` | `double` | No | Y coordinate (default: 0.0) |

**Returns:** `{ widget: Map? }` — Widget info at the given coordinates.
