# Slice 5: Recording Loop — Codegen

**Date**: 2026-05-30
**Status**: Approved
**Depends on**: Slice 0 (Extensible Architecture), Slice 1 (Minimal Loop), Slice 2 (Assertion Loop)

---

## Goal

Auto-generate TypeScript test scripts from user interactions on the device. After Slice 5, a developer can call `driver.recorder.start()`, perform actions on a Flutter app, call `driver.recorder.stop()`, and receive a complete `.test.ts` file that replays those actions using the Fliwright SDK.

---

## Delivery Approach: Vertical Slice Iteration

Four iterations, each delivering a demoable end-to-end capability:

| Iteration | Scope | User Gets |
|-----------|-------|-----------|
| 5-A | Dart recording extension + TS RecorderController | "Start → device interaction → stop → raw events received" end-to-end |
| 5-B | EventAggregator + Widget reverse lookup | "Raw events → aggregated operations + selectors" end-to-end |
| 5-C | CodeGenerator + Driver integration | "Record → generate complete .test.ts file" end-to-end |
| 5-D | Integration test | Full recording flow verification |

---

## 1. Dart Recording Extension

### 1.1 Extensions

Register two VM Service extensions:

| Extension | Purpose |
|-----------|---------|
| `ext.fliwright.startRecording` | Start intercepting pointer events and pushing them via VM Service event stream |
| `ext.fliwright.stopRecording` | Stop intercepting and return confirmation |

### 1.2 Pointer Event Interception

Use `GestureBinding.instance.pointerRouter.addGlobalRoute()` to intercept all touch events.

Each event is pushed via `dart:developer`'s `postEvent` to the `FliwrightRecording` event stream:

```json
{
  "type": "pointerEvent",
  "kind": "down" | "move" | "up",
  "pointer": 0,
  "position": { "x": 150.0, "y": 300.0 },
  "timestamp": 1234567890,
  "buttons": 1
}
```

### 1.3 Text Input Detection

Monitor `SystemChannels.textInput` to detect when text is entered into a focused TextField. Push `textInput` events:

```json
{
  "type": "textInput",
  "text": "alice@test.com",
  "timestamp": 1234567891
}
```

### 1.4 Implementation

- `startRecording`: register global pointer route + text input listener, set `_recording = true`
- `stopRecording`: remove global pointer route + text input listener, set `_recording = false`
- Events are pushed in real-time via `postEvent('FliwrightRecording', data)`

**Estimate**: 2 days

---

## 2. TS RecorderController

### 2.1 API

```typescript
const recorder = driver.recorder;

await recorder.start();
// ... user interacts with device ...
const code = await recorder.stop();
// code = full .test.ts file content as string

// Or get intermediate results:
const operations = recorder.getOperations();  // Aggregated high-level operations
```

### 2.2 Event Stream Reception

On `start()`, subscribe to VM Service event stream `FliwrightRecording`. Each incoming event is buffered in an internal array.

On `stop()`, unsubscribe from the event stream and process the buffered events:
1. Run `EventAggregator` to convert raw events to high-level operations
2. For each operation, call `ext.fliwright.inspect` with the operation's coordinates to get Widget info
3. Select best selector for each operation
4. Run `CodeGenerator` to produce the final code

### 2.3 Class Structure

```typescript
class RecorderController {
  private rawEvents: PointerEvent[];
  private operations: RecordedOperation[];
  private sendRequest: SendRequest;

  async start(): Promise<void>;
  async stop(): Promise<string>;
  getOperations(): RecordedOperation[];
}
```

**Estimate**: 1 day

---

## 3. EventAggregator — Gesture Recognition

### 3.1 Raw-to-Operation Conversion

Convert a sequence of raw pointer events into high-level operations:

| Pattern | Result | Conditions |
|---------|--------|------------|
| down → up | `tap` | Duration < 500ms, displacement < 10px |
| down → wait → up | `longPress` | Duration >= 500ms, displacement < 10px |
| down → move series → up | `drag` | Total displacement > 10px |
| tap on TextField followed by textInput event | `type` | Text input detected after tap |

### 3.2 RecordedOperation Type

```typescript
interface RecordedOperation {
  kind: 'tap' | 'longPress' | 'drag' | 'type';
  position: { x: number; y: number };
  delta?: { x: number; y: number };      // drag only
  text?: string;                          // type only
  duration?: number;                      // longPress only
  timestamp: number;
}
```

### 3.3 Algorithm

1. Group raw events by `pointer` ID
2. For each pointer's event sequence:
   - Single down+up with small displacement → `tap`
   - Down with long delay before up → `longPress`
   - Down with significant movement → `drag`
3. For each `tap` operation, check if a `textInput` event occurred within 1000ms at similar coordinates → if so, convert to `type` operation

### 3.4 Class

```typescript
class EventAggregator {
  aggregate(events: RawInputEvent[]): RecordedOperation[];
}
```

**Estimate**: 2 days

---

## 4. Widget Reverse Lookup & Selector Strategy

### 4.1 Reverse Lookup — `ext.fliwright.hitTest`

