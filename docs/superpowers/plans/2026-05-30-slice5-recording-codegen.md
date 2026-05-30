# Slice 5: Recording Loop — Codegen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record user interactions on a Flutter device and generate a complete TypeScript test file that replays those interactions using the Fliwright SDK.

**Architecture:** Dart extension intercepts pointer events + text input via `GestureBinding.pointerRouter` and `SystemChannels.textInput`, pushes them as VM Service events. TS RecorderController receives the event stream, EventAggregator converts raw events to high-level operations (tap/longPress/drag/type), hitTest extension resolves coordinates to Widget info for selector strategy, CodeGenerator produces .test.ts output.

**Tech Stack:** Dart (Flutter GestureBinding, dart:developer postEvent), TypeScript (Vitest), VM Service event stream

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/fliwright-bridge/lib/src/extensions/recording.dart` | Pointer event interception, text input detection, hitTest extension, VM Service event push |
| `packages/fliwright-bridge/test/recording_test.dart` | Dart recording + hitTest tests |
| `packages/fliwright-core/src/EventAggregator.ts` | Convert raw pointer events to high-level RecordedOperation |
| `packages/fliwright-core/src/CodeGenerator.ts` | Convert RecordedOperations + selectors to .test.ts string |
| `packages/fliwright-core/src/RecorderController.ts` | Orchestrate start/stop, event stream reception, aggregation + codegen |
| `packages/fliwright-core/tests/EventAggregator.test.ts` | Aggregation algorithm tests |
| `packages/fliwright-core/tests/CodeGenerator.test.ts` | Code generation tests |
| `packages/fliwright-core/tests/RecorderController.test.ts` | Controller tests |

### Modified Files

| File | Change |
|------|--------|
| `packages/fliwright-core/src/types.ts` | Add `RawInputEvent`, `RecordedOperation` types |
| `packages/fliwright-bridge/lib/src/bridge.dart` | Register recording extension |
| `packages/fliwright-bridge/lib/fliwright_bridge.dart` | Export recording extension |
| `packages/fliwright-core/src/Driver.ts` | Add `recorder` getter |
| `packages/fliwright-core/src/index.ts` | Export new classes and types |

---

## Task 1: Types — RawInputEvent and RecordedOperation

**Files:**
- Modify: `packages/fliwright-core/src/types.ts`

- [ ] **Step 1: Add types to types.ts**

Append these interfaces at the end of `packages/fliwright-core/src/types.ts`:

```typescript
export interface RawInputEvent {
  type: 'pointerEvent' | 'textInput';
  kind?: 'down' | 'move' | 'up';
  pointer?: number;
  position?: { x: number; y: number };
  timestamp: number;
  buttons?: number;
  text?: string;
}

export interface RecordedOperation {
  kind: 'tap' | 'longPress' | 'drag' | 'type';
  position: { x: number; y: number };
  delta?: { x: number; y: number };
  text?: string;
  duration?: number;
  timestamp: number;
}

export interface CodegenOptions {
  testName?: string;
  imports?: string;
}
```

- [ ] **Step 2: Run existing tests**

Run: `cd packages/fliwright-core && npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/fliwright-core/src/types.ts
git commit -m "feat(core): add RawInputEvent, RecordedOperation, CodegenOptions types"
```

---

## Task 2: Dart Recording Extension — Event Interception + hitTest

**Files:**
- Create: `packages/fliwright-bridge/lib/src/extensions/recording.dart`
- Create: `packages/fliwright-bridge/test/recording_test.dart`
- Modify: `packages/fliwright-bridge/lib/src/bridge.dart`
- Modify: `packages/fliwright-bridge/lib/fliwright_bridge.dart`

- [ ] **Step 1: Write the failing test**

```dart
// packages/fliwright-bridge/test/recording_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  group('RecordingExtension', () {
    setUp(() async {
      await FliwrightBridge.reset();
    });

    test('registers startRecording and stopRecording on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.startRecording'));
      expect(methods, contains('ext.fliwright.stopRecording'));
    });

    test('registers hitTest extension on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.hitTest'));
    });

    test('startRecording returns success', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.startRecording',
        {},
      );
      expect(result['recording'], isTrue);
    });

    test('stopRecording returns success after start', () async {
      await FliwrightBridge.init();
      await FliwrightBridge.registry.invoke('ext.fliwright.startRecording', {});
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.stopRecording',
        {},
      );
      expect(result['recording'], isFalse);
    });

    test('hitTest returns empty widget when no tree', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.hitTest',
        {'x': '100', 'y': '200'},
      );
      expect(result, contains('widget'));
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/fliwright-bridge && flutter test test/recording_test.dart`
Expected: FAIL — extensions not registered

- [ ] **Step 3: Write the recording extension**

```dart
// packages/fliwright-bridge/lib/src/extensions/recording.dart
import 'dart:developer';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../bridge.dart';
import 'inspect.dart';

