# Slice 2: Assertion Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver complete end-to-end test case capabilities — type input, scroll, complex gestures, Playwright-style assertions, extended selectors, failure context screenshots, and Vitest integration.

**Architecture:** Four vertical iterations (2-A through 2-D), each delivering a demoable end-to-end capability. Dart extensions register via the existing `ExtensionRegistry`/`FliwrightBridge` pattern. TypeScript assertion engine polls via `ext.fliwright.inspect`. New `@fliwright/vitest` package provides test fixtures.

**Tech Stack:** TypeScript (ES2022, Node16 modules, Vitest), Dart/Flutter (3.5+), JSON-RPC 2.0 over WebSocket, pnpm workspace + melos.

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `packages/fliwright-bridge/lib/src/extensions/type_extension.dart` | `ext.fliwright.type` — keyboard text input |
| `packages/fliwright-bridge/lib/src/extensions/scroll_extension.dart` | `ext.fliwright.scrollIntoView` — scroll widget into viewport |
| `packages/fliwright-core/src/Selector.ts` | Structured selector — converts object/string to wire format |
| `packages/fliwright-core/src/Assertion.ts` | Assertion engine — Playwright-style auto-wait polling |
| `packages/fliwright-core/src/FailureCollector.ts` | Failure context — screenshot + widget tree + source location |
| `packages/fliwright-core/tests/Selector.test.ts` | Selector unit tests |
| `packages/fliwright-core/tests/Assertion.test.ts` | Assertion engine unit tests |
| `packages/fliwright-core/tests/FailureCollector.test.ts` | Failure collector unit tests |
| `packages/fliwright-vitest/package.json` | Package manifest |
| `packages/fliwright-vitest/tsconfig.json` | TypeScript config |
| `packages/fliwright-vitest/vitest.config.ts` | Vitest config |
| `packages/fliwright-vitest/src/index.ts` | Public API — test fixture, expect, defineConfig |
| `packages/fliwright-vitest/src/setup.ts` | globalSetup/globalTeardown |
| `packages/fliwright-vitest/src/reporter.ts` | Vitest reporter plugin |
| `packages/fliwright-vitest/tests/integration.test.ts` | Integration tests |

### Modified files

| File | Change |
|------|--------|
| `packages/fliwright-bridge/lib/src/bridge.dart` | Register type + scroll extensions |
| `packages/fliwright-bridge/lib/src/extensions/gesture.dart` | Add longPress, drag, pinch handlers |
| `packages/fliwright-bridge/test/extension_registry_test.dart` | Add tests for type, scroll, gesture extensions |
| `packages/fliwright-core/src/types.ts` | Add `FailureContext`, `SelectorInput`, `GestureType` types |
| `packages/fliwright-core/src/Locator.ts` | Accept `SelectorInput`, add `type()`, `scrollIntoView()`, `longPress()`, `drag()`, `pinch()` methods |
| `packages/fliwright-core/src/Page.ts` | Accept `SelectorInput` in `locator()`, add `waitFor()` overload |
| `packages/fliwright-core/src/index.ts` | Export new classes and types |
| `packages/fliwright-core/tests/Locator.test.ts` | Add tests for new methods |
| `packages/fliwright-core/tests/Page.test.ts` | Add tests for new selector inputs |
| `pnpm-workspace.yaml` | Add `packages/fliwright-vitest` if needed (already covered by `packages/*`) |

---

## Iteration 2-A: Type Extension + Assertion Engine

Delivers: "Type text into a field → assert it is visible" end-to-end.

---

### Task 1: Dart — TypeExtension (`ext.fliwright.type`)

**Files:**
- Create: `packages/fliwright-bridge/lib/src/extensions/type_extension.dart`
- Modify: `packages/fliwright-bridge/lib/src/bridge.dart`
- Modify: `packages/fliwright-bridge/test/extension_registry_test.dart`

- [ ] **Step 1: Write the failing test**

Add to `packages/fliwright-bridge/test/extension_registry_test.dart`, inside a new `group('TypeExtension', ...)` after the existing `GestureExtension` group:

```dart
  group('TypeExtension', () {
    setUp(() { FliwrightBridge.reset(); });

    test('registers type extension on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.type'));
    });

    test('type returns error when selector is missing', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke('ext.fliwright.type', {});
      expect(result, contains('error'));
    });

    test('type returns error when text is missing', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.type',
        {'selector': 'text=Username'},
      );
      expect(result, contains('error'));
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/fliwright-bridge && flutter test test/extension_registry_test.dart`
Expected: FAIL — `ext.fliwright.type` is not registered.

- [ ] **Step 3: Implement TypeExtension**

Create `packages/fliwright-bridge/lib/src/extensions/type_extension.dart`:

```dart
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../bridge.dart';

class TypeExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.type', _type);
  }

  static Future<Map<String, dynamic>> _type(Map<String, String> params) async {
    final selector = params['selector'];
    final text = params['text'];
    if (selector == null || selector.isEmpty) {
      return {'error': 'Missing parameter: selector'};
    }
    if (text == null) {
      return {'error': 'Missing parameter: text'};
    }

    final replaceAll = params['replaceAll'] != 'false';
    final charDelay = int.tryParse(params['charDelay'] ?? '0') ?? 0;

    // Find the target widget via inspect
    final inspectResult = await FliwrightBridge.registry.invoke(
      'ext.fliwright.inspect',
      {'selector': selector},
    );
    final widgets = (inspectResult['widgets'] as List?) ?? [];
    if (widgets.isEmpty) {
      return {'error': 'No widget found matching selector: $selector'};
    }

    final widget = widgets.first as Map<String, dynamic>;
    final rect = widget['rect'] as Map<String, dynamic>?;
    if (rect == null) {
      return {'error': 'Widget has no render bounds'};
    }

    final x = (rect['x'] as num).toDouble() + (rect['width'] as num).toDouble() / 2;
    final y = (rect['y'] as num).toDouble() + (rect['height'] as num).toDouble() / 2;

    // Tap to focus
    await FliwrightBridge.registry.invoke(
      'ext.fliwright.click',
      {'x': x.toString(), 'y': y.toString()},
    );

    // Allow focus to settle
    await Future<void>.delayed(const Duration(milliseconds: 100));

    // If replaceAll, select all existing text and delete
    if (replaceAll) {
      SystemChannels.textInput.invokeMethod('TextInput.selectAll');
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }

    // Simulate text input via SystemChannels
    if (charDelay > 0) {
      for (final char in text.split('')) {
        SystemChannels.textInput.invokeMethod('TextInput.clientRequestToUpdateText');
        await Future<void>.delayed(Duration(milliseconds: charDelay));
      }
    }

    // Use TestDefaultBinaryMessenger to inject text input
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .handlePlatformMessage(
      SystemChannels.textInput.name,
      SystemChannels.textInput.codec.encodeMethodCall(
        MethodCall(
          'TextInputClient.updateEditingState',
          [
            0, // client ID (will be set by framework)
            <String, dynamic>{
              'text': text,
              'selectionBase': text.length,
              'selectionExtent': text.length,
              'composingBase': -1,
              'composingExtent': -1,
            },
          ],
        ),
      ),
      (ByteData? data) {},
    );

    return {'success': true, 'currentText': text};
  }
}
```

- [ ] **Step 4: Register in bridge**

Modify `packages/fliwright-bridge/lib/src/bridge.dart` — add import and registration:

