# Complete Codegen (Recorder) Design

**Date**: 2026-05-31
**Status**: Approved
**Scope**: V1.0 — Recorder exposure via CLI + MCP, enhanced selectors, assertions, multi-language output

---

## 1. Context

The recording core pipeline already exists:
- **Dart bridge**: `ext.fliwright.startRecording`, `ext.fliwright.stopRecording`, `ext.fliwright.hitTest` with pointer event capture and text input polling
- **TypeScript**: `RecorderController` (start/stop, event collection, selector resolution), `EventAggregator` (raw events → tap/longPress/drag/type operations), `CodeGenerator` (operations → test code)
- **Tests**: Comprehensive unit tests for all components

**Gap**: No user-facing entry point. The recording system works internally but cannot be triggered by developers or AI agents.

---

## 2. `fliwright record` Command

```
fliwright record [--vm-url <url>] [--output <file>] [--lang ts|dart] [--name <test-name>]
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--vm-url` | (auto-discovered) | Dart VM Service WebSocket URL |
| `--output` | stdout | Output file path (omit to print to terminal) |
| `--lang` | `ts` | Output language: `ts` (TypeScript) or `dart` |
| `--name` | `recorded test` | Test name in generated code |

### Execution Flow

1. Resolve VM Service URL (reuse existing discovery chain)
2. Connect via `FliwrightDriver`
3. Call `RecorderController.start()`
4. Enter interactive recording mode with terminal live preview
5. User interacts with Flutter app on device
6. User presses `Ctrl+C` to stop
7. Call `RecorderController.stop()` with enhanced options
8. Output generated test code to terminal or file

---

## 3. Terminal Live Preview

During recording, the terminal displays a live-updating view of captured operations:

```
🔴 Recording... (3 operations captured)

  1. tap    "Login" button (100, 200)
  2. type   "alice@test.com" → "Email" field
  3. tap    "Sign In" button (100, 350)

  Press Ctrl+C to stop recording
```

**Implementation**: The `RecorderController` emits operations via a callback as they are aggregated. The CLI command subscribes to this callback and rewrites the terminal lines using ANSI escape codes (`\x1b[A` to move up, `\x1b[K` to clear line).

**Enhanced `RecorderController`**: Add an `onOperation` callback parameter to `start()`:

```typescript
interface RecorderOptions {
  onOperation?: (operation: RecordedOperation, index: number) => void;
}
```

When a `FliwrightRecording` event arrives, the controller aggregates it and fires `onOperation` for each new aggregated operation. The CLI command uses this to update the terminal display.

---

## 4. Enhanced Selector Resolution

Current `hitTest` returns basic `{ type, text, key }`. Enhance to produce richer selectors.

### New module: `SelectorResolver`

Extracted from `RecorderController.resolveSelector()` into a dedicated module.

**Selector priority** (first match wins):
1. **Text selector**: `text: 'Login'` — if widget has unique visible text
2. **Role selector**: `role: 'button'` — map Flutter widget types to ARIA-like roles
3. **Key selector**: `key: 'loginButton'` — if widget has a named Key
4. **Type + text combo**: `type: 'ElevatedButton', text: 'Login'` — when text alone isn't unique
5. **Fallback**: `type: 'Widget'` — last resort

**Role mapping**:
```typescript
const ROLE_MAP: Record<string, string> = {
  ElevatedButton: 'button',
  TextButton: 'button',
  OutlinedButton: 'button',
  IconButton: 'button',
  TextField: 'textbox',
  TextFormField: 'textbox',
  Checkbox: 'checkbox',
  Switch: 'switch',
  Slider: 'slider',
  DropdownButton: 'combobox',
  NavigationRail: 'navigation',
  BottomNavigationBar: 'navigation',
};
```

---

## 5. Auto-Assertion Suggestions

After recording stops, analyze the operation sequence and suggest assertions.

**Rules**:
1. After a `tap` that likely navigates (detected by significant Y-position change or known navigation patterns), suggest `expect(locator).toBeVisible()` for the next visible widget
2. After a `type` into a form field followed by a submit button click, suggest checking the submission result
3. After any `tap` on a list item, suggest checking detail page content

**Output format**: Assertions are inserted as comments in the generated code:

```typescript
await page.locator({ text: 'Login' }).click();
// → Suggested assertion: await expect(page.locator({ text: 'Dashboard' })).toBeVisible();

await page.locator({ text: 'Email' }).type('alice@test.com');
await page.locator({ text: 'Sign In' }).click();
// → Suggested assertion: await expect(page.locator({ text: 'Welcome' })).toBeVisible();
```

Users can uncomment the assertions they want to keep.

---

## 6. Multi-Language Output

### TypeScript (default)

Already implemented — `import { test, expect } from '@fliwright/vitest'`.

### Dart output

New `DartCodeGenerator` class:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('login flow', (WidgetTester tester) async {
    // Tap login button
    await tester.tap(find.text('Login'));
    await tester.pumpAndSettle();

    // Type email
    await tester.enterText(find.byType(TextField), 'alice@test.com');

    // Tap sign in
    await tester.tap(find.text('Sign In'));
    await tester.pumpAndSettle();
  });
}
```

**Implementation**: Extend `CodeGenerator` with a `lang` option, or create a separate `DartCodeGenerator` class. The `CodegenOptions` type gains a `lang` field.

---

## 7. MCP Tool: `fliwright_record`

**Tool definition**:

```json
{
  "name": "fliwright_record",
  "description": "Record user interactions on a Flutter app and generate test code",
  "params": {
    "vmServiceUrl": { "type": "string", "optional": true },
    "duration": { "type": "number", "description": "Auto-stop after N seconds" },
    "testName": { "type": "string", "optional": true },
    "lang": { "type": "string", "enum": ["ts", "dart"], "optional": true }
  }
}
```

**Behavior**:
- Starts recording
- If `duration` provided, auto-stops after that many seconds
- If no `duration`, records for 30 seconds (default)
- Returns generated test code as text content

---

## 8. File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/fliwright-cli/src/commands/record.ts` | `fliwright record` command with live preview |
| Create | `packages/fliwright-cli/tests/record.test.ts` | Record command tests |
| Modify | `packages/fliwright-core/src/RecorderController.ts` | Add `onOperation` callback, enhanced options |
| Modify | `packages/fliwright-core/src/CodeGenerator.ts` | Add `lang` option for Dart output |
| Modify | `packages/fliwright-core/src/types.ts` | Add `lang` to `CodegenOptions` |
| Create | `packages/fliwright-core/src/SelectorResolver.ts` | Enhanced selector resolution with role mapping |
| Create | `packages/fliwright-core/src/DartCodeGenerator.ts` | Dart test code generation |
| Create | `packages/fliwright-core/src/AssertionSuggester.ts` | Auto-assertion suggestion logic |
| Create | `packages/fliwright-core/tests/SelectorResolver.test.ts` | Selector resolution tests |
| Create | `packages/fliwright-core/tests/DartCodeGenerator.test.ts` | Dart codegen tests |
| Create | `packages/fliwright-core/tests/AssertionSuggester.test.ts` | Assertion suggestion tests |
| Modify | `packages/fliwright-core/src/index.ts` | Export new modules |
| Create | `packages/fliwright-mcp/src/tools/record.ts` | MCP recording tool |
| Create | `packages/fliwright-mcp/tests/record.test.ts` | MCP recording tool tests |
| Modify | `packages/fliwright-mcp/src/server.ts` | Register recording tool |
| Modify | `packages/fliwright-mcp/src/types.ts` | Add recording result type |

---

## 9. Implementation Order

1. **`SelectorResolver`** — Enhanced selector logic with role mapping (core, no dependencies)
2. **`DartCodeGenerator`** — Dart output format (core, no dependencies)
3. **`AssertionSuggester`** — Auto-assertion suggestion logic (core, no dependencies)
4. **Enhance `RecorderController`** — Add `onOperation` callback
5. **Enhance `CodeGenerator`** — Support `lang` option, integrate selector resolver
6. **CLI `fliwright record`** — Command with live terminal preview
7. **MCP `fliwright_record` tool** — AI agent recording integration
8. **Integration verification** — Build + test all packages

---

## 10. Dependencies

No new external dependencies required. All new modules use existing code:

```
SelectorResolver    → uses WidgetInfo type from core
DartCodeGenerator   → uses RecordedOperation from core
AssertionSuggester  → uses RecordedOperation from core
CLI record command  → uses RecorderController + existing CLI infrastructure
MCP record tool     → uses RecorderController + existing MCP infrastructure
```