class RecordingExtension {
  static bool _recording = false;
  static PointerRoute? _pointerRoute;
  static void Function(MessageHandler)? _textInputListener;

  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.startRecording', _startRecording);
    registry.register('ext.fliwright.stopRecording', _stopRecording);
    registry.register('ext.fliwright.hitTest', _hitTest);
  }

  static Future<Map<String, dynamic>> _startRecording(
    Map<String, String> params,
  ) async {
    if (_recording) return {'recording': true};

    _recording = true;

    _pointerRoute = (PointerEvent event) {
      if (!_recording) return;
      String kind;
      if (event is PointerDownEvent) {
        kind = 'down';
      } else if (event is PointerMoveEvent) {
        kind = 'move';
      } else if (event is PointerUpEvent) {
        kind = 'up';
      } else {
        return;
      }
      postEvent('FliwrightRecording', {
        'type': 'pointerEvent',
        'kind': kind,
        'pointer': event.pointer,
        'position': {'x': event.position.dx, 'y': event.position.dy},
        'timestamp': event.timeStamp.inMicroseconds,
        'buttons': event.buttons,
      });
    };
    GestureBinding.instance.pointerRouter.addGlobalRoute(_pointerRoute!);

    return {'recording': true};
  }

  static Future<Map<String, dynamic>> _stopRecording(
    Map<String, String> params,
  ) async {
    if (_pointerRoute != null) {
      GestureBinding.instance.pointerRouter.removeGlobalRoute(_pointerRoute!);
      _pointerRoute = null;
    }
    _recording = false;
    return {'recording': false};
  }

  static Future<Map<String, dynamic>> _hitTest(
    Map<String, String> params,
  ) async {
    final x = double.tryParse(params['x'] ?? '') ?? 0.0;
    final y = double.tryParse(params['y'] ?? '') ?? 0.0;

    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {'widget': <String, dynamic>{}};
    }

    Element? hitElement;
    _walkTree(root, (Element element) {
      final renderObject = element.findRenderObject();
      if (renderObject is RenderBox && renderObject.hasSize) {
        final topLeft = renderObject.localToGlobal(Offset.zero);
        final size = renderObject.size;
        final rect = Rect.fromLTWH(topLeft.dx, topLeft.dy, size.width, size.height);
        if (rect.contains(Offset(x, y))) {
          hitElement = element;
        }
      }
    });

    if (hitElement == null) {
      return {'widget': <String, dynamic>{}};
    }

    // Walk up to find the most specific interactive or meaningful widget.
    Element? target = hitElement;
    Element? best = hitElement;
    target.visitAncestorElements((Element ancestor) {
      final widget = ancestor.widget;
      if (widget is! RichText && widget is! Text && widget is! Semantics) {
        best = ancestor;
        return false;
      }
      return true;
    });

    final info = InspectExtension._extractWidgetInfo(best!);
    return {'widget': info};
  }

  static void _walkTree(Element root, void Function(Element) visitor) {
    visitor(root);
    root.debugVisitOnstageChildren((Element child) {
      _walkTree(child, visitor);
    });
  }
}
```

Note: `_extractWidgetInfo` on `InspectExtension` is currently private. It needs to be made accessible. The simplest approach is to make it a package-private static method (remove underscore) or expose it. Since both extensions are in the same package, we can reference it directly if we change `_extractWidgetInfo` to `extractWidgetInfo` (remove leading underscore) in `inspect.dart`.

- [ ] **Step 4: Make InspectExtension._extractWidgetInfo accessible**

In `packages/fliwright-bridge/lib/src/extensions/inspect.dart`, rename `_extractWidgetInfo` to `extractWidgetInfo` (remove the underscore) and rename `_walkTree` to `walkTree` and `_ParsedSelector` to `ParsedSelector` as well (to be consistent — all are used by recording.dart now). Update all internal references in inspect.dart.

- [ ] **Step 5: Register in bridge.dart**

In `packages/fliwright-bridge/lib/src/bridge.dart`:

Add import:
```dart
import 'extensions/recording.dart';
```

Add registration after `SnapshotExtension.register(_registry);`:
```dart
RecordingExtension.register(_registry);
```

- [ ] **Step 6: Export in fliwright_bridge.dart**

Add: `export 'src/extensions/recording.dart';`

- [ ] **Step 7: Run tests**

Run: `cd packages/fliwright-bridge && flutter test`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add packages/fliwright-bridge/lib/src/extensions/recording.dart \
  packages/fliwright-bridge/lib/src/extensions/inspect.dart \
  packages/fliwright-bridge/lib/src/bridge.dart \
  packages/fliwright-bridge/lib/fliwright_bridge.dart \
  packages/fliwright-bridge/test/recording_test.dart
git commit -m "feat(bridge): add recording extension with pointer event interception and hitTest"
```