```dart
import 'extension_registry.dart';
import 'extensions/gesture.dart';
import 'extensions/inspect.dart';
import 'extensions/riverpod.dart';
import 'extensions/type_extension.dart';  // ADD

export 'extension_registry.dart';

class FliwrightBridge {
  static final ExtensionRegistry _registry = ExtensionRegistry();
  static ExtensionRegistry get registry => _registry;
  static bool _initialized = false;

  static void reset() {
    _registry.reset();
    _initialized = false;
  }

  static Future<void> init() async {
    if (_initialized) return;
    _initialized = true;

    _registry.register('ext.fliwright.ping', (params) async {
      return {'status': 'ok', 'timestamp': DateTime.now().toIso8601String()};
    });

    _registry.register('ext.fliwright.handshake', (params) async {
      final clientVersion = int.tryParse(params['protocolVersion'] ?? '0') ?? 0;
      return {
        'status': 'ok',
        'protocolVersion': 1,
        'clientVersion': clientVersion,
        'compatible': clientVersion <= 1,
      };
    });

    GestureExtension.register(_registry);
    InspectExtension.register(_registry);
    TypeExtension.register(_registry);  // ADD
    RiverpodExtension.register(_registry);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/fliwright-bridge && flutter test test/extension_registry_test.dart`
Expected: All tests PASS, including new TypeExtension tests.

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-bridge/lib/src/extensions/type_extension.dart packages/fliwright-bridge/lib/src/bridge.dart packages/fliwright-bridge/test/extension_registry_test.dart
git commit -m "feat(bridge): add TypeExtension — ext.fliwright.type for keyboard text input"
```

---

### Task 2: TS — Selector class

**Files:**
- Create: `packages/fliwright-core/src/Selector.ts`
- Modify: `packages/fliwright-core/src/types.ts`
- Create: `packages/fliwright-core/tests/Selector.test.ts`
- Modify: `packages/fliwright-core/src/index.ts`

- [ ] **Step 1: Add SelectorInput type to types.ts**

Add to the end of `packages/fliwright-core/src/types.ts`:

```typescript
export type SelectorInput =
  | string
  | { text: string; ancestor?: SelectorInput }
  | { key: string; ancestor?: SelectorInput }
  | { type: string; ancestor?: SelectorInput };
```

- [ ] **Step 2: Write the Selector test**

Create `packages/fliwright-core/tests/Selector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Selector } from '../src/Selector.js';

describe('Selector', () => {
  it('passes through string selectors unchanged', () => {
    const s = new Selector('text=Login');
    expect(s.toWireFormat()).toBe('text=Login');
  });

  it('converts { text } to text= format', () => {
    const s = new Selector({ text: 'Login' });
    expect(s.toWireFormat()).toBe('text=Login');
  });

  it('converts { key } to key= format', () => {
    const s = new Selector({ key: 'submit_btn' });
    expect(s.toWireFormat()).toBe('key=submit_btn');
  });

  it('converts { type } to byType= format', () => {
    const s = new Selector({ type: 'ElevatedButton' });
    expect(s.toWireFormat()).toBe('byType=ElevatedButton');
  });

  it('throws on empty object', () => {
    expect(() => new Selector({} as any)).toThrow('Invalid selector');
  });

  it('throws on unknown keys', () => {
    expect(() => new Selector({ foo: 'bar' } as any)).toThrow('Invalid selector');
  });

  it('stores ancestor for composite selectors', () => {
    const s = new Selector({ type: 'TextField', ancestor: { type: 'LoginForm' } });
    expect(s.toWireFormat()).toBe('byType=TextField');
    expect(s.ancestor).toBeDefined();
    expect(s.ancestor!.toWireFormat()).toBe('byType=LoginForm');
  });

  it('serializes to wire params with ancestor', () => {
    const s = new Selector({ type: 'TextField', ancestor: { type: 'LoginForm' } });
    const params = s.toWireParams();
    expect(params.selector).toBe('byType=TextField');
    expect(params.ancestorSelector).toBe('byType=LoginForm');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/fliwright-core && pnpm vitest run tests/Selector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement Selector**

Create `packages/fliwright-core/src/Selector.ts`:

```typescript
import type { SelectorInput } from './types.js';

export class Selector {
  readonly raw: string;
  readonly ancestor?: Selector;

  constructor(input: SelectorInput) {
    if (typeof input === 'string') {
      this.raw = input;
      return;
    }
    if ('text' in input && typeof input.text === 'string') {
      this.raw = `text=${input.text}`;
    } else if ('key' in input && typeof input.key === 'string') {
      this.raw = `key=${input.key}`;
    } else if ('type' in input && typeof input.type === 'string') {
      this.raw = `byType=${input.type}`;
    } else {
      throw new Error(`Invalid selector: ${JSON.stringify(input)}. Use { text }, { key }, { type }, or a string.`);
    }
    if (input.ancestor) {
      this.ancestor = new Selector(input.ancestor);
    }
  }

  toWireFormat(): string {
    return this.raw;
  }

  toWireParams(): Record<string, unknown> {
    const params: Record<string, unknown> = { selector: this.raw };
    if (this.ancestor) {
      params.ancestorSelector = this.ancestor.toWireFormat();
    }
    return params;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/fliwright-core && pnpm vitest run tests/Selector.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Export Selector from index.ts**

Add to `packages/fliwright-core/src/index.ts` — add SelectorInput to the types export block and Selector to the class exports:

In the types export block (after `ProtocolMessage,`):
```typescript
  SelectorInput,
```

At the end, add:
```typescript
export { Selector } from './Selector.js';
```

- [ ] **Step 7: Run all existing tests to verify no regressions**

Run: `cd packages/fliwright-core && pnpm test`
Expected: All existing tests PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/fliwright-core/src/Selector.ts packages/fliwright-core/src/types.ts packages/fliwright-core/src/index.ts packages/fliwright-core/tests/Selector.test.ts
git commit -m "feat(core): add Selector class — structured selector with text/key/type support"
```

---

### Task 3: TS — Update Locator to accept SelectorInput + add type() method

**Files:**
- Modify: `packages/fliwright-core/src/Locator.ts`
- Modify: `packages/fliwright-core/tests/Locator.test.ts`

- [ ] **Step 1: Write failing tests for Locator.type() and SelectorInput**

Add to `packages/fliwright-core/tests/Locator.test.ts`:

```typescript
import { Locator } from '../src/Locator.js';
import { Selector } from '../src/Selector.js';

// ... existing testWidget and createMockSendRequest stay the same ...

// Add to the mock:
function createMockSendRequest(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
    if (method === 'ext.fliwright.inspect') {
      return responses['inspect'] ?? { widgets: [], count: 0 };
    }
    if (method === 'ext.fliwright.click') {
      return responses['click'] ?? { success: true };
    }
    if (method === 'ext.fliwright.type') {
      return responses['type'] ?? { success: true, currentText: '' };
    }
    return responses[method] ?? {};
  });
}

// Add these tests at the end of the describe block:

  it('accepts Selector object { text: ... }', async () => {
    const sendRequest = createMockSendRequest({
      inspect: { widgets: [testWidget], count: 1 },
      click: { success: true },
    });

    const locator = new Locator({ text: 'Increment' }, sendRequest);
    await locator.click();

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.inspect', { selector: 'text=Increment' });
  });

  it('type() sends inspect then type request', async () => {
    const sendRequest = createMockSendRequest({
      inspect: { widgets: [testWidget], count: 1 },
      type: { success: true, currentText: 'hello' },
    });

    const locator = new Locator('text=Username', sendRequest);
    await locator.type('hello');

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.type', {
      selector: 'text=Username',
      text: 'hello',
      replaceAll: true,
      charDelay: 0,
    });
  });

  it('type() throws when no widget found', async () => {
    const sendRequest = createMockSendRequest({
      inspect: { widgets: [], count: 0 },
    });

    const locator = new Locator('text=Missing', sendRequest);
    await expect(locator.type('hello')).rejects.toThrow('No widget found matching selector: text=Missing');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/fliwright-core && pnpm vitest run tests/Locator.test.ts`
Expected: FAIL — `Selector` import error or type mismatch.

- [ ] **Step 3: Update Locator class**

Replace `packages/fliwright-core/src/Locator.ts` entirely:

```typescript
import type { WidgetInfo, SelectorInput } from './types.js';
import { Selector } from './Selector.js';

type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export class Locator {
  private selector: Selector;
  private sendRequest: SendRequest;

  constructor(input: SelectorInput, sendRequest: SendRequest) {
    this.selector = new Selector(input);
    this.sendRequest = sendRequest;
  }

  async click(): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching selector: ${this.selector.toWireFormat()}`);
    }
    const widget = widgets[0];
    if (!widget.rect) {
      throw new Error(`Widget matching ${this.selector.toWireFormat()} has no render bounds`);
    }
    const x = widget.rect.x + widget.rect.width / 2;
    const y = widget.rect.y + widget.rect.height / 2;
    await this.sendRequest('ext.fliwright.click', { x, y });
  }

  async type(text: string, options?: { replaceAll?: boolean; charDelay?: number }): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching selector: ${this.selector.toWireFormat()}`);
    }
    await this.sendRequest('ext.fliwright.type', {
      selector: this.selector.toWireFormat(),
      text,
      replaceAll: options?.replaceAll ?? true,
      charDelay: options?.charDelay ?? 0,
    });
  }

  async count(): Promise<number> {
    const widgets = await this._resolve();
    return widgets.length;
  }

  async isVisible(): Promise<boolean> {
    const widgets = await this._resolve();
    return widgets.length > 0 && widgets[0].rect != null;
  }

  get selectorString(): string {
    return this.selector.toWireFormat();
  }

  private async _resolve(): Promise<WidgetInfo[]> {
    const result = (await this.sendRequest('ext.fliwright.inspect', {
      selector: this.selector.toWireFormat(),
    })) as { widgets: WidgetInfo[] };
    return result.widgets ?? [];
  }
}
```

- [ ] **Step 4: Update Page to accept SelectorInput**

Replace `packages/fliwright-core/src/Page.ts` entirely:

```typescript
import { Locator } from './Locator.js';
import type { SelectorInput } from './types.js';

type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export class Page {
  constructor(private sendRequest: SendRequest) {}

  locator(input: SelectorInput): Locator {
    return new Locator(input, this.sendRequest);
  }

  async waitFor(input: SelectorInput, timeoutMs = 5000): Promise<Locator> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const loc = this.locator(input);
      const count = await loc.count();
      if (count > 0) return loc;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timeout waiting for selector: ${new Locator(input, this.sendRequest).selectorString}`);
  }
}
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `cd packages/fliwright-core && pnpm test`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-core/src/Locator.ts packages/fliwright-core/src/Page.ts packages/fliwright-core/tests/Locator.test.ts packages/fliwright-core/tests/Page.test.ts
git commit -m "feat(core): Locator accepts SelectorInput, add type() method for text input"
```

---

### Task 4: TS — Assertion Engine

**Files:**
- Create: `packages/fliwright-core/src/Assertion.ts`
- Create: `packages/fliwright-core/tests/Assertion.test.ts`
- Modify: `packages/fliwright-core/src/index.ts`

- [ ] **Step 1: Write failing tests for Assertion engine**

Create `packages/fliwright-core/tests/Assertion.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createExpect, Assertion } from '../src/Assertion.js';
import type { Locator } from '../src/Locator.js';