The existing `ext.fliwright.inspect` extension finds widgets by selector (text/key/type). For coordinate-based reverse lookup, add a new extension `ext.fliwright.hitTest` that takes `{ x, y }` coordinates, performs a Flutter hit test, and returns the `WidgetInfo` at that position.

**Protocol**:
```json
// Request
{ "x": 150.0, "y": 300.0 }

// Response
{
  "widget": {
    "id": "widget_42",
    "type": "ElevatedButton",
    "text": "登录",
    "key": null,
    "rect": { "x": 100, "y": 280, "width": 200, "height": 48 },
    "properties": {}
  }
}
```

**Implementation**: Use `RendererBinding.instance.renderView.hitTest()` to find the RenderObject at coordinates, then walk up to find the corresponding Element and extract WidgetInfo (reusing the same extraction logic as the inspect extension).

This extension is registered alongside the recording extension in `recording.dart`.

### 4.2 Selector Priority

1. **Unique text** → `page.locator({ text: '登录' })` (most common, most readable)
2. **Key** → `page.locator({ key: 'loginBtn' })` (stable, developer-defined)
3. **Type** → `page.locator({ type: 'ElevatedButton' })` (fallback)

### 4.3 Uniqueness Check

When choosing a text selector, query the inspect extension with that text. If more than one Widget matches, fall back to type selector or add ancestor context.

**Estimate**: 1 day

---

## 5. CodeGenerator

### 5.1 Output Format

Generate a complete `.test.ts` file:

```typescript
import { test, expect } from '@fliwright/vitest';

test('recorded test', async ({ page }) => {
  await page.locator({ text: '用户名' }).click();
  await page.locator({ text: '用户名' }).type('alice@test.com');
  await page.locator({ text: '密码' }).click();
  await page.locator({ text: '密码' }).type('secret123');
  await page.locator({ text: '登录' }).click();
});
```

### 5.2 Operation-to-Code Mapping

| Operation | Generated Code |
|-----------|---------------|
| `tap` | `await page.locator({ text: 'X' }).click();` |
| `longPress` | `await page.locator({ text: 'X' }).longPress({ duration: 500 });` |
| `drag` | `await page.locator({ text: 'X' }).drag(deltaX, deltaY);` |
| `type` | `await page.locator({ text: 'X' }).type('typed text');` |

### 5.3 Class

```typescript
interface CodegenOptions {
  testName?: string;        // default: 'recorded test'
  imports?: string;         // default: "@fliwright/vitest"
}

class CodeGenerator {
  generate(
    operations: RecordedOperation[],
    selectors: Map<number, string>,
    options?: CodegenOptions,
  ): string;
}
```

**Estimate**: 2 days

---

## 6. File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/fliwright-bridge/lib/src/extensions/recording.dart` | Pointer event interception + text input detection + VM Service event stream push |
| `packages/fliwright-core/src/RecorderController.ts` | Start/stop recording, event stream reception, orchestrate aggregation + codegen |
| `packages/fliwright-core/src/EventAggregator.ts` | Convert raw pointer events to high-level recorded operations |
| `packages/fliwright-core/src/CodeGenerator.ts` | Convert recorded operations + selectors to .test.ts file content |
| `packages/fliwright-bridge/test/recording_test.dart` | Dart recording extension tests |
| `packages/fliwright-core/tests/RecorderController.test.ts` | Controller tests |
| `packages/fliwright-core/tests/EventAggregator.test.ts` | Aggregation algorithm tests |
| `packages/fliwright-core/tests/CodeGenerator.test.ts` | Code generation tests |

### Modified Files

| File | Change |
|------|--------|
| `packages/fliwright-bridge/lib/src/bridge.dart` | Register recording extension |
| `packages/fliwright-bridge/lib/fliwright_bridge.dart` | Export recording extension |
| `packages/fliwright-core/src/Driver.ts` | Add `recorder` getter |
| `packages/fliwright-core/src/types.ts` | Add `RecordedOperation`, `RawInputEvent` types |
| `packages/fliwright-core/src/index.ts` | Export new classes and types |

---

## 7. Estimates Summary

| Task | Description | Days | Iteration |
|------|-------------|------|-----------|
| 5.1 | Dart: Pointer event interception + push | 2d | 5-A |
| 5.2 | TS: RecorderController + event stream | 1d | 5-A |
| 5.3 | TS: EventAggregator | 2d | 5-B |
| 5.4 | TS: Widget reverse lookup + selector strategy | 1d | 5-B |
| 5.5 | TS: CodeGenerator | 2d | 5-C |
| 5.6 | TS: Driver integration + exports | 1d | 5-C |
| 5.7 | Integration test | 2d | 5-D |
| **Total** | | **11d** | |

---

## 8. Dependencies

- Slice 0: PluginRegistry, Protocol, VM Service event stream
- Slice 1: FliwrightDriver, Locator, click/type/gesture extensions, inspect extension
- Slice 2: Assertion engine (for generated test structure)

### New NPM Dependencies

None.

---

## 9. Out of Scope

- Dart test script output (TypeScript only)
- CLI `fliwright record` command (Slice 8)
- VS Code recording UI (Slice 8)
- Multi-page/route recording (single page only)
- Recording with self-healing integration
- Screenshot/video capture during recording