---

## Task 3: EventAggregator — Gesture Recognition

**Files:**
- Create: `packages/fliwright-core/src/EventAggregator.ts`
- Test: `packages/fliwright-core/tests/EventAggregator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/fliwright-core/tests/EventAggregator.test.ts
import { describe, it, expect } from 'vitest';
import { EventAggregator } from '../src/EventAggregator.js';
import type { RawInputEvent, RecordedOperation } from '../src/types.js';

describe('EventAggregator', () => {
  it('returns empty array for no events', () => {
    const agg = new EventAggregator();
    expect(agg.aggregate([])).toEqual([]);
  });

  it('recognizes a tap (down + up, short duration, small displacement)', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100, buttons: 0 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('tap');
    expect(ops[0].position).toEqual({ x: 100, y: 200 });
  });

  it('recognizes a long press (down + up, long duration)', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 2000, buttons: 0 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('longPress');
    expect(ops[0].duration).toBe(1000);
  });

  it('recognizes a drag (down + moves + up, large displacement)', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
      { type: 'pointerEvent', kind: 'move', pointer: 0, position: { x: 150, y: 250 }, timestamp: 1050, buttons: 1 },
      { type: 'pointerEvent', kind: 'move', pointer: 0, position: { x: 200, y: 300 }, timestamp: 1100, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 200, y: 300 }, timestamp: 1200, buttons: 0 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('drag');
    expect(ops[0].delta).toEqual({ x: 100, y: 100 });
  });

  it('recognizes a type operation (tap followed by textInput)', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100, buttons: 0 },
      { type: 'textInput', text: 'hello', timestamp: 1500 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('type');
    expect(ops[0].text).toBe('hello');
    expect(ops[0].position).toEqual({ x: 100, y: 200 });
  });

  it('recognizes multiple taps as separate operations', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100, buttons: 0 },
      { type: 'pointerEvent', kind: 'down', pointer: 1, position: { x: 300, y: 400 }, timestamp: 2000, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 1, position: { x: 300, y: 400 }, timestamp: 2100, buttons: 0 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(2);
    expect(ops[0].kind).toBe('tap');
    expect(ops[1].kind).toBe('tap');
    expect(ops[1].position).toEqual({ x: 300, y: 400 });
  });

  it('ignores move events without displacement', () => {
    const agg = new EventAggregator();
    const events: RawInputEvent[] = [
      { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1000, buttons: 1 },
      { type: 'pointerEvent', kind: 'move', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1050, buttons: 1 },
      { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 100, y: 200 }, timestamp: 1100, buttons: 0 },
    ];
    const ops = agg.aggregate(events);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('tap');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/fliwright-core && npx vitest run tests/EventAggregator.test.ts`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Write EventAggregator implementation**