function createMockLocator(visible: boolean, text?: string, enabled?: boolean) {
  return {
    isVisible: vi.fn().mockResolvedValue(visible),
    count: vi.fn().mockResolvedValue(visible ? 1 : 0),
    selectorString: 'text=Test',
    type: vi.fn().mockResolvedValue(undefined),
    _getFirstWidget: vi.fn().mockResolvedValue(
      visible
        ? { id: '1', type: 'Text', text: text ?? 'Test', rect: { x: 0, y: 0, width: 100, height: 50 }, properties: { enabled: enabled ?? true } }
        : null,
    ),
  } as unknown as Locator;
}

describe('Assertion', () => {
  it('toBeVisible passes when widget is visible', async () => {
    const locator = createMockLocator(true);
    await createExpect(locator).toBeVisible({ timeout: 200 });
  });

  it('toBeVisible fails when widget is not visible', async () => {
    const locator = createMockLocator(false);
    await expect(
      createExpect(locator).toBeVisible({ timeout: 200 }),
    ).rejects.toThrow('toBeVisible');
  });

  it('not.toBeVisible passes when widget is not visible', async () => {
    const locator = createMockLocator(false);
    await createExpect(locator).not.toBeVisible({ timeout: 200 });
  });

  it('not.toBeVisible fails when widget is visible', async () => {
    const locator = createMockLocator(true);
    await expect(
      createExpect(locator).not.toBeVisible({ timeout: 200 }),
    ).rejects.toThrow('not.toBeVisible');
  });

  it('toHaveText passes with exact match', async () => {
    const locator = createMockLocator(true, 'Hello World');
    await createExpect(locator).toHaveText('Hello World', { timeout: 200 });
  });

  it('toHaveText fails with wrong text', async () => {
    const locator = createMockLocator(true, 'Hello');
    await expect(
      createExpect(locator).toHaveText('Goodbye', { timeout: 200 }),
    ).rejects.toThrow('toHaveText');
  });

  it('toContainText passes with substring', async () => {
    const locator = createMockLocator(true, 'Hello World');
    await createExpect(locator).toContainText('World', { timeout: 200 });
  });

  it('toContainText fails when substring not found', async () => {
    const locator = createMockLocator(true, 'Hello');
    await expect(
      createExpect(locator).toContainText('World', { timeout: 200 }),
    ).rejects.toThrow('toContainText');
  });

  it('toBeEnabled passes when widget is enabled', async () => {
    const locator = createMockLocator(true, 'Btn', true);
    await createExpect(locator).toBeEnabled({ timeout: 200 });
  });

  it('toBeEnabled fails when widget is disabled', async () => {
    const locator = createMockLocator(true, 'Btn', false);
    await expect(
      createExpect(locator).toBeEnabled({ timeout: 200 }),
    ).rejects.toThrow('toBeEnabled');
  });

  it('toBeDisabled passes when widget is disabled', async () => {
    const locator = createMockLocator(true, 'Btn', false);
    await createExpect(locator).toBeDisabled({ timeout: 200 });
  });
});

