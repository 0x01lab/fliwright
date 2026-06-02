---
feature: "Recording & Codegen Pipeline"
packages: ["@fliwright/core", "fliwright_bridge", "@fliwright/mcp", "@fliwright/vscode"]
status: implemented
agent_accessible: true
mcp_tool: "fliwright_record"
generated: "2026-06-02"
---

# Recording & Codegen Pipeline

> Capture raw pointer and text input events from a running Flutter app, aggregate them into semantic operations (tap / longPress / drag / type), resolve each to a stable selector via hit-testing, and emit a ready-to-run Vitest or Dart `integration_test` file.

## Architecture

1. **Start capture** (`RecorderController.start`): subscribes to the VM Service `Extension` event stream and calls `ext.fliwright.startRecording` on the bridge.
2. **Event emission** (bridge `RecordingExtension`): the Dart side installs pointer-event listeners and a text polling timer; each event is emitted as an `Extension` event with `kind: "FliwrightRecording"`.
3. **Aggregation** (`EventAggregator.aggregate`): converts the raw stream into `RecordedOperation`s — pointer-down/up pairs become `tap` (<500ms, <10px), `longPress` (>=500ms), or `drag` (>10px displacement); text-input events within a 1s window after a tap merge into a single `type` operation.
4. **Selector resolution** (`RecorderController.stop`): for each operation, `ext.fliwright.hitTest` finds the widget at the recorded (x,y); `SelectorResolver.resolveSelector` builds the most stable selector (preferring `key=` > `text=` > `byType=`).
5. **Code generation** (`CodeGenerator.generate` for TypeScript / `DartCodeGenerator.generate` for Dart): emits a Vitest or `integration_test` file with one statement per recorded operation plus optional auto-suggested assertions (`AssertionSuggester`).
6. **Stop capture** (`RecorderController.stop`): unsubscribes from the event stream and returns the generated source as a string.
7. **VS Code surface**: the `fliwright.startRecording` / `fliwright.stopRecording` / `fliwright.insertRecordedTest` commands wire the same pipeline into the editor.
8. **MCP surface**: the `record` MCP tool lets an agent trigger recording programmatically and receive generated code.

## Agent Integration

- **MCP**: `fliwright_record` starts/stops recording and returns the generated code.
- **VS Code**: command palette → `Fliwright: Start Recording` / `Stop Recording` / `Insert Recorded Test`.
- **Programmatic**: instantiate `RecorderController` with a `sendRequest` and `onEvent` callback.

## Data Flow

```
Flutter app (pointer/text events)
        │
        ▼
RecordingExtension (Dart) ── Extension stream ──> RecorderController
                                                       │
                                              rawEvents: RawInputEvent[]
                                                       │
                                                       ▼
                                         EventAggregator.aggregate
                                          ├── tap / longPress / drag (pointer pairs)
                                          └── type (text within 1s window)
                                                       │
                                                       ▼
                                       RecordedOperation[] + ext.fliwright.hitTest
                                                       │
                                                       ▼
                                          SelectorResolver.resolveSelector
                                                       │
                                                       ▼
                                CodeGenerator (TS) ── or ── DartCodeGenerator (Dart)
                                                       │
                                       AssertionSuggester.suggest (optional)
                                                       │
                                                       ▼
                                       generated test source (string)
```

## Key Files

- `packages/fliwright-core/src/RecorderController.ts` — orchestrates start/stop, subscription, and per-op selector resolution.
- `packages/fliwright-core/src/EventAggregator.ts` — raw event → semantic operation transform.
- `packages/fliwright-core/src/CodeGenerator.ts` — TypeScript/Vitest output.
- `packages/fliwright-core/src/DartCodeGenerator.ts` — Dart `integration_test` output.
- `packages/fliwright-core/src/AssertionSuggester.ts` — emits follow-up `expect(...)` calls after user-visible state changes.
- `packages/fliwright-core/src/SelectorResolver.ts` — builds the wire selector for each operation's widget.
- `packages/fliwright-bridge/lib/src/extensions/recording.dart` — Dart pointer listener + text polling + event emission.
- `packages/fliwright-vscode/src/recording/` — VS Code command wiring.
- `packages/fliwright-mcp/src/tools/record.ts` — MCP tool surface.
