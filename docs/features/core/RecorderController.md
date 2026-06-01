---
module: "RecorderController"
package: "@fliwright/core"
source: "src/RecorderController.ts"
generated: "2026-06-01"
---

# RecorderController

> Controls interaction recording sessions on a Flutter app.

## Overview

`RecorderController` starts and stops recording sessions via the bridge's recording extension. It captures raw pointer and text input events, aggregates them into semantic operations, and generates test code on stop.

## Constructor

```typescript
constructor(sendRequest: SendRequest, onEvent: OnEvent)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sendRequest` | `SendRequest` | Yes | JSON-RPC request sender |
| `onEvent` | `OnEvent` | Yes | Event subscription function |

Where `OnEvent = (callback: (event) => void) => () => void`

## Public Methods

### `start(options?: RecorderStartOptions): Promise<void>`

Starts recording. Subscribes to VM service events and begins capturing.

| Parameter | Type | Description |
|-----------|------|-------------|
| `options.onOperation` | `(operation: RecordedOperation, index: number) => void` | Callback for each aggregated operation |

### `stop(options?: CodegenOptions): Promise<string>`

Stops recording and generates test code. Returns the generated code string.

### `getOperations(): RecordedOperation[]`

Returns all aggregated operations from the current or last recording.

### `getRawEvents(): RawInputEvent[]`

Returns all raw events captured during the recording.

## RecorderStartOptions

| Field | Type | Description |
|-------|------|-------------|
| `onOperation` | `(operation, index) => void` | Real-time callback for each operation |

## Related

- **Depends on:** [EventAggregator](./EventAggregator.md), [CodeGenerator](./CodeGenerator.md)
- **Used by:** [FliwrightDriver](./FliwrightDriver.md)
- **Source:** `src/RecorderController.ts`