describe('Assertion polling', () => {
  it('retries until condition is met', async () => {
    let callCount = 0;
    const locator = {
      isVisible: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount >= 3;
      }),
      selectorString: 'text=Delayed',
    } as unknown as Locator;

    await createExpect(locator).toBeVisible({ timeout: 2000 });
    expect(callCount).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/fliwright-core && pnpm vitest run tests/Assertion.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Assertion engine**

Create `packages/fliwright-core/src/Assertion.ts`:

```typescript
import type { Locator } from './Locator.js';
import type { WidgetInfo } from './types.js';

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_INTERVAL = 100;

export class AssertionError extends Error {
  readonly matcher: string;
  readonly expected: string;
  readonly actual: string;
  readonly selector: string;

  constructor(matcher: string, expected: string, actual: string, selector: string) {
    super(`${matcher} failed for "${selector}": expected ${expected}, got ${actual}`);
    this.name = 'AssertionError';
    this.matcher = matcher;
    this.expected = expected;
    this.actual = actual;
    this.selector = selector;
  }
}

async function pollUntil(
  fn: () => Promise<boolean>,
  timeout: number,
  interval: number,
): Promise<void> {
  const start = Date.now();
  while (true) {
    if (await fn()) return;
    if (Date.now() - start >= timeout) throw new Error('poll timeout');
    await new Promise((r) => setTimeout(r, interval));
  }
}

export class Assertion {
  private _isNegated = false;

  constructor(
    private locator: Locator,
    private negated = false,
  ) {
    this._isNegated = negated;
  }

  get not(): Assertion {
    return new Assertion(this.locator, !this._isNegated);
  }

  async toBeVisible(options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const check = async () => {
      const visible = await this.locator.isVisible();
      return this._isNegated ? !visible : visible;
    };
    const expected = this._isNegated ? 'not visible' : 'visible';
    try {
      await pollUntil(check, timeout, DEFAULT_INTERVAL);
    } catch {
      const actual = await this.locator.isVisible();
      const pass = this._isNegated ? !actual : actual;
      if (!pass) {
        throw new AssertionError(
          this._isNegated ? 'not.toBeVisible' : 'toBeVisible',
          expected,
          actual ? 'visible' : 'not visible',
          this.locator.selectorString,
        );
      }
    }
  }

  async toHaveText(text: string, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const check = async () => {
      const widget = await this._getWidgetText();
      const match = widget === text;
      return this._isNegated ? !match : match;
    };
    try {
      await pollUntil(check, timeout, DEFAULT_INTERVAL);
    } catch {
      const actual = await this._getWidgetText();
      const match = actual === text;
      const pass = this._isNegated ? !match : match;
      if (!pass) {
        throw new AssertionError(
          this._isNegated ? 'not.toHaveText' : 'toHaveText',
          this._isNegated ? `not "${text}"` : `"${text}"`,
          `"${actual}"`,
          this.locator.selectorString,
        );
      }
    }
  }

  async toContainText(text: string, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const check = async () => {
      const widgetText = await this._getWidgetText();
      const match = widgetText.includes(text);
      return this._isNegated ? !match : match;
    };
    try {
      await pollUntil(check, timeout, DEFAULT_INTERVAL);
    } catch {
      const actual = await this._getWidgetText();
      const match = actual.includes(text);
      const pass = this._isNegated ? !match : match;
      if (!pass) {
        throw new AssertionError(
          this._isNegated ? 'not.toContainText' : 'toContainText',
          this._isNegated ? `not containing "${text}"` : `containing "${text}"`,
          `"${actual}"`,
          this.locator.selectorString,
        );
      }
    }
  }

  async toBeEnabled(options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const check = async () => {
      const enabled = await this._getWidgetEnabled();
      const pass = this._isNegated ? !enabled : enabled;
      return pass;
    };
    try {
      await pollUntil(check, timeout, DEFAULT_INTERVAL);
    } catch {
      const enabled = await this._getWidgetEnabled();
      const pass = this._isNegated ? !enabled : enabled;
      if (!pass) {
        throw new AssertionError(
          this._isNegated ? 'toBeDisabled' : 'toBeEnabled',
          this._isNegated ? 'disabled' : 'enabled',
          enabled ? 'enabled' : 'disabled',
          this.locator.selectorString,
        );
      }
    }
  }

  async toBeDisabled(options?: { timeout?: number }): Promise<void> {
    return this.not.toBeEnabled(options);
  }

  private async _getWidgetText(): Promise<string> {
    const widgets = await (this.locator as any)._resolve();
    return (widgets?.[0]?.text as string) ?? '';
  }

  private async _getWidgetEnabled(): Promise<boolean> {
    const widgets = await (this.locator as any)._resolve();
    const props = widgets?.[0]?.properties as Record<string, unknown> | undefined;
    return (props?.enabled as boolean) ?? true;
  }
}

export function createExpect(locator: Locator): Assertion {
  return new Assertion(locator);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/fliwright-core && pnpm vitest run tests/Assertion.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Export from index.ts**

Add to `packages/fliwright-core/src/index.ts`:

```typescript
export { Assertion, AssertionError, createExpect } from './Assertion.js';
```

- [ ] **Step 6: Run all tests to verify no regressions**

Run: `cd packages/fliwright-core && pnpm test`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/fliwright-core/src/Assertion.ts packages/fliwright-core/tests/Assertion.test.ts packages/fliwright-core/src/index.ts
git commit -m "feat(core): add Assertion engine — Playwright-style auto-wait polling"
```

---

## Iteration 2-B: Scroll Extension + Extended Selectors

Delivers: "Scroll to element → locate by key/type → assert" end-to-end.

---

### Task 5: Dart — ScrollExtension (`ext.fliwright.scrollIntoView`)

**Files:**
- Create: `packages/fliwright-bridge/lib/src/extensions/scroll_extension.dart`
- Modify: `packages/fliwright-bridge/lib/src/bridge.dart`
- Modify: `packages/fliwright-bridge/test/extension_registry_test.dart`

- [ ] **Step 1: Write failing tests**

Add to `packages/fliwright-bridge/test/extension_registry_test.dart`:

```dart
  group('ScrollExtension', () {
    setUp(() { FliwrightBridge.reset(); });

    test('registers scrollIntoView extension on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.scrollIntoView'));
    });

    test('scrollIntoView returns error when selector is missing', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke('ext.fliwright.scrollIntoView', {});
      expect(result, contains('error'));
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/fliwright-bridge && flutter test test/extension_registry_test.dart`
Expected: FAIL — `ext.fliwright.scrollIntoView` not registered.

- [ ] **Step 3: Implement ScrollExtension**

Create `packages/fliwright-bridge/lib/src/extensions/scroll_extension.dart`:

```dart
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

import '../bridge.dart';

class ScrollExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.scrollIntoView', _scrollIntoView);
  }

  static Future<Map<String, dynamic>> _scrollIntoView(Map<String, String> params) async {
    final selector = params['selector'];
    if (selector == null || selector.isEmpty) {
      return {'error': 'Missing parameter: selector'};
    }
    final alignment = double.tryParse(params['alignment'] ?? '0.5') ?? 0.5;
    final duration = int.tryParse(params['duration'] ?? '300') ?? 300;

    // Find target widget via inspect
    final inspectResult = await FliwrightBridge.registry.invoke(
      'ext.fliwright.inspect',
      {'selector': selector},
    );
    final widgets = (inspectResult['widgets'] as List?) ?? [];
    if (widgets.isEmpty) {
      return {'error': 'No widget found matching selector: $selector'};
    }

    final widget = widgets.first as Map<String, dynamic>;
    final elementHashCode = widget['id'];

    // Find the Element in the tree
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) return {'error': 'No widget tree available'};

    Element? target;
    _walkTree(root, (element) {
      if ('${element.hashCode}' == elementHashCode) {
        target = element;
      }
    });

    if (target == null) {
      return {'error': 'Could not locate element in tree'};
    }

    final renderObject = target!.findRenderObject();
    if (renderObject == null) {
      return {'error': 'Target element has no render object'};
    }

    // Use Scrollable.ensureVisible to scroll target into view
    try {
      await Scrollable.ensureVisible(
        target!,
        alignment: alignment,
        duration: Duration(milliseconds: duration),
        curve: Curves.easeInOut,
      );
    } catch (e) {
      return {'error': 'Failed to scroll: $e'};
    }

    // Get the new position after scrolling
    final newRenderObject = target!.findRenderObject();
    double? newY;
    if (newRenderObject is RenderBox) {
      final topLeft = newRenderObject.localToGlobal(Offset.zero);
      newY = topLeft.dy;
    }

    return {
      'success': true,
      'scrolled': true,
      if (newY != null) 'offset': newY,
    };
  }

  static void _walkTree(Element root, void Function(Element) visitor) {
    visitor(root);
    root.debugVisitOnstageChildren((Element child) {
      _walkTree(child, visitor);
    });
  }
}
```

- [ ] **Step 4: Register in bridge**

Add to `packages/fliwright-bridge/lib/src/bridge.dart` — import and register:

```dart
import 'extensions/scroll_extension.dart';  // ADD this import
```

In `init()`, after `TypeExtension.register(_registry);`:

```dart
    ScrollExtension.register(_registry);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/fliwright-bridge && flutter test test/extension_registry_test.dart`
Expected: All tests PASS.

- [ ] **Step 6: Add Locator.scrollIntoView() method**

Add to `packages/fliwright-core/src/Locator.ts`, after the `type()` method:

```typescript
  async scrollIntoView(options?: { alignment?: number; duration?: number }): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching selector: ${this.selector.toWireFormat()}`);
    }
    await this.sendRequest('ext.fliwright.scrollIntoView', {
      selector: this.selector.toWireFormat(),
      alignment: options?.alignment ?? 0.5,
      duration: options?.duration ?? 300,
    });
  }