```typescript
// packages/fliwright-core/src/EventAggregator.ts
import type { RawInputEvent, RecordedOperation } from './types.js';

const TAP_MAX_DURATION = 500;
const TAP_MAX_DISPLACEMENT = 10;
const TYPE_INPUT_WINDOW = 1000;

export class EventAggregator {
  aggregate(events: RawInputEvent[]): RecordedOperation[] {
    const pointerEvents = events.filter((e) => e.type === 'pointerEvent');
    const textEvents = events.filter((e) => e.type === 'textInput');

    // Group pointer events by pointer ID.
    const groups = new Map<number, RawInputEvent[]>();
    for (const event of pointerEvents) {
      const id = event.pointer ?? 0;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id)!.push(event);
    }

    const operations: RecordedOperation[] = [];

    for (const [, group] of groups) {
      const down = group.find((e) => e.kind === 'down');
      const up = group.find((e) => e.kind === 'up');
      if (!down || !up || !down.position || !up.position) continue;

      const duration = up.timestamp - down.timestamp;
      const displacement = Math.sqrt(
        (up.position.x - down.position.x) ** 2 +
        (up.position.y - down.position.y) ** 2,
      );

      if (displacement > TAP_MAX_DISPLACEMENT) {
        // Drag
        operations.push({
          kind: 'drag',
          position: { x: down.position.x, y: down.position.y },
          delta: {
            x: Math.round(up.position.x - down.position.x),
            y: Math.round(up.position.y - down.position.y),
          },
          timestamp: down.timestamp,
        });
      } else if (duration >= TAP_MAX_DURATION) {
        // Long press
        operations.push({
          kind: 'longPress',
          position: { x: down.position.x, y: down.position.y },
          duration,
          timestamp: down.timestamp,
        });
      } else {
        // Potential tap — check if text input follows
        const pos = { x: down.position.x, y: down.position.y };
        const textEvent = textEvents.find(
          (te) => te.timestamp >= down.timestamp && te.timestamp <= down.timestamp + TYPE_INPUT_WINDOW,
        );

        if (textEvent && textEvent.text) {
          operations.push({
            kind: 'type',
            position: pos,
            text: textEvent.text,
            timestamp: down.timestamp,
          });
        } else {
          operations.push({
            kind: 'tap',
            position: pos,
            timestamp: down.timestamp,
          });
        }
      }
    }

    // Sort by timestamp.
    operations.sort((a, b) => a.timestamp - b.timestamp);
    return operations;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/fliwright-core && npx vitest run tests/EventAggregator.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-core/src/EventAggregator.ts packages/fliwright-core/tests/EventAggregator.test.ts
git commit -m "feat(core): add EventAggregator for gesture recognition from raw pointer events"
```

---

## Task 4: CodeGenerator — Test Script Output

