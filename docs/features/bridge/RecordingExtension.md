---
module: "RecordingExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/recording.dart"
generated: "2026-06-02"
---

# RecordingExtension

> Captures pointer events and text input for recording user interactions.

## Overview

Registers `ext.fliwright.startRecording` and `ext.fliwright.stopRecording`. When recording is active, captures `PointerDownEvent`/`PointerMoveEvent`/`PointerUpEvent` events and polls for text input changes on focused `EditableText` widgets.

## Registered Extensions

### `ext.fliwright.startRecording`

Starts capturing pointer events via `PointerRouter` and text input changes via periodic polling.

### `ext.fliwright.stopRecording`

Stops capturing and cleans up listeners.

### `ext.fliwright.hitTest`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `x` | `double` | Yes | X coordinate |
| `y` | `double` | Yes | Y coordinate |

Performs a hit test at the given position and returns the widget at that location.

## Event Stream

Events are emitted on the `Extension` stream with kind `FliwrightRecording`. Each event contains:
- Pointer events: `type: 'pointerEvent'`, `kind: 'down'|'move'|'up'`, `pointer`, `position`, `timestamp`
- Text events: `type: 'textInput'`, `text`, `action: 'replace'`, `timestamp`