```

Update the `createMockSendRequest` in `packages/fliwright-core/tests/Locator.test.ts` to handle `ext.fliwright.scrollIntoView`:

```typescript
    if (method === 'ext.fliwright.scrollIntoView') {
      return responses['scroll'] ?? { success: true, scrolled: true };
    }
```

Add test:

```typescript
  it('scrollIntoView() sends inspect then scroll request', async () => {
    const sendRequest = createMockSendRequest({
      inspect: { widgets: [testWidget], count: 1 },
      scroll: { success: true, scrolled: true },
    });

    const locator = new Locator('text=Submit', sendRequest);
    await locator.scrollIntoView();

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.scrollIntoView', {
      selector: 'text=Submit',
      alignment: 0.5,
      duration: 300,
    });
  });
```

- [ ] **Step 7: Run all tests**

Run: `cd packages/fliwright-core && pnpm test`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/fliwright-bridge/lib/src/extensions/scroll_extension.dart packages/fliwright-bridge/lib/src/bridge.dart packages/fliwright-bridge/test/extension_registry_test.dart packages/fliwright-core/src/Locator.ts packages/fliwright-core/tests/Locator.test.ts
git commit -m "feat: add ScrollExtension + Locator.scrollIntoView() — scroll widgets into viewport"
```

---

### Task 6: TS — Update Dart InspectExtension for composite selectors

**Files:**
- Modify: `packages/fliwright-bridge/lib/src/extensions/inspect.dart`

- [ ] **Step 1: Write failing test for composite selector**

Add to `packages/fliwright-bridge/test/extension_registry_test.dart` in the `InspectExtension` group:

```dart
    test('inspect supports ancestorSelector for composite matching', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.inspect',
        {'selector': 'byType=Text', 'ancestorSelector': 'byType=LoginForm'},
      );
      // Should not error — returns empty if no LoginForm in test
      expect(result, contains('widgets'));
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/fliwright-bridge && flutter test test/extension_registry_test.dart`
Expected: May pass (returns all `Text` widgets without filtering) — the test validates the param is accepted, not filtered. Proceed to implement filtering.

- [ ] **Step 3: Update InspectExtension to support ancestor filtering**

Modify `packages/fliwright-bridge/lib/src/extensions/inspect.dart` — replace `_inspect` method:

```dart
  static Future<Map<String, dynamic>> _inspect(Map<String, String> params) async {
    final selector = params['selector'] ?? '';
    final ancestorSelector = params['ancestorSelector'];
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {'error': 'No widget tree available', 'widgets': <dynamic>[]};
    }

    final parsed = _parseSelector(selector);
    final ancestorParsed = ancestorSelector != null
        ? _parseSelector(ancestorSelector)
        : null;
    final matchedWidgets = <Map<String, dynamic>>[];

    _walkTree(root, (Element element) {
      final info = _extractWidgetInfo(element);
      if (info == null) return;
      if (_matches(info, parsed)) {
        if (ancestorParsed != null) {
          if (!_hasAncestor(element, ancestorParsed)) return;
        }
        matchedWidgets.add(info);
      }
    });

    return {'widgets': matchedWidgets, 'count': matchedWidgets.length};
  }
```

Add the `_hasAncestor` method after `_matches`:

```dart
  static bool _hasAncestor(Element element, _ParsedSelector ancestorSelector) {
    Element? current = element.findAncestorWidgetOfExactType<Widget>()?.createElement();
    // Walk up the tree manually
    bool found = false;
    element.visitAncestorElements((Element ancestor) {
      final info = _extractWidgetInfo(ancestor);
      if (info != null && _matches(info, ancestorSelector)) {
        found = true;
        return false; // stop visiting
      }
      return true; // continue visiting
    });
    return found;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/fliwright-bridge && flutter test test/extension_registry_test.dart`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-bridge/lib/src/extensions/inspect.dart packages/fliwright-bridge/test/extension_registry_test.dart
git commit -m "feat(bridge): inspect supports ancestorSelector for composite widget matching"
```

---

## Iteration 2-C: Gesture Extension + Failure Context

Delivers: "Long press / drag / pinch → assert with screenshot on failure" end-to-end.

---

### Task 7: Dart — Extend GestureExtension (longPress, drag, pinch)

**Files:**
- Modify: `packages/fliwright-bridge/lib/src/extensions/gesture.dart`
- Modify: `packages/fliwright-bridge/test/extension_registry_test.dart`

- [ ] **Step 1: Write failing tests**

Add to `packages/fliwright-bridge/test/extension_registry_test.dart` in the `GestureExtension` group:

```dart
    test('registers gesture extension for longPress', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.gesture'));
    });

    test('gesture returns error when gesture type is missing', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke('ext.fliwright.gesture', {});
      expect(result, contains('error'));
    });

    test('gesture returns error for unknown gesture type', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.gesture',
        {'gesture': 'unknown'},
      );
      expect(result, contains('error'));
    });

    test('gesture returns error when selector is missing', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.gesture',
        {'gesture': 'longPress'},
      );
      expect(result, contains('error'));
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/fliwright-bridge && flutter test test/extension_registry_test.dart`
Expected: FAIL — `ext.fliwright.gesture` not registered.

- [ ] **Step 3: Implement gesture handlers**

Replace `packages/fliwright-bridge/lib/src/extensions/gesture.dart` entirely:

```dart
import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';

import '../bridge.dart';