**Files:**
- Create: `packages/fliwright-core/src/CodeGenerator.ts`
- Test: `packages/fliwright-core/tests/CodeGenerator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/fliwright-core/tests/CodeGenerator.test.ts
import { describe, it, expect } from 'vitest';
import { CodeGenerator } from '../src/CodeGenerator.js';
import type { RecordedOperation } from '../src/types.js';

function tap(x: number, y: number, ts: number): RecordedOperation {
  return { kind: 'tap', position: { x, y }, timestamp: ts };
}

function typeOp(x: number, y: number, text: string, ts: number): RecordedOperation {
  return { kind: 'type', position: { x, y }, text, timestamp: ts };
}

function longPress(x: number, y: number, duration: number, ts: number): RecordedOperation {
  return { kind: 'longPress', position: { x, y }, duration, timestamp: ts };
}

function drag(x: number, y: number, dx: number, dy: number, ts: number): RecordedOperation {
  return { kind: 'drag', position: { x, y }, delta: { x: dx, y: dy }, timestamp: ts };
}

describe('CodeGenerator', () => {
  it('generates a complete test file with imports', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [tap(100, 200, 1000)];
    const selectors = new Map<number, string>([[0, "{ text: 'Login' }"]]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain("import { test, expect } from '@fliwright/vitest'");
    expect(code).toContain("test('recorded test'");
    expect(code).toContain("page.locator({ text: 'Login' }).click()");
  });

  it('generates type operations', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [typeOp(100, 200, 'alice@test.com', 1000)];
    const selectors = new Map<number, string>([[0, "{ text: 'Email' }"]]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ text: 'Email' }).type('alice@test.com')");
  });

  it('generates longPress operations with duration', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [longPress(100, 200, 500, 1000)];
    const selectors = new Map<number, string>([[0, "{ text: 'Card' }"]]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ text: 'Card' }).longPress({ duration: 500 })");
  });

  it('generates drag operations with delta', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [drag(100, 200, 50, -30, 1000)];
    const selectors = new Map<number, string>([[0, "{ text: 'Slider' }"]]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ text: 'Slider' }).drag(50, -30)");
  });

  it('uses custom test name', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [tap(100, 200, 1000)];
    const selectors = new Map<number, string>([[0, "{ text: 'Btn' }"]]);
    const code = gen.generate(ops, selectors, { testName: 'login flow' });
    expect(code).toContain("test('login flow'");
  });

  it('falls back to type selector when no selector provided', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000 },
    ];
    const selectors = new Map<number, string>();
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ type: 'Widget' })");
  });

  it('generates multiple operations in sequence', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [
      tap(100, 200, 1000),
      tap(100, 300, 2000),
    ];
    const selectors = new Map<number, string>([
      [0, "{ text: 'User' }"],
      [1, "{ text: 'Pass' }"],
    ]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ text: 'User' }).click()");
    expect(code).toContain("page.locator({ text: 'Pass' }).click()");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/fliwright-core && npx vitest run tests/CodeGenerator.test.ts`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Write CodeGenerator implementation**

