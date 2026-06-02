---
module: "RecorderController"
package: "@fliwright/core"
source: "src/RecorderController.ts"
tests: "tests/RecorderController.test.ts"
generated: "2026-06-02"
---

# RecorderController

> Start/stop recording on the bridge, accumulate raw events into semantic operations, resolve selectors, and emit generated code.

## Overview

`start()` subscribes to the VM Service `Extension` event stream and asks the bridge to begin emitting `FliwrightRecording` events. Each event is appended to `rawEvents` and re-aggregated into `operations`. An optional `onOperation` callback fires for every newly-emerged operation. `stop()` halts the bridge, resolves a stable selector for each operation via `ext.fliwright.hitTest`, and runs `CodeGenerator` (or `DartCodeGenerator` for `lang: 'dart'`).

## Constructor

```typescript
constructor(
  sendRequest: SendRequest,
  onEvent: (callback: (event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) => () => void,
)
```

## Public Methods

### `start(options?): Promise<void>`

| Parameter | Type | Description |
|-----------|------|-------------|
| `options.onOperation` | `(op, index) => void` | Streaming callback for each new operation |

Calls `streamListen` on the `Extension` stream (idempotent — `already subscribed` errors are swallowed) and `ext.fliwright.startRecording`.

### `stop(options?): Promise<string>`

Calls `ext.fliwright.stopRecording`, unsubscribes, re-aggregates, resolves a selector per operation, and returns generated source.

| Parameter | Type | Description |
|-----------|------|-------------|
| `options.lang` | `'ts' \| 'dart'` | Output language |
| `options.testName` | string | Test name |
| `options.imports` | string | Override import source (TS only) |

**Returns:** `Promise<string>` — generated test code.

### `getOperations(): RecordedOperation[]` — snapshot copy.

### `getRawEvents(): RawInputEvent[]` — snapshot copy.

## Example

```typescript
const recorder = driver.recorder;
await recorder.start({
  onOperation: (op, i) => console.log(i, op.kind),
});
// ...interact with the app...
const code = await recorder.stop({ lang: 'ts', testName: 'login' });
```

## Related

- **Depends on:** [EventAggregator](./EventAggregator.md), [CodeGenerator](./CodeGenerator.md), [SelectorResolver](./SelectorResolver.md)
- **Bridge counterpart:** `extensions/recording.dart`
- **Source:** `packages/fliwright-core/src/RecorderController.ts`
