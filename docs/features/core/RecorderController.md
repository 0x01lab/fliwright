---
module: "RecorderController"
package: "@fliwright/core"
source: "src/RecorderController.ts"
generated: "2026-06-02"
---

# RecorderController

> Records user interactions on a Flutter app and generates test code via CodeGenerator.

## Overview

`RecorderController` starts the Flutter recording extension, collects raw `FliwrightRecording` stream events, aggregates them into semantic operations via `EventAggregator`, resolves selectors via hitTest, and generates test code via `CodeGenerator`.

## Constructor

```typescript
constructor(sendRequest: SendRequest, onEvent: OnEvent)
```

## Public Methods

### `start(options?: RecorderStartOptions): Promise<void>`

Starts recording. Subscribes to the Extension stream and calls `ext.fliwright.startRecording`. Optionally calls `onOperation` callback for each new operation.

### `stop(options?: CodegenOptions): Promise<string>`

Stops recording and returns generated test code. Options control language (`ts` or `dart`) and test name.

### `getOperations(): RecordedOperation[]`

Returns the aggregated operations collected so far.

### `getRawEvents(): RawInputEvent[]`

Returns the raw input events collected so far.

## Related

- **Depends on:** [EventAggregator](./EventAggregator.md), [CodeGenerator](./CodeGenerator.md), [SelectorResolver](./SelectorResolver.md)
- **Source:** `src/RecorderController.ts`