```typescript
// packages/fliwright-core/src/CodeGenerator.ts
import type { RecordedOperation, CodegenOptions } from './types.js';

const DEFAULT_IMPORT = "@fliwright/vitest";
const DEFAULT_TEST_NAME = 'recorded test';

export class CodeGenerator {
  generate(
    operations: RecordedOperation[],
    selectors: Map<number, string>,
    options?: CodegenOptions,
  ): string {
    const importSource = options?.imports ?? DEFAULT_IMPORT;
    const testName = options?.testName ?? DEFAULT_TEST_NAME;

    const lines: string[] = [];
    lines.push(`import { test, expect } from '${importSource}';`);
    lines.push('');
    lines.push(`test('${testName}', async ({ page }) => {`);

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const selector = selectors.get(i) ?? "{ type: 'Widget' }";
      const locator = `page.locator(${selector})`;

      switch (op.kind) {
        case 'tap':
          lines.push(`  await ${locator}.click();`);
          break;
        case 'longPress':
          lines.push(`  await ${locator}.longPress({ duration: ${op.duration} });`);
          break;
        case 'drag':
          lines.push(`  await ${locator}.drag(${op.delta!.x}, ${op.delta!.y});`);
          break;
        case 'type':
          lines.push(`  await ${locator}.type('${escapeString(op.text ?? '')}');`);
          break;
      }
    }

    lines.push('});');
    return lines.join('\n');
  }
}

function escapeString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/fliwright-core && npx vitest run tests/CodeGenerator.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-core/src/CodeGenerator.ts packages/fliwright-core/tests/CodeGenerator.test.ts
git commit -m "feat(core): add CodeGenerator for converting recorded operations to .test.ts"
```

---

## Task 5: RecorderController — Orchestration

**Files:**
- Create: `packages/fliwright-core/src/RecorderController.ts`
- Test: `packages/fliwright-core/tests/RecorderController.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/fliwright-core/tests/RecorderController.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecorderController } from '../src/RecorderController.js';
import type { RawInputEvent } from '../src/types.js';

describe('RecorderController', () => {
  it('start sends startRecording to Dart', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ recording: true });
    const onEvent = vi.fn().mockReturnValue(() => {});
    const controller = new RecorderController(sendRequest, onEvent);
    await controller.start();
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.startRecording', {});
  });

  it('stop sends stopRecording to Dart and generates code', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.startRecording') return Promise.resolve({ recording: true });
      if (method === 'ext.fliwright.stopRecording') return Promise.resolve({ recording: false });
      if (method === 'ext.fliwright.hitTest') return Promise.resolve({
        widget: { id: '1', type: 'ElevatedButton', text: 'Login', rect: { x: 0, y: 0, width: 100, height: 40 }, properties: {} },
      });
      return Promise.resolve({});
    });
    let eventCallback: ((e: any) => void) | null = null;
    const onEvent = vi.fn().mockImplementation((cb: any) => {
      eventCallback = cb;
      return () => { eventCallback = null; };
    });

    const controller = new RecorderController(sendRequest, onEvent);
    await controller.start();

    // Simulate receiving raw events.
    if (eventCallback) {
      eventCallback({
        kind: 'FliwrightRecording',
        timestamp: Date.now(),
        data: {
          type: 'pointerEvent',
          kind: 'down',
          pointer: 0,
          position: { x: 100, y: 200 },
          timestamp: 1000,
          buttons: 1,
        },
      });
      eventCallback({
        kind: 'FliwrightRecording',
        timestamp: Date.now(),
        data: {
          type: 'pointerEvent',
          kind: 'up',
          pointer: 0,
          position: { x: 100, y: 200 },
          timestamp: 1100,
          buttons: 0,
        },
      });
    }

    const code = await controller.stop();
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.stopRecording', {});
    expect(code).toContain("import { test, expect } from '@fliwright/vitest'");
    expect(code).toContain("page.locator({ text: 'Login' }).click()");
  });

  it('getOperations returns aggregated operations after stop', async () => {
    const sendRequest = vi.fn().mockResolvedValue({});
    let eventCallback: ((e: any) => void) | null = null;
    const onEvent = vi.fn().mockImplementation((cb: any) => {
      eventCallback = cb;
      return () => {};
    });

    const controller = new RecorderController(sendRequest, onEvent);
    await controller.start();

    if (eventCallback) {
      eventCallback({
        kind: 'FliwrightRecording',
        timestamp: Date.now(),
        data: { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 50, y: 60 }, timestamp: 1000, buttons: 1 },
      });
      eventCallback({
        kind: 'FliwrightRecording',
        timestamp: Date.now(),
        data: { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 50, y: 60 }, timestamp: 1100, buttons: 0 },
      });
    }

    await controller.stop();
    const ops = controller.getOperations();
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('tap');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/fliwright-core && npx vitest run tests/RecorderController.test.ts`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Write RecorderController implementation**

```typescript
// packages/fliwright-core/src/RecorderController.ts
import { EventAggregator } from './EventAggregator.js';
import { CodeGenerator } from './CodeGenerator.js';
import type { RawInputEvent, RecordedOperation, WidgetInfo } from './types.js';

type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
type OnEvent = (callback: (event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) => () => void;

export class RecorderController {
  private sendRequest: SendRequest;
  private onEvent: OnEvent;
  private rawEvents: RawInputEvent[] = [];
  private operations: RecordedOperation[] = [];
  private unsubscribe: (() => void) | null = null;

  constructor(sendRequest: SendRequest, onEvent: OnEvent) {
    this.sendRequest = sendRequest;
    this.onEvent = onEvent;
  }

  async start(): Promise<void> {
    this.rawEvents = [];
    this.operations = [];
    await this.sendRequest('ext.fliwright.startRecording', {});

    this.unsubscribe = this.onEvent((event) => {
      if (event.kind === 'FliwrightRecording' && event.data) {
        this.rawEvents.push(event.data as unknown as RawInputEvent);
      }
    });
  }

  async stop(): Promise<string> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    await this.sendRequest('ext.fliwright.stopRecording', {});

    // Aggregate raw events to operations.
    const aggregator = new EventAggregator();
    this.operations = aggregator.aggregate(this.rawEvents);

    // Resolve selectors via hitTest for each operation.
    const selectors = new Map<number, string>();
    for (let i = 0; i < this.operations.length; i++) {
      const op = this.operations[i];
      const selector = await this.resolveSelector(op);
      selectors.set(i, selector);
    }

    // Generate code.
    const generator = new CodeGenerator();
    return generator.generate(this.operations, selectors);
  }

  getOperations(): RecordedOperation[] {
    return [...this.operations];
  }

  private async resolveSelector(op: RecordedOperation): Promise<string> {
    try {
      const result = await this.sendRequest('ext.fliwright.hitTest', {
        x: op.position.x,
        y: op.position.y,
      }) as { widget?: WidgetInfo };

      const widget = result.widget;
      if (!widget || !widget.type) return "{ type: 'Widget' }";

      // Priority: unique text > key > type.
      if (widget.text) {
        return `{ text: '${widget.text.replace(/'/g, "\\'")}' }`;
      }
      if (widget.key) {
        return `{ key: '${widget.key.replace(/'/g, "\\'")}' }`;
      }
      return `{ type: '${widget.type}' }`;
    } catch {
      return "{ type: 'Widget' }";
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/fliwright-core && npx vitest run tests/RecorderController.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-core/src/RecorderController.ts packages/fliwright-core/tests/RecorderController.test.ts
git commit -m "feat(core): add RecorderController orchestrating recording, aggregation, and codegen"
```

---

## Task 6: Driver Integration + Exports

**Files:**
- Modify: `packages/fliwright-core/src/Driver.ts`
- Modify: `packages/fliwright-core/src/index.ts`
- Modify: `packages/fliwright-core/tests/Driver.test.ts`

- [ ] **Step 1: Add recorder getter to Driver**

In `packages/fliwright-core/src/Driver.ts`:

Add import:
```typescript
import { RecorderController } from './RecorderController.js';
```

Add private field:
```typescript
private _recorder: RecorderController | null = null;
```

Add getter after the `healing` getter:
```typescript
  get recorder(): RecorderController {
    if (!this._recorder) {
      this._recorder = new RecorderController(
        (method, params) => this.connector.sendRequest(method, params),
        (cb) => this.connector.onEvent(cb),
      );
    }
    return this._recorder;
  }
```

- [ ] **Step 2: Add exports to index.ts**

In `packages/fliwright-core/src/index.ts`:

Add to type exports section:
```typescript
  RawInputEvent,
  RecordedOperation,
  CodegenOptions,
```

Add to value exports section:
```typescript
export { EventAggregator } from './EventAggregator.js';
export { CodeGenerator } from './CodeGenerator.js';
export { RecorderController } from './RecorderController.js';
```

- [ ] **Step 3: Add Driver test for recorder getter**

In `packages/fliwright-core/tests/Driver.test.ts`, add at the end of the describe block:

```typescript
  it('provides recorder via convenience getter', async () => {
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(createMockWSForDriver());
    const recorder = driver.recorder;
    expect(recorder).toBeDefined();
  });
```

- [ ] **Step 4: Run full test suite**

Run: `cd packages/fliwright-core && npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-core/src/Driver.ts packages/fliwright-core/src/index.ts packages/fliwright-core/tests/Driver.test.ts
git commit -m "feat(core): integrate RecorderController into Driver, export new modules"
```

---

## Task 7: Full Test Suite + Final Verification

**Files:** None new

- [ ] **Step 1: Run complete TS test suite**

Run: `cd packages/fliwright-core && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run TypeScript type check**

Run: `cd packages/fliwright-core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify file structure matches spec**

Run: `cd /Volumes/HIKSEMI/project/fliwright && find packages/ \( -name "EventAggregator*" -o -name "CodeGenerator*" -o -name "RecorderController*" -o -name "recording.dart" -o -name "recording_test.dart" \) ! -path "*/node_modules/*" ! -path "*/dist/*" | sort`

Expected:
```
packages/fliwright-bridge/lib/src/extensions/recording.dart
packages/fliwright-bridge/test/recording_test.dart
packages/fliwright-core/src/CodeGenerator.ts
packages/fliwright-core/src/EventAggregator.ts
packages/fliwright-core/src/RecorderController.ts
packages/fliwright-core/tests/CodeGenerator.test.ts
packages/fliwright-core/tests/EventAggregator.test.ts
packages/fliwright-core/tests/RecorderController.test.ts
```