class GestureExtension {
  static int _nextPointer = 10000;

  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.click', _click);
    registry.register('ext.fliwright.gesture', _gesture);
  }

  static Future<Map<String, dynamic>> _click(Map<String, String> params) async {
    final x = double.tryParse(params['x'] ?? '');
    final y = double.tryParse(params['y'] ?? '');
    if (x == null || y == null) {
      return {'error': 'Missing or invalid x, y coordinates'};
    }

    final pointer = _nextPointer++;
    final view =
        WidgetsBinding.instance.platformDispatcher.implicitView?.viewId ? ?? 0;
    final position = Offset(x, y);
    final now = Duration(milliseconds: DateTime.now().millisecondsSinceEpoch);

    GestureBinding.instance.handlePointerEvent(
      PointerDownEvent(
        pointer: pointer,
        position: position,
        kind: PointerDeviceKind.touch,
        viewId: view,
        timeStamp: now,
      ),
    );

    GestureBinding.instance.handlePointerEvent(
      PointerUpEvent(
        pointer: pointer,
        position: position,
        kind: PointerDeviceKind.touch,
        viewId: view,
        timeStamp: now + const Duration(milliseconds: 100),
      ),
    );

    return {'success': true};
  }

  static Future<Map<String, dynamic>> _gesture(Map<String, String> params) async {
    final gestureType = params['gesture'];
    if (gestureType == null || gestureType.isEmpty) {
      return {'error': 'Missing parameter: gesture'};
    }

    final selector = params['selector'];
    if (selector == null || selector.isEmpty) {
      return {'error': 'Missing parameter: selector'};
    }

    // Resolve selector to coordinates
    final inspectResult = await FliwrightBridge.registry.invoke(
      'ext.fliwright.inspect',
      {'selector': selector},
    );
    final widgets = (inspectResult['widgets'] as List?) ?? [];
    if (widgets.isEmpty) {
      return {'error': 'No widget found matching selector: $selector'};
    }

    final widget = widgets.first as Map<String, dynamic>;
    final rect = widget['rect'] as Map<String, dynamic>?;
    if (rect == null) {
      return {'error': 'Widget has no render bounds'};
    }

    final x = (rect['x'] as num).toDouble() + (rect['width'] as num).toDouble() / 2;
    final y = (rect['y'] as num).toDouble() + (rect['height'] as num).toDouble() / 2;

    switch (gestureType) {
      case 'longPress':
        return await _longPress(x, y, params);
      case 'drag':
        return await _drag(x, y, params);
      case 'pinch':
        return await _pinch(x, y, rect, params);
      default:
        return {'error': 'Unknown gesture type: $gestureType'};
    }
  }

  static Future<Map<String, dynamic>> _longPress(double x, double y, Map<String, String> params) async {
    final duration = int.tryParse(params['duration'] ?? '500') ?? 500;
    final pointer = _nextPointer++;
    final view = WidgetsBinding.instance.platformDispatcher.implicitView?.viewId ?? 0;
    final position = Offset(x, y);
    final now = Duration(milliseconds: DateTime.now().millisecondsSinceEpoch);

    GestureBinding.instance.handlePointerEvent(
      PointerDownEvent(pointer: pointer, position: position, kind: PointerDeviceKind.touch, viewId: view, timeStamp: now),
    );

    await Future<void>.delayed(Duration(milliseconds: duration));

    GestureBinding.instance.handlePointerEvent(
      PointerUpEvent(pointer: pointer, position: position, kind: PointerDeviceKind.touch, viewId: view, timeStamp: now + Duration(milliseconds: duration + 100)),
    );

    return {'success': true, 'gesture': 'longPress'};
  }

  static Future<Map<String, dynamic>> _drag(double x, double y, Map<String, String> params) async {
    final deltaX = double.tryParse(params['deltaX'] ?? '0') ?? 0;
    final deltaY = double.tryParse(params['deltaY'] ?? '0') ?? 0;
    final steps = int.tryParse(params['steps'] ?? '10') ?? 10;
    final pointer = _nextPointer++;
    final view = WidgetsBinding.instance.platformDispatcher.implicitView?.viewId ?? 0;
    final start = Offset(x, y);
    final end = Offset(x + deltaX, y + deltaY);
    final now = Duration(milliseconds: DateTime.now().millisecondsSinceEpoch);

    GestureBinding.instance.handlePointerEvent(
      PointerDownEvent(pointer: pointer, position: start, kind: PointerDeviceKind.touch, viewId: view, timeStamp: now),
    );

    for (int i = 1; i <= steps; i++) {
      final t = i / steps;
      final position = Offset(
        start.dx + (end.dx - start.dx) * t,
        start.dy + (end.dy - start.dy) * t,
      );
      GestureBinding.instance.handlePointerEvent(
        PointerMoveEvent(pointer: pointer, position: position, kind: PointerDeviceKind.touch, viewId: view, timeStamp: now + Duration(milliseconds: i * 16)),
      );
    }

    GestureBinding.instance.handlePointerEvent(
      PointerUpEvent(pointer: pointer, position: end, kind: PointerDeviceKind.touch, viewId: view, timeStamp: now + Duration(milliseconds: (steps + 1) * 16)),
    );

    return {'success': true, 'gesture': 'drag'};
  }

  static Future<Map<String, dynamic>> _pinch(double cx, double cy, Map<String, dynamic> rect, Map<String, String> params) async {
    final scale = double.tryParse(params['scale'] ?? '0.5') ?? 0.5;
    final steps = int.tryParse(params['steps'] ?? '10') ?? 10;
    final view = WidgetsBinding.instance.platformDispatcher.implicitView?.viewId ?? 0;

    final w = (rect['width'] as num).toDouble();
    final h = (rect['height'] as num).toDouble();
    final halfSpan = (w < h ? w : h) / 4;

    final pointer1 = _nextPointer++;
    final pointer2 = _nextPointer++;
    final now = Duration(milliseconds: DateTime.now().millisecondsSinceEpoch);

    // Start positions: two fingers spread apart from center
    final start1 = Offset(cx - halfSpan, cy);
    final start2 = Offset(cx + halfSpan, cy);
    // End positions: move toward each other (pinch in) or apart (pinch out)
    final end1 = Offset(cx - halfSpan * scale, cy);
    final end2 = Offset(cx + halfSpan * scale, cy);

    // Both fingers down
    GestureBinding.instance.handlePointerEvent(
      PointerDownEvent(pointer: pointer1, position: start1, kind: PointerDeviceKind.touch, viewId: view, timeStamp: now),
    );
    GestureBinding.instance.handlePointerEvent(
      PointerDownEvent(pointer: pointer2, position: start2, kind: PointerDeviceKind.touch, viewId: view, timeStamp: now),
    );

    // Move both fingers
    for (int i = 1; i <= steps; i++) {
      final t = i / steps;
      final pos1 = Offset(start1.dx + (end1.dx - start1.dx) * t, cy);
      final pos2 = Offset(start2.dx + (end2.dx - start2.dx) * t, cy);
      GestureBinding.instance.handlePointerEvent(
        PointerMoveEvent(pointer: pointer1, position: pos1, kind: PointerDeviceKind.touch, viewId: view, timeStamp: now + Duration(milliseconds: i * 16)),
      );
      GestureBinding.instance.handlePointerEvent(
        PointerMoveEvent(pointer: pointer2, position: pos2, kind: PointerDeviceKind.touch, viewId: view, timeStamp: now + Duration(milliseconds: i * 16)),
      );
    }

    // Both fingers up
    GestureBinding.instance.handlePointerEvent(
      PointerUpEvent(pointer: pointer1, position: end1, kind: PointerDeviceKind.touch, viewId: view, timeStamp: now + Duration(milliseconds: (steps + 1) * 16)),
    );
    GestureBinding.instance.handlePointerEvent(
      PointerUpEvent(pointer: pointer2, position: end2, kind: PointerDeviceKind.touch, viewId: view, timeStamp: now + Duration(milliseconds: (steps + 1) * 16)),
    );

    return {'success': true, 'gesture': 'pinch'};
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/fliwright-bridge && flutter test test/extension_registry_test.dart`
Expected: All tests PASS.

- [ ] **Step 5: Add Locator gesture methods**

Add to `packages/fliwright-core/src/Locator.ts`, after `scrollIntoView()`:

```typescript
  async longPress(options?: { duration?: number }): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching selector: ${this.selector.toWireFormat()}`);
    }
    await this.sendRequest('ext.fliwright.gesture', {
      selector: this.selector.toWireFormat(),
      gesture: 'longPress',
      duration: options?.duration ?? 500,
    });
  }

  async drag(deltaX: number, deltaY: number, options?: { steps?: number }): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching selector: ${this.selector.toWireFormat()}`);
    }
    await this.sendRequest('ext.fliwright.gesture', {
      selector: this.selector.toWireFormat(),
      gesture: 'drag',
      deltaX,
      deltaY,
      steps: options?.steps ?? 10,
    });
  }

  async pinch(scale: number, options?: { steps?: number }): Promise<void> {
    const widgets = await this._resolve();
    if (widgets.length === 0) {
      throw new Error(`No widget found matching selector: ${this.selector.toWireFormat()}`);
    }
    await this.sendRequest('ext.fliwright.gesture', {
      selector: this.selector.toWireFormat(),
      gesture: 'pinch',
      scale,
      steps: options?.steps ?? 10,
    });
  }
