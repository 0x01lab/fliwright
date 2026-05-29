# Slice 2: Assertion Loop — Complete Test Cases

**Date**: 2026-05-29
**Status**: Approved
**Depends on**: Slice 1 (Minimal Remote Click Loop)

---

## Goal

Write complete end-to-end test cases with assertions and auto-wait. After Slice 2, a developer can write a Vitest test that types into forms, scrolls pages, performs gestures, and asserts on UI state — all through the Fliwright SDK.

---

## Delivery Approach: Vertical Slice Iteration

Four iterations, each delivering a demoable end-to-end capability:

| Iteration | Scope | User Gets |
|-----------|-------|-----------|
| 2-A | Type extension + Assertion engine | "Type text → verify visible" end-to-end |
| 2-B | Scroll extension + Extended selectors | "Scroll to element → assert" end-to-end |
| 2-C | Gesture extension + Failure context | "Long press/drag/pinch → assert with screenshot on failure" |
| 2-D | Vitest integration | Full test lifecycle with fixtures and reporters |

---

## 1. Dart Extensions

### 1.1 Type Extension — `ext.fliwright.type`

**Purpose**: Input text into a target Widget, triggering full form validation chain.

**Implementation**:
1. Use inspect to locate target Widget, get RenderBox coordinates
2. Execute tap to focus (trigger FocusNode)
3. Simulate keyboard input via `SystemChannels.textInput` — not direct `TextEditingValue` mutation, to ensure validators fire
4. Support `replaceAll` mode (clear existing text first) and `duration` parameter for character-by-character typing

**Protocol**:

```json
// Request
{
  "selector": { "text": "用户名" },
  "text": "leo@example.com",
  "replaceAll": true,
  "charDelay": 0
}

// Response
{
  "success": true,
  "currentText": "leo@example.com"
}
```

**Estimate**: 1 day

### 1.2 Scroll Extension — `ext.fliwright.scrollIntoView`

**Purpose**: Scroll target Widget into viewport.

**Implementation**:
1. Locate target Widget via inspect
2. Check visibility using `RenderBox.paintBounds` vs `RenderAbstractViewport`
3. If not visible, use `Scrollable.ensureVisible()` with configurable alignment and duration
4. Support `alignment` parameter (0.0 = top, 1.0 = bottom, default 0.5 center)

**Protocol**:

```json
// Request
{
  "selector": { "text": "提交" },
  "alignment": 0.5,
  "duration": 300
}

// Response
{
  "success": true,
  "scrolled": true,
  "offset": 240.0
}
```

**Estimate**: 1 day

### 1.3 Gesture Extension — `ext.fliwright.gesture`

**Purpose**: Execute complex gesture operations.

**Implementation**: Based on `GestureBinding` arena mechanism.

**Supported gestures**:

| Gesture | Sequence | Parameters |
|---------|----------|------------|
| longPress | down → wait (default 500ms) → up | `selector`, `duration` |
| drag | down → move series → up | `selector`, `deltaX`, `deltaY`, `steps` (default 10) |
| pinch | two-finger down → two-finger move → two-finger up | `selector`, `scale`, `focalPoint` |

**Protocol**:

```json
// Request
{
  "selector": { "text": "卡片" },
  "gesture": "longPress",
  "params": { "duration": 500 }
}

// Response
{
  "success": true,
  "gesture": "longPress"
}
```

**Estimate**: 2 days

---

## 2. TypeScript Assertion Engine

### 2.1 API Design (Playwright-style)

```typescript
// Basic usage
await expect(locator).toBeVisible();
await expect(locator).not.toBeVisible();
await expect(locator).toHaveText('Hello');
await expect(locator).toContainText('Hello');
await expect(locator).toBeEnabled();
await expect(locator).toBeDisabled();

// Custom timeout
await expect(locator).toBeVisible({ timeout: 10000 });
```

### 2.2 Auto-Wait Polling Mechanism

```
expect() call
  → Create Assertion instance
    → Start polling loop (interval: 100ms, timeout: 5000ms)
      → Each poll:
        1. Call locator's inspect query
        2. Evaluate matcher condition
        3. Pass → return success
        4. Fail + not timed out → wait 100ms, retry
        5. Timeout → collect failure context → throw AssertionError
```

**Defaults**:
- `timeout`: 5000ms (configurable per-assertion or globally)
- `interval`: 100ms (configurable globally)

### 2.3 Class Structure

```
Assertion
  ├─ locator: Locator          // Target being asserted
  ├─ isNegated: boolean        // .not inversion
  ├─ timeout: number           // Default 5000ms
  ├─ interval: number          // Default 100ms
  │
  ├─ toBeVisible()             // Widget exists and visible
  ├─ toHaveText(text)          // Exact text match
  ├─ toContainText(text)       // Contains text
  ├─ toBeEnabled()             // Widget is interactive
  └─ not → Assertion           // Returns negated copy
```

**Assertion failure behavior**:
1. Trigger screenshot via VM Service
2. Collect current Widget tree snapshot
3. Package as structured `AssertionError` containing expected vs actual, screenshot path, Widget tree JSON, timeout

