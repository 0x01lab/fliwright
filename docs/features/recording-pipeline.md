---
feature: "Recording & Code Generation Pipeline"
packages: ["@fliwright/core", "fliwright-bridge"]
status: implemented
agent_accessible: true
mcp_tool: "fliwright_record"
generated: "2026-06-02"
---

# Recording & Code Generation Pipeline

> Records user interactions on a Flutter app, aggregates raw events into semantic operations, resolves selectors, and generates executable test code in TypeScript or Dart.

## Architecture

1. **Start Recording** (`RecorderController`): Calls `ext.fliwright.startRecording` and subscribes to the `Extension` stream for `FliwrightRecording` events.

2. **Capture Events** (`RecordingExtension`): The Dart bridge captures `PointerDownEvent`/`PointerMoveEvent`/`PointerUpEvent` via `PointerRouter` and polls `EditableText` widgets for text changes.

3. **Aggregate Events** (`EventAggregator`): Raw pointer events are classified:
   - **Tap**: down→up within 500ms, displacement < 10px
   - **Long press**: down→up ≥ 500ms, displacement < 10px
   - **Drag**: displacement ≥ 10px
   Raw text events are merged with preceding tap operations within a 1000ms window.

4. **Resolve Selectors** (`RecorderController`): For each operation, calls `ext.fliwright.hitTest` at the recorded position to get the widget, then `resolveSelector()` to generate a selector string (text > key > role > type).

5. **Generate Code** (`CodeGenerator` / `DartCodeGenerator`): Converts operations + selectors into a complete test file. TypeScript uses `@fliwright/vitest`; Dart uses `integration_test`.

6. **Suggest Assertions** (`AssertionSuggester`): Analyzes operations for heuristic patterns (navigation taps, form submissions, list selections, page changes) and adds assertion comments.

## Agent Integration

AI agents can record interactions through:
- **`fliwright_record`**: Records for a specified duration (default 30s) and returns generated test code
- **CLI `fliwright record`**: Interactive recording with Ctrl+C stop

## Data Flow

```
User Interactions on Flutter App
    │
    ▼
RecordingExtension (Dart)
    ├── PointerRouter → pointer events (down/move/up)
    └── EditableText polling → text changes
    │
    ▼ (Extension stream: FliwrightRecording)
RecorderController (Node.js)
    │
    ├── Raw events stored
    │
    ▼
EventAggregator.aggregate()
    ├── Classify pointer events → tap / longPress / drag
    ├── Merge text events with taps → type
    └── Sort by timestamp
    │
    ▼
Hit Test Resolution (per operation)
    ├── ext.fliwright.hitTest(x, y) → WidgetInfo
    └── resolveSelector() → "text='Submit'" / "{ key: 'btn' }" / etc.
    │
    ▼
CodeGenerator.generate() / DartCodeGenerator.generate()
    │
    ├── TypeScript: @fliwright/vitest test file
    └── Dart: integration_test file
    │
    ▼
AssertionSuggester.suggest()
    └── Assertion comment suggestions
```

## Key Files

- `packages/fliwright-core/src/RecorderController.ts` — Recording lifecycle
- `packages/fliwright-core/src/EventAggregator.ts` — Raw event → semantic operation
- `packages/fliwright-core/src/CodeGenerator.ts` — TypeScript code generation
- `packages/fliwright-core/src/DartCodeGenerator.ts` — Dart code generation
- `packages/fliwright-core/src/AssertionSuggester.ts` — Assertion heuristic suggestions
- `packages/fliwright-core/src/SelectorResolver.ts` — Widget → selector resolution
- `packages/fliwright-bridge/lib/src/extensions/recording.dart` — Dart-side event capture