```

Update mock in `packages/fliwright-core/tests/Locator.test.ts` to handle gesture:

```typescript
    if (method === 'ext.fliwright.gesture') {
      return responses['gesture'] ?? { success: true, gesture: 'longPress' };
    }
```

Add tests:

```typescript
  it('longPress() sends gesture request', async () => {
    const sendRequest = createMockSendRequest({
      inspect: { widgets: [testWidget], count: 1 },
      gesture: { success: true, gesture: 'longPress' },
    });

    const locator = new Locator('text=Card', sendRequest);
    await locator.longPress();

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.gesture', {
      selector: 'text=Card',
      gesture: 'longPress',
      duration: 500,
    });
  });

  it('drag() sends gesture request with delta', async () => {
    const sendRequest = createMockSendRequest({
      inspect: { widgets: [testWidget], count: 1 },
      gesture: { success: true, gesture: 'drag' },
    });

    const locator = new Locator('text=Item', sendRequest);
    await locator.drag(100, -50, { steps: 5 });

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.gesture', {
      selector: 'text=Item',
      gesture: 'drag',
      deltaX: 100,
      deltaY: -50,
      steps: 5,
    });
  });

  it('pinch() sends gesture request with scale', async () => {
    const sendRequest = createMockSendRequest({
      inspect: { widgets: [testWidget], count: 1 },
      gesture: { success: true, gesture: 'pinch' },
    });

    const locator = new Locator('text=Map', sendRequest);
    await locator.pinch(0.5);

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.gesture', {
      selector: 'text=Map',
      gesture: 'pinch',
      scale: 0.5,
      steps: 10,
    });
  });
```

- [ ] **Step 6: Run all tests**

Run: `cd packages/fliwright-core && pnpm test`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/fliwright-bridge/lib/src/extensions/gesture.dart packages/fliwright-bridge/test/extension_registry_test.dart packages/fliwright-core/src/Locator.ts packages/fliwright-core/tests/Locator.test.ts
git commit -m "feat: add gesture extensions — longPress, drag, pinch + Locator methods"
```

---

### Task 8: TS — FailureCollector

**Files:**
- Modify: `packages/fliwright-core/src/types.ts`
- Create: `packages/fliwright-core/src/FailureCollector.ts`
- Create: `packages/fliwright-core/tests/FailureCollector.test.ts`
- Modify: `packages/fliwright-core/src/Assertion.ts`
- Modify: `packages/fliwright-core/src/index.ts`

- [ ] **Step 1: Add FailureContext type to types.ts**

Add to `packages/fliwright-core/src/types.ts`:

```typescript
export interface FailureContext {
  assertion: {
    matcher: string;
    expected: string;
    actual: string;
    timeout: number;
  };
  screenshot: Buffer | null;
  widgetTree: object;
  source: {
    file: string;
    line: number;
    snippet: string;
  };
  timestamp: string;
}
```

- [ ] **Step 2: Write failing test**

Create `packages/fliwright-core/tests/FailureCollector.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { FailureCollector } from '../src/FailureCollector.js';
import { AssertionError } from '../src/Assertion.js';

describe('FailureCollector', () => {
  it('collects failure context from AssertionError', async () => {
    const mockSendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.flutter.driver.screenshot') {
        return { screenshot: Buffer.from('png-data').toString('base64') };
      }
      if (method === 'ext.fliwright.inspect') {
        return { widgets: [], count: 0 };
      }
      return {};
    });

    const collector = new FailureCollector(mockSendRequest);
    const error = new AssertionError('toBeVisible', 'visible', 'not visible', 'text=Login');

    const context = await collector.collect(error, 5000);

    expect(context.assertion.matcher).toBe('toBeVisible');
    expect(context.assertion.expected).toBe('visible');
    expect(context.assertion.actual).toBe('not visible');
    expect(context.assertion.timeout).toBe(5000);
    expect(context.timestamp).toBeDefined();
    expect(context.widgetTree).toBeDefined();
  });

  it('handles screenshot failure gracefully', async () => {
    const mockSendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.flutter.driver.screenshot') {
        throw new Error('Screenshot not available');
      }
      if (method === 'ext.fliwright.inspect') {
        return { widgets: [], count: 0 };
      }
      return {};
    });

    const collector = new FailureCollector(mockSendRequest);
    const error = new AssertionError('toBeVisible', 'visible', 'not visible', 'text=Login');

    const context = await collector.collect(error, 5000);

    expect(context.screenshot).toBeNull();
    expect(context.assertion.matcher).toBe('toBeVisible');
  });

  it('extracts source location from stack trace', async () => {
    const mockSendRequest = vi.fn().mockResolvedValue({});
    const collector = new FailureCollector(mockSendRequest);

    const error = new AssertionError('toBeVisible', 'visible', 'not visible', 'text=Login');
    error.stack = 'AssertionError: toBeVisible\n    at Object.<anonymous> (/tests/login.test.ts:42:5)';

    const context = await collector.collect(error, 5000);

    expect(context.source.file).toMatch(/login\.test\.ts/);
    expect(context.source.line).toBe(42);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/fliwright-core && pnpm vitest run tests/FailureCollector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement FailureCollector**

Create `packages/fliwright-core/src/FailureCollector.ts`:

```typescript
import type { FailureContext } from './types.js';
import type { AssertionError } from './Assertion.js';

type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export class FailureCollector {
  constructor(private sendRequest: SendRequest) {}

  async collect(error: AssertionError, timeout: number): Promise<FailureContext> {
    const [screenshot, widgetTree, source] = await Promise.all([
      this._takeScreenshot(),
      this._collectWidgetTree(),
      Promise.resolve(this._extractSource(error)),
    ]);

    return {
      assertion: {
        matcher: error.matcher,
        expected: error.expected,
        actual: error.actual,
        timeout,
      },
      screenshot,
      widgetTree,
      source,
      timestamp: new Date().toISOString(),
    };
  }

  private async _takeScreenshot(): Promise<Buffer | null> {
    try {
      const result = (await this.sendRequest('ext.flutter.driver.screenshot', {})) as { screenshot?: string };
      if (result.screenshot) {
        return Buffer.from(result.screenshot, 'base64');
      }
      return null;
    } catch {
      return null;
    }
  }

  private async _collectWidgetTree(): Promise<object> {
    try {
      const result = await this.sendRequest('ext.fliwright.inspect', { selector: '' });
      return result as object;
    } catch {
      return { error: 'Failed to collect widget tree' };
    }
  }

  private _extractSource(error: AssertionError): { file: string; line: number; snippet: string } {
    const stack = error.stack ?? '';
    const match = stack.match(/at\s+.*\(([^)]+):(\d+):\d+\)/);
    if (match) {
      return {
        file: match[1],
        line: parseInt(match[2], 10),
        snippet: error.message,
      };
    }
    return {
      file: '<unknown>',
      line: 0,
      snippet: error.message,
    };
  }
}
```

- [ ] **Step 5: Wire FailureCollector into Assertion engine**

Modify `packages/fliwright-core/src/Assertion.ts` — update the constructor to accept an optional `FailureCollector`, and modify error throwing to collect context.

Update the `Assertion` class constructor and add a `failureCollector` field:

```typescript
export class Assertion {
  private _isNegated = false;
  private failureCollector: FailureCollector | null;

  constructor(
    private locator: Locator,
    private negated = false,
    failureCollector?: FailureCollector,
  ) {
    this._isNegated = negated;
    this.failureCollector = failureCollector ?? null;
  }