**Estimate**: 3 days

---

## 3. Extended Selectors

Slice 1 has text selector (`byText`). Slice 2 adds:

```typescript
// Slice 1 existing
page.locator({ text: '登录' });

// Slice 2 new
page.locator({ key: 'login_button' });           // byKey — match Key('login_button')
page.locator({ type: 'ElevatedButton' });         // byType — match Widget type

// Composite selector (AND semantics)
page.locator({ type: 'TextField', ancestor: { type: 'LoginForm' } });

// Playwright shortcut syntax
page.locator('text=登录');                        // Text
page.locator('key=login_button');                  // Key
page.locator('type=ElevatedButton');               // Type
```

**Implementation**:
- Selector is a pure data object; Locator holds it and serializes to Dart side when needed
- Dart-side inspect extension performs actual Widget tree traversal and matching
- Composite selectors use `ancestor` field for hierarchy filtering — Dart checks parent-child relationships during traversal

**Estimate**: 1 day

---

## 4. Failure Context Collection

### 4.1 Trigger

Automatic on assertion timeout failure. No user action required.

### 4.2 Collection Pipeline

```
AssertionError thrown
  → FailureCollector.onAssertionFailed(error)
    → Parallel collection:
      ├─ screenshot: ext.flutter.driver.screenshot → PNG bytes
      ├─ widgetTree: ext.fliwright.inspect (full tree snapshot) → JSON
      └─ sourceLocation: Error.stackTrace → test file line number
    → Assemble into FailureContext
```

### 4.3 FailureContext Structure

```typescript
interface FailureContext {
  assertion: {
    matcher: string;          // e.g. 'toBeVisible'
    expected: string;         // Expected value description
    actual: string;           // Actual value description
    timeout: number;          // Timeout value
  };
  screenshot: Buffer | null;  // PNG screenshot
  widgetTree: object;         // Widget tree JSON snapshot
  source: {
    file: string;             // Test file path
    line: number;             // Assertion line number
    snippet: string;          // Assertion code snippet
  };
  timestamp: string;
}
```

### 4.4 Screenshot Storage

- Default directory: `.fliwright/failures/`
- Filename format: `{timestamp}_{matcher}.png`
- Config option: `screenshot: 'file' | 'base64' | 'off'` (default: `'file'`)
- Screenshot path appended to error message for CI visibility

**Estimate**: 2 days

---

## 5. Vitest Integration

### 5.1 User API

```typescript
// fliwright.config.ts
import { defineConfig } from '@fliwright/core';

export default defineConfig({
  devices: ['android'],
  vmServiceUrl: process.env.FLIWRIGHT_VM_SERVICE_URL,
  timeout: 5000,
  screenshot: 'file',
});

// tests/login.test.ts
import { test, expect } from '@fliwright/vitest';

test('user can log in', async ({ page }) => {
  await page.locator({ text: '用户名' }).click();
  await page.locator({ text: '用户名' }).type('leo@example.com');
  await page.locator({ text: '密码' }).type('secret123');
  await page.locator({ text: '登录' }).click();
  await expect(page.locator({ text: '欢迎回来' })).toBeVisible();
});
```

### 5.2 Package Structure

```
@fliwright/vitest (new package)
  ├─ fixture: test({ page }) — inject Page instance
  ├─ globalSetup — connect to VM Service
  ├─ teardown — afterEach optional screenshot, afterAll disconnect
  └─ reporter — Vitest reporter, format FailureContext output
```

### 5.3 Lifecycle

| Phase | Action |
|-------|--------|
| `globalSetup` | Create Driver, connect to VM Service |
| `beforeEach` | Optional: reset app state |
| `test({ page })` | Inject shared Page instance via fixture (`test.extend()`) |
| `afterEach` | Auto-screenshot on test failure, attach to report |
| `afterAll` | Disconnect VM Service, cleanup resources |
| `globalTeardown` | Close Driver |

### 5.4 Integration Mechanism

- Use Vitest `test.extend()` for `page` fixture injection
- Export custom `expect` (wraps assertion engine, not Vitest native expect)
- Provide Vitest `reporter` plugin for terminal output of screenshot paths and Widget tree summaries

**Estimate**: 2 days

---

## 6. Estimates Summary

| Task | Description | Days | Iteration |
|------|-------------|------|-----------|
| 2.1 | Dart: Type extension | 1d | 2-A |
| 2.2 | Dart: Scroll extension | 1d | 2-B |
| 2.3 | Dart: Gesture extension | 2d | 2-C |
| 2.4 | TS: Assertion engine | 3d | 2-A |
| 2.5 | TS: Extended selectors | 1d | 2-B |
| 2.6 | TS: Failure context | 2d | 2-C |
| 2.7 | TS: Vitest integration | 2d | 2-D |
| **Total** | | **12d** | |

---

## 7. Dependencies

- Slice 1 Plugin Registry, Protocol, Driver, Page, Locator — all inherited
- All new Dart extensions register via Slice 0 Plugin interface
- Assertion engine depends on inspect extension for polling queries
- Vitest integration depends on assertion engine and all extensions
