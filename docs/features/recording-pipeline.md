---
feature: "Recording & Codegen Pipeline"
packages: ["@fliwright/core", "fliwright-bridge", "@fliwright/mcp", "@fliwright/cli"]
status: implemented
agent_accessible: true
mcp_tool: "fliwright_record"
generated: "2026-06-01"
---

# Recording & Codegen Pipeline

> Records user interactions on a Flutter app and generates runnable test code.

## Architecture

1. **RecorderController** (`RecorderController`): Manages recording sessions — start, stop, code generation.
2. **RecordingExtension** (Dart bridge): Captures pointer events and text input via VM service streams.
3. **EventAggregator** (`EventAggregator`): Converts raw events into semantic operations (tap, longPress, drag, type).
4. **CodeGenerator** (`CodeGenerator`): Generates TypeScript/Vitest test code from operations.
5. **DartCodeGenerator** (`DartCodeGenerator`): Generates Dart integration_test code.
6. **AssertionSuggester** (`AssertionSuggester`): Suggests assertion insertion points based on operation patterns.
7. **SelectorResolver** (`SelectorResolver`): Resolves widget info to selector strings with role mapping.

## Agent Integration

AI agents can use `fliwright_record` to start a recording session with configurable duration and language. The tool returns generated test code ready for review and editing.

## Data Flow

```
RecorderController.start()
    │
    ▼
Bridge: ext.fliwright.startRecording
    │
    ├── PointerRoute → FliwrightRecording events (pointerEvent)
    └── 50ms Timer → FliwrightRecording events (textInput)
    │
    ▼
VM Service Stream → VMServiceConnector.onEvent()
    │
    ▼
EventAggregator.aggregate()
    │
    ├── Classify pointer pairs: tap / longPress / drag
    ├── Merge textInput events with nearby operations
    │
    ▼
RecordedOperation[] → RecorderController.stop()
    │
    ├── Resolve selectors via SelectorResolver
    ├── AssertionSuggester.suggest() → assertion templates
    │
    ▼
CodeGenerator.generate() or DartCodeGenerator.generate()
    │
    ▼
Generated test code (TypeScript or Dart)
```

## Key Files

- `packages/fliwright-core/src/RecorderController.ts` — Recording orchestrator
- `packages/fliwright-core/src/EventAggregator.ts` — Raw event → operation conversion
- `packages/fliwright-core/src/CodeGenerator.ts` — TypeScript code generation
- `packages/fliwright-core/src/DartCodeGenerator.ts` — Dart code generation
- `packages/fliwright-core/src/AssertionSuggester.ts` — Assertion suggestions
- `packages/fliwright-core/src/SelectorResolver.ts` — Selector resolution with roles
- `packages/fliwright-bridge/lib/src/extensions/recording.dart` — Dart-side event capture