  get not(): Assertion {
    return new Assertion(this.locator, !this._isNegated, this.failureCollector ?? undefined);
  }
```

Add import at top of `Assertion.ts`:

```typescript
import type { FailureCollector } from './FailureCollector.js';
```

Update `createExpect` to accept an optional FailureCollector:

```typescript
export function createExpect(locator: Locator, failureCollector?: FailureCollector): Assertion {
  return new Assertion(locator, false, failureCollector);
}
```

- [ ] **Step 6: Run all tests**

Run: `cd packages/fliwright-core && pnpm test`
Expected: All tests PASS.

- [ ] **Step 7: Export from index.ts**

Add to `packages/fliwright-core/src/index.ts`:

```typescript
export { FailureCollector } from './FailureCollector.js';
```

- [ ] **Step 8: Commit**

```bash
git add packages/fliwright-core/src/FailureCollector.ts packages/fliwright-core/src/types.ts packages/fliwright-core/src/Assertion.ts packages/fliwright-core/src/index.ts packages/fliwright-core/tests/FailureCollector.test.ts
git commit -m "feat(core): add FailureCollector — screenshot + widget tree + source on assertion failure"
```

---

## Iteration 2-D: Vitest Integration

Delivers: Full test lifecycle with fixtures, reporters, and device management.

---

### Task 9: Create `@fliwright/vitest` package skeleton

**Files:**
- Create: `packages/fliwright-vitest/package.json`
- Create: `packages/fliwright-vitest/tsconfig.json`
- Create: `packages/fliwright-vitest/vitest.config.ts`

- [ ] **Step 1: Create package.json**

Create `packages/fliwright-vitest/package.json`:

```json
{
  "name": "@fliwright/vitest",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@fliwright/core": "workspace:*",
    "vitest": "^2.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `packages/fliwright-vitest/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

Create `packages/fliwright-vitest/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Install dependencies**

Run: `cd /Volumes/HIKSEMI/project/fliwright && pnpm install`
Expected: Dependencies installed, workspace linked.

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-vitest/package.json packages/fliwright-vitest/tsconfig.json packages/fliwright-vitest/vitest.config.ts pnpm-lock.yaml
git commit -m "chore: scaffold @fliwright/vitest package"
```

---

### Task 10: Implement Vitest fixtures and globalSetup

**Files:**
- Create: `packages/fliwright-vitest/src/setup.ts`
- Create: `packages/fliwright-vitest/src/index.ts`
- Create: `packages/fliwright-vitest/src/reporter.ts`

- [ ] **Step 1: Write failing test**

Create `packages/fliwright-vitest/tests/` directory, then `packages/fliwright-vitest/tests/integration.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createFliwrightTest, defineConfig } from '../src/index.js';

describe('createFliwrightTest', () => {
  it('creates a test function with page fixture', () => {
    const test = createFliwrightTest({
      vmServiceUrl: 'ws://localhost:12345/ws',
    });
    expect(test).toBeDefined();
    expect(typeof test).toBe('function');
  });

  it('defineConfig merges defaults', () => {
    const config = defineConfig({
      vmServiceUrl: 'ws://localhost:12345/ws',
      timeout: 10000,
    });
    expect(config.vmServiceUrl).toBe('ws://localhost:12345/ws');
    expect(config.timeout).toBe(10000);
    expect(config.screenshot).toBe('file');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/fliwright-vitest && pnpm vitest run tests/integration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement setup.ts**

Create `packages/fliwright-vitest/src/setup.ts`:

```typescript
import { FliwrightDriver } from '@fliwright/core';

let driver: FliwrightDriver | null = null;

export interface SetupOptions {
  vmServiceUrl: string;
}

export async function globalSetup(options: SetupOptions): Promise<void> {
  driver = new FliwrightDriver();
  await driver.connect(options.vmServiceUrl);
}

export function getDriver(): FliwrightDriver | null {
  return driver;
}

export async function globalTeardown(): Promise<void> {
  if (driver) {
    await driver.dispose();
    driver = null;
  }
}
```

- [ ] **Step 4: Implement index.ts (public API)**

Create `packages/fliwright-vitest/src/index.ts`:

```typescript
import { test as vitestTest, expect as vitestExpect, beforeAll, afterAll, afterEach } from 'vitest';
import { FliwrightDriver } from '@fliwright/core';
import { createExpect } from '@fliwright/core';
import type { Page } from '@fliwright/core';
import type { SelectorInput } from '@fliwright/core';
import { FailureCollector } from '@fliwright/core';

export interface FliwrightConfig {
  vmServiceUrl: string;
  timeout?: number;
  screenshot?: 'file' | 'base64' | 'off';
}

export function defineConfig(overrides: Partial<FliwrightConfig> & { vmServiceUrl: string }): FliwrightConfig {
  return {
    timeout: 5000,
    screenshot: 'file',
    ...overrides,
  };
}

let sharedDriver: FliwrightDriver | null = null;

export function createFliwrightTest(config: FliwrightConfig) {
  const fliwrightTest = vitestTest.extend<{ page: Page }>({
    page: async ({}, use) => {
      if (!sharedDriver) {
        sharedDriver = new FliwrightDriver();
        await sharedDriver.connect(config.vmServiceUrl);
      }
      await use(sharedDriver.page);
    },
  });

  return fliwrightTest;
}

export { createExpect as expect };
```

- [ ] **Step 5: Implement reporter.ts**

Create `packages/fliwright-vitest/src/reporter.ts`:

```typescript
import type { Reporter, File, Task } from 'vitest';

export class FliwrightReporter implements Reporter {
  onInit() {
    // Reporter initialized
  }

  onFinished(files: File[]) {
    for (const file of files) {
      for (const task of file.tasks) {
        if (task.type === 'test' && task.result?.state === 'failed') {
          const errors = task.result.errors ?? [];
          for (const err of errors) {
            if (err.stack) {
              const failureMatch = err.stack.match(/\.fliwright\/failures\/[^\s]+\.png/);
              if (failureMatch) {
                console.log(`  Screenshot: ${failureMatch[0]}`);
              }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/fliwright-vitest && pnpm vitest run tests/integration.test.ts`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/fliwright-vitest/src/ packages/fliwright-vitest/tests/
git commit -m "feat(vitest): add test fixture, expect, defineConfig, and reporter"
```

---

### Task 11: Wire everything together — end-to-end smoke test update

**Files:**
- Modify: `packages/fliwright-core/src/index.ts` — final export audit

- [ ] **Step 1: Verify index.ts exports everything**

Read `packages/fliwright-core/src/index.ts` and confirm it exports:
- `Selector` class
- `SelectorInput` type
- `Assertion`, `AssertionError`, `createExpect`
- `FailureCollector`
- `FailureContext` type
- All existing exports (types, classes, interfaces)

Add any missing exports.

- [ ] **Step 2: Run full test suite across all packages**

Run: `cd /Volumes/HIKSEMI/project/fliwright && pnpm build && pnpm test`
Expected: All tests PASS across all packages.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: final export audit and cross-package test verification for slice 2"
```

---

## Spec Coverage Check

| Spec Section | Task |
|-------------|------|
| 2.1 Type extension | Task 1 |
| 2.2 Scroll extension | Task 5 |
| 2.3 Gesture extension (longPress, drag, pinch) | Task 7 |
| 2.4 Assertion engine (toBeVisible, toHaveText, toContainText, toBeEnabled, toBeDisabled) | Task 4 |
| 2.5 Extended selectors (byKey, byType, composite) | Task 2, Task 6 |
| 2.6 Failure context (screenshot, widget tree, source) | Task 8 |
| 2.7 Vitest integration (fixture, lifecycle, reporter) | Task 9, Task 10, Task 11 |
