# Recorder Specificity-Guaranteed Selectors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the visual recorder emit selectors that resolve to exactly one element at record time, replacing vague `{ type: 'GestureDetector' }` output with specific, uniqueness-verified locators.

**Architecture:** Enrich Dart `hitTest` to return descendant text/icon, tooltip, and keyed ancestors; build a structured base selector from a richer priority cascade; verify uniqueness via the existing `ext.fliwright.resolve` endpoint; adaptively disambiguate (`within` keyed ancestor → `containing` descendant text → `nth`) picking the shortest unique selector; serialize structured selectors for both TS and Dart codegen.

**Tech Stack:** TypeScript (Zod, Vitest), Dart/Flutter (`packages/fliwright-bridge`), VM Service extensions.

**Spec:** `docs/superpowers/specs/2026-06-15-recorder-specific-selectors-design.md`

**Conventions:** TS test command `pnpm --filter @fliwright/core test`, lint `pnpm --filter @fliwright/core lint` (`tsc --noEmit`). Dart: `melos run analyze`, `melos run test`. Conventional commits (`feat(core): …`, `feat(bridge): …`). TDD: failing test first.

---

## File Structure

**TypeScript — `packages/fliwright-core`:**
- `src/types.ts` — extend `WidgetInfo`; add `KeyedAncestor`, `ResolvedSelector`.
- `src/wire-protocol.ts` — add `widgetInfoSchema`, `keyedAncestorSchema`; export them.
- `src/SelectorResolver.ts` — replace string `resolveSelector` with `buildBaseSelector(widget): SelectorQuery`.
- `src/SelectorSerializer.ts` — **new** — `serializeSelectorQuery(query): string`.
- `src/RecordedSelectorResolver.ts` — **new** — verification + adaptive disambiguation engine.
- `src/RecorderController.ts` — wire the new resolver; store `Map<number, ResolvedSelector>`.
- `src/CodeGenerator.ts` — accept `ResolvedSelector`; serialize; emit `// ambiguous` comment.
- `src/DartCodeGenerator.ts` — replace regex `dartFinder` with structural `SelectorQuery → finder` mapping.
- `src/index.ts` — export new symbols.
- `tests/SelectorResolver.test.ts`, `tests/SelectorSerializer.test.ts` (**new**), `tests/RecordedSelectorResolver.test.ts` (**new**), `tests/wire-protocol.test.ts`, `tests/RecorderController.test.ts`, `tests/CodeGenerator.test.ts`, `tests/DartCodeGenerator.test.ts` — tests.

**Dart — `packages/fliwright-bridge`:**
- `lib/src/extensions/inspect.dart` — add descendant/tooltip/keyed-ancestor helpers; extend `extractWidgetInfo` with opt-in flags.
- `lib/src/extensions/recording.dart` — `_hitTest` passes the new flags.
- `test/recording_test.dart` — test the new helpers.

---

## Task 1: Extend `WidgetInfo` type and add wire-protocol schema

**Files:**
- Modify: `packages/fliwright-core/src/types.ts` (extend `WidgetInfo`, add `KeyedAncestor`, `ResolvedSelector`)
- Modify: `packages/fliwright-core/src/wire-protocol.ts` (add `keyedAncestorSchema`, `widgetInfoSchema`)
- Test: `packages/fliwright-core/tests/wire-protocol.test.ts`

- [ ] **Step 1: Write the failing contract test**

First, add `widgetInfoSchema` to the existing top-level import from `wire-protocol.js` (around line 18 of `packages/fliwright-core/tests/wire-protocol.test.ts`):

```ts
import {
  selectorQuerySchema,
  matchCriteriaSchema,
  filterCriteriaSchema,
  fallbackCriteriaSchema,
  positionFilterSchema,
  parseSelectorJson,
  widgetInfoSchema,
} from '../src/wire-protocol.js';
```

Then add a new `describe` block at the end of the file:

```ts
describe('wire protocol: WidgetInfo schema', () => {
  it('parses a hitTest payload with recorder enrichment fields', () => {
    const payload = {
      id: '42',
      type: 'GestureDetector',
      tooltip: 'Open menu',
      descendantText: 'Login',
      descendantIcon: { codePoint: 59526, fontFamily: 'MaterialIcons' },
      keyedAncestors: [{ key: 'appBar', type: 'Scaffold' }],
      properties: {},
    };
    const parsed = widgetInfoSchema.parse(payload);
    expect(parsed.type).toBe('GestureDetector');
    expect(parsed.descendantText).toBe('Login');
    expect(parsed.descendantIcon?.codePoint).toBe(59526);
    expect(parsed.keyedAncestors).toEqual([{ key: 'appBar', type: 'Scaffold' }]);
  });

  it('accepts a minimal WidgetInfo without enrichment fields', () => {
    const parsed = widgetInfoSchema.parse({ id: '1', type: 'Text', properties: {} });
    expect(parsed.descendantText).toBeUndefined();
    expect(parsed.keyedAncestors).toBeUndefined();
  });

  it('rejects a WidgetInfo missing required id', () => {
    expect(() => widgetInfoSchema.parse({ type: 'Text', properties: {} })).toThrow();
  });
});
```

Also extend the existing JSON-Schema export test so `WidgetInfo` is included. Inside the existing `it('exports valid JSON Schema for all protocol types', …)` (in the `describe('wire protocol JSON Schema export', …)` block), compute and add the schema to the `definitions` object:

```ts
    const widgetInfoJson = zodToJsonSchema(widgetInfoSchema, { target: 'draft7' });
    // …and inside the `definitions: { … }` object literal add:
        WidgetInfo: widgetInfoJson,
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fliwright/core test wire-protocol`
Expected: FAIL — `widgetInfoSchema` is not exported.

- [ ] **Step 3: Extend `WidgetInfo` and add the Zod schema**

In `packages/fliwright-core/src/types.ts`, add a `KeyedAncestor` interface above `WidgetInfo`, extend `WidgetInfo` with the four optional enrichment fields, and add `ResolvedSelector` near the other result interfaces (e.g. after `HealingResult`):

```ts
export interface KeyedAncestor {
  key: string;
  type: string;
}

export interface WidgetInfo {
  id: string;
  type: string;
  text?: string;
  key?: string;
  name?: string;
  ancestorKey?: string;
  semanticsId?: string;
  semanticsLabel?: string;
  semanticsHint?: string;
  role?: string;
  rect?: { x: number; y: number; width: number; height: number };
  hitTestable?: boolean;
  properties: Record<string, unknown>;
  tooltip?: string;
  descendantText?: string;
  descendantIcon?: { codePoint: number; fontFamily?: string; fontPackage?: string };
  keyedAncestors?: KeyedAncestor[];
}

export interface ResolvedSelector {
  query: SelectorQuery;
  ambiguous: boolean;
  matchCount: number;
}
```

In `packages/fliwright-core/src/wire-protocol.ts`, add (after `positionFilterSchema`):

```ts
// ── KeyedAncestor / WidgetInfo (hitTest response) ──────────────────

export const keyedAncestorSchema = z.object({
  key: nonEmptyString,
  type: nonEmptyString,
}).strict();

export const descendantIconSchema = z.object({
  codePoint: z.number().int().nonnegative(),
  fontFamily: nonEmptyString.optional(),
  fontPackage: nonEmptyString.optional(),
}).strict();

export const widgetInfoSchema = z.object({
  id: z.string(),
  type: z.string(),
  text: nonEmptyString.optional(),
  key: nonEmptyString.optional(),
  name: nonEmptyString.optional(),
  ancestorKey: nonEmptyString.optional(),
  semanticsId: nonEmptyString.optional(),
  semanticsLabel: nonEmptyString.optional(),
  semanticsHint: nonEmptyString.optional(),
  role: nonEmptyString.optional(),
  tooltip: nonEmptyString.optional(),
  descendantText: nonEmptyString.optional(),
  descendantIcon: descendantIconSchema.optional(),
  keyedAncestors: z.array(keyedAncestorSchema).optional(),
  rect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).strict().optional(),
  hitTestable: z.boolean().optional(),
  properties: z.record(z.unknown()),
}).strict();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @fliwright/core test wire-protocol`
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `pnpm --filter @fliwright/core lint`
Expected: PASS (no type errors).

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-core/src/types.ts packages/fliwright-core/src/wire-protocol.ts packages/fliwright-core/tests/wire-protocol.test.ts packages/fliwright-bridge/test/fixtures/wire-protocol-schema.json
git commit -m "feat(core): add WidgetInfo enrichment fields and wire-protocol schema"
```

---

## Task 2: Enrich Dart `_hitTest` with descendant/tooltip/ancestor context

**Files:**
- Modify: `packages/fliwright-bridge/lib/src/extensions/inspect.dart` (add helpers; extend `extractWidgetInfo`)
- Modify: `packages/fliwright-bridge/lib/src/extensions/recording.dart` (`_hitTest` passes new flags)
- Test: `packages/fliwright-bridge/test/recording_test.dart`

- [ ] **Step 1: Write the failing Dart test**

Add to `packages/fliwright-bridge/test/recording_test.dart`:

```dart
import 'package:fliwright_bridge/src/extensions/inspect.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('extractWidgetInfo captures descendant text, tooltip, and keyed ancestors',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          key: const ValueKey('scaffoldKey'),
          body: GestureDetector(
            key: const ValueKey('tapTarget'),
            child: const Icon(Icons.add),
          ),
        ),
      ),
    );
    final element = tester.element(find.byKey(const ValueKey('tapTarget')));

    final info = InspectExtension.extractWidgetInfo(
      element,
      includeDescendantText: true,
      includeDescendantIcon: true,
      includeTooltip: true,
      includeKeyedAncestors: true,
    )!;

    expect(info['type'], 'GestureDetector');
    expect(info['descendantIcon'], isNotNull);
    expect((info['descendantIcon'] as Map)['codePoint'], Icons.add.codePoint);
    final ancestors = info['keyedAncestors'] as List;
    expect(ancestors.any((a) => a['key'] == 'scaffoldKey'), isTrue);
  });

  testWidgets('findDescendantText returns the inner Text of a wrapper',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: GestureDetector(child: const Text('Login')))),
    );
    final element = tester.element(find.byType(GestureDetector));
    expect(InspectExtension.findDescendantText(element), 'Login');
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `melos run test -- --plain-name "extractWidgetInfo captures descendant"`
Expected: FAIL — the named parameters and `findDescendantText` do not exist; analysis errors.

- [ ] **Step 3: Add the helpers to `inspect.dart`**

In `packages/fliwright-bridge/lib/src/extensions/inspect.dart`, add these static methods to the `InspectExtension` class (e.g. immediately after `findAncestorName`):

```dart
  /// First plain text rendered anywhere in this element's subtree.
  static String? findDescendantText(Element element) {
    String? found;
    void search(Element e) {
      if (found != null) return;
      final w = e.widget;
      if (w is Text) {
        found = w.data;
        return;
      }
      if (w is RichText) {
        found = w.text.toPlainText();
        return;
      }
      if (w is EditableText) {
        found = w.controller.text;
        return;
      }
      e.visitChildren(search);
    }
    element.visitChildren(search);
    return found;
  }

  /// First Icon in this element's subtree, as a wire-protocol map.
  static Map<String, dynamic>? findDescendantIcon(Element element) {
    Map<String, dynamic>? found;
    void search(Element e) {
      if (found != null) return;
      final w = e.widget;
      if (w is Icon && w.icon != null) {
        final data = w.icon!;
        found = {
          'codePoint': data.codePoint,
          'fontFamily': w.fontFamily ?? data.fontFamily,
          if (data.fontPackage != null) 'fontPackage': data.fontPackage,
        };
        return;
      }
      e.visitChildren(search);
    }
    element.visitChildren(search);
    return found;
  }

  /// Tooltip exposed by this widget (e.g. IconButton.tooltip) or the
  /// nearest ancestor Tooltip.
  static String? extractTooltip(Element element) {
    final w = element.widget;
    try {
      final t = (w as dynamic).tooltip;
      if (t is String && t.isNotEmpty) return t;
    } catch (_) {
      // Widget exposes no tooltip property.
    }
    String? found;
    element.visitAncestorElements((ancestor) {
      if (ancestor.widget is Tooltip) {
        final message = (ancestor.widget as Tooltip).message;
        if (message is String && message.isNotEmpty) {
          found = message;
          return false;
        }
      }
      if (ancestor.widget is Scaffold || ancestor.widget is WidgetsApp) return false;
      return true;
    });
    return found;
  }

  /// Up to [maxDepth] ancestors that carry a ValueKey, nearest-first.
  static List<Map<String, dynamic>> findKeyedAncestors(Element element,
      {int maxDepth = 3}) {
    final result = <Map<String, dynamic>>[];
    element.visitAncestorElements((ancestor) {
      if (result.length >= maxDepth) return false;
      if (ancestor.widget is Scaffold || ancestor.widget is WidgetsApp) return false;
      final key = extractKeyValue(ancestor.widget.key);
      if (key != null) {
        result.add({'key': key, 'type': ancestor.widget.runtimeType.toString()});
      }
      return true;
    });
    return result;
  }
```

- [ ] **Step 4: Extend `extractWidgetInfo` with opt-in flags**

In the same file, change the `extractWidgetInfo` signature to accept the new flags and emit the fields. Replace the existing signature and the final `return { … }` map:

```dart
  static Map<String, dynamic>? extractWidgetInfo(
    Element element, {
    bool includeAncestorKey = true,
    bool includeName = true,
    bool includeSemantics = true,
    bool includeDescendantText = false,
    bool includeDescendantIcon = false,
    bool includeTooltip = false,
    bool includeKeyedAncestors = false,
  }) {
```

(Keep the existing body that computes `text`, `widgetKey`, `ancestorKey`, `name`, `semantics`, `rect` unchanged.) Then add, just before the `return`:

```dart
    final descendantText =
        includeDescendantText ? findDescendantText(element) : null;
    final descendantIcon =
        includeDescendantIcon ? findDescendantIcon(element) : null;
    final tooltip = includeTooltip ? extractTooltip(element) : null;
    final keyedAncestors = includeKeyedAncestors
        ? findKeyedAncestors(element)
        : const <Map<String, dynamic>>[];
```

And extend the returned map (add the four conditional entries right before `'properties': <String, dynamic>{},`):

```dart
      if (descendantText != null) 'descendantText': descendantText,
      if (descendantIcon != null) 'descendantIcon': descendantIcon,
      if (tooltip != null) 'tooltip': tooltip,
      if (keyedAncestors.isNotEmpty) 'keyedAncestors': keyedAncestors,
```

- [ ] **Step 5: Make `_hitTest` request the enrichment**

In `packages/fliwright-bridge/lib/src/extensions/recording.dart`, replace the `extractWidgetInfo` call inside `_hitTest`:

```dart
    final info = InspectExtension.extractWidgetInfo(
      best!,
      includeDescendantText: true,
      includeDescendantIcon: true,
      includeTooltip: true,
      includeKeyedAncestors: true,
    );
```

- [ ] **Step 6: Run tests and analyze**

Run: `melos run test -- --plain-name "extractWidgetInfo captures descendant"`
Expected: PASS.
Run: `melos run test -- --plain-name "findDescendantText"`
Expected: PASS.
Run: `melos run analyze`
Expected: PASS (no analysis errors).

- [ ] **Step 7: Commit**

```bash
git add packages/fliwright-bridge/lib/src/extensions/inspect.dart packages/fliwright-bridge/lib/src/extensions/recording.dart packages/fliwright-bridge/test/recording_test.dart
git commit -m "feat(bridge): enrich hitTest with descendant text/icon, tooltip, keyed ancestors"
```

---

## Task 3: Replace `resolveSelector` with `buildBaseSelector` cascade

**Files:**
- Modify: `packages/fliwright-core/src/SelectorResolver.ts`
- Test: `packages/fliwright-core/tests/SelectorResolver.test.ts`

- [ ] **Step 1: Add failing cascade tests**

Add the following `describe` block to `packages/fliwright-core/tests/SelectorResolver.test.ts` (keep the existing `resolveSelector` tests for now — they are removed in Task 6 once that function is deleted):

```ts
import { buildBaseSelector } from '../src/SelectorResolver.js';

describe('buildBaseSelector priority cascade', () => {
  it('prefers text', () => {
    const widget: Partial<WidgetInfo> = { type: 'ElevatedButton', text: 'Login' };
    expect(buildBaseSelector(widget)).toEqual({ match: { text: 'Login' } });
  });

  it('uses key when no text', () => {
    const widget: Partial<WidgetInfo> = { type: 'Widget', key: 'loginButton' };
    expect(buildBaseSelector(widget)).toEqual({ match: { key: 'loginButton' } });
  });

  it('uses tooltip before semanticsLabel', () => {
    const widget: Partial<WidgetInfo> = { type: 'IconButton', tooltip: 'Add' };
    expect(buildBaseSelector(widget)).toEqual({ match: { tooltip: 'Add' } });
  });

  it('uses semanticsLabel when no tooltip', () => {
    const widget: Partial<WidgetInfo> = { type: 'GestureDetector', semanticsLabel: 'Open drawer' };
    expect(buildBaseSelector(widget)).toEqual({ match: { semanticsLabel: 'Open drawer' } });
  });

  it('maps known type to role when nothing more specific', () => {
    const widget: Partial<WidgetInfo> = { type: 'ElevatedButton' };
    expect(buildBaseSelector(widget)).toEqual({ match: { role: 'button' } });
  });

  it('uses widget.role over ROLE_MAP', () => {
    const widget: Partial<WidgetInfo> = { type: 'Semantics', role: 'link' };
    expect(buildBaseSelector(widget)).toEqual({ match: { role: 'link' } });
  });

  it('uses name when no role', () => {
    const widget: Partial<WidgetInfo> = { type: 'Custom', name: 'emailField' };
    expect(buildBaseSelector(widget)).toEqual({ match: { name: 'emailField' } });
  });

  it('uses ancestorKey as a base criterion when nothing else', () => {
    const widget: Partial<WidgetInfo> = { type: 'Card', ancestorKey: 'form' };
    expect(buildBaseSelector(widget)).toEqual({ match: { ancestorKey: 'form' } });
  });

  it('falls back to type', () => {
    const widget: Partial<WidgetInfo> = { type: 'GestureDetector' };
    expect(buildBaseSelector(widget)).toEqual({ match: { type: 'GestureDetector' } });
  });

  it('falls back to generic Widget for empty widget', () => {
    expect(buildBaseSelector({})).toEqual({ match: { type: 'Widget' } });
  });

  it('trims whitespace in field values', () => {
    const widget: Partial<WidgetInfo> = { type: 'Text', text: '  Login  ' };
    expect(buildBaseSelector(widget)).toEqual({ match: { text: 'Login' } });
  });
});
```

(Add the `buildBaseSelector` import alongside the existing `SelectorResolver, resolveSelector` import at the top of the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fliwright/core test SelectorResolver`
Expected: FAIL — `buildBaseSelector` is not exported.

- [ ] **Step 3: Add `buildBaseSelector` to `SelectorResolver.ts`**

Add the following to `packages/fliwright-core/src/SelectorResolver.ts` (alongside the existing `resolveSelector`, reusing the existing `ROLE_MAP`). Add `SelectorQuery` to the type import from `./types.js`:

```ts
import type { FilterCriteria, MatchCriteria, SelectorAst, SelectorInput, SelectorQuery, TextMatchMode } from './types.js';

function trimmed(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

/**
 * Build the most specific base SelectorQuery for a hit-tested widget.
 * Priority: text → key → tooltip → semanticsLabel → role → name →
 * semanticsHint → ancestorKey → type (→ generic Widget).
 *
 * Returns a structured SelectorQuery (not a string) so downstream steps can
 * attach within / containing / position for disambiguation.
 */
export function buildBaseSelector(widget: Partial<WidgetInfo>): SelectorQuery {
  const text = trimmed(widget.text);
  if (text) return { match: { text } };

  const key = trimmed(widget.key);
  if (key) return { match: { key } };

  const tooltip = trimmed(widget.tooltip);
  if (tooltip) return { match: { tooltip } };

  const semanticsLabel = trimmed(widget.semanticsLabel);
  if (semanticsLabel) return { match: { semanticsLabel } };

  const role = trimmed(widget.role) ?? ROLE_MAP[widget.type ?? ''];
  if (role) return { match: { role } };

  const name = trimmed(widget.name);
  if (name) return { match: { name } };

  const semanticsHint = trimmed(widget.semanticsHint);
  if (semanticsHint) return { match: { semanticsHint } };

  const ancestorKey = trimmed(widget.ancestorKey);
  if (ancestorKey) return { match: { ancestorKey } };

  const type = trimmed(widget.type);
  return { match: { type: type ?? 'Widget' } };
}
```

Leave the existing `resolveSelector` function and `SelectorResolver` class in place — they are removed in Task 6 once `RecorderController` no longer imports `resolveSelector`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @fliwright/core test SelectorResolver`
Expected: PASS (new cascade tests + existing resolveSelector tests).

- [ ] **Step 5: Lint**

Run: `pnpm --filter @fliwright/core lint`
Expected: PASS (the tree stays green — `resolveSelector` still exists for `RecorderController`).

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-core/src/SelectorResolver.ts packages/fliwright-core/tests/SelectorResolver.test.ts
git commit -m "feat(core): replace resolveSelector with structured buildBaseSelector cascade"
```

---

## Task 4: Add `serializeSelectorQuery` for codegen and frame display

**Files:**
- Create: `packages/fliwright-core/src/SelectorSerializer.ts`
- Create: `packages/fliwright-core/tests/SelectorSerializer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/fliwright-core/tests/SelectorSerializer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serializeSelectorQuery } from '../src/SelectorSerializer.js';
import type { SelectorQuery } from '../src/types.js';

describe('serializeSelectorQuery', () => {
  it('emits shorthand for a single text criterion', () => {
    expect(serializeSelectorQuery({ match: { text: 'Login' } })).toBe("{ text: 'Login' }");
  });

  it('emits shorthand for a single key criterion', () => {
    expect(serializeSelectorQuery({ match: { key: 'submit' } })).toBe("{ key: 'submit' }");
  });

  it('emits shorthand for a single type criterion', () => {
    expect(serializeSelectorQuery({ match: { type: 'GestureDetector' } })).toBe("{ type: 'GestureDetector' }");
  });

  it('escapes quotes and backslashes in values', () => {
    expect(serializeSelectorQuery({ match: { text: "user's \\path" } })).toBe(
      "{ text: 'user\\'s \\\\path' }",
    );
  });

  it('uses the full query form for role (no valid shorthand)', () => {
    expect(serializeSelectorQuery({ match: { role: 'button' } })).toBe("{ match: { role: 'button' } }");
  });

  it('serializes within as a nested query', () => {
    const q: SelectorQuery = { match: { type: 'GestureDetector' }, within: { match: { key: 'list' } } };
    expect(serializeSelectorQuery(q)).toBe("{ match: { type: 'GestureDetector' }, within: { key: 'list' } }");
  });

  it('serializes containing as a nested query', () => {
    const q: SelectorQuery = { match: { type: 'GestureDetector' }, containing: { match: { text: 'Login' } } };
    expect(serializeSelectorQuery(q)).toBe(
      "{ match: { type: 'GestureDetector' }, containing: { text: 'Login' } }",
    );
  });

  it('serializes nth position', () => {
    const q: SelectorQuery = { match: { type: 'GestureDetector' }, position: { nth: 2 } };
    expect(serializeSelectorQuery(q)).toBe("{ match: { type: 'GestureDetector' }, position: { nth: 2 } }");
  });

  it('serializes last position', () => {
    const q: SelectorQuery = { match: { type: 'GestureDetector' }, position: { last: true } };
    expect(serializeSelectorQuery(q)).toBe("{ match: { type: 'GestureDetector' }, position: { last: true } }");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fliwright/core test SelectorSerializer`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the serializer**

Create `packages/fliwright-core/src/SelectorSerializer.ts`:

```ts
import type { MatchCriteria, SelectorQuery } from './types.js';

/** Keys that have a valid `page.locator({...})` shorthand form. */
const SHORTHAND_KEYS = ['text', 'key', 'type'] as const;

function escapeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function matchObject(match: MatchCriteria): string {
  const entries: string[] = [];
  for (const [k, v] of Object.entries(match)) {
    if (typeof v === 'string') entries.push(`${k}: '${escapeValue(v)}'`);
    else if (typeof v === 'number') entries.push(`${k}: ${v}`);
    else if (typeof v === 'boolean') entries.push(`${k}: ${v}`);
  }
  return `{ ${entries.join(', ')} }`;
}

function positionObject(position: NonNullable<SelectorQuery['position']>): string {
  const entries: string[] = [];
  if (position.nth != null) entries.push(`nth: ${position.nth}`);
  if (position.first) entries.push('first: true');
  if (position.last) entries.push('last: true');
  return `{ ${entries.join(', ')} }`;
}

/**
 * Serialize a SelectorQuery into a `page.locator(...)` object-literal string.
 *
 * A query with a single text/key/type criterion and no scoping emits the
 * compact shorthand `{ text: 'x' }`. Everything else (role, semanticsLabel,
 * within, containing, position, …) emits the full query form, which is a valid
 * SelectorQuery and therefore a valid `page.locator` argument.
 */
export function serializeSelectorQuery(query: SelectorQuery): string {
  const hasExtras =
    !!(query.within || query.containing || query.position || query.and || query.or || query.filter);

  if (!hasExtras && query.match) {
    const keys = Object.keys(query.match);
    for (const shorthand of SHORTHAND_KEYS) {
      const value = (query.match as Record<string, unknown>)[shorthand];
      if (typeof value === 'string' && value.length > 0 && keys.length === 1) {
        return `{ ${shorthand}: '${escapeValue(value)}' }`;
      }
    }
  }

  const parts: string[] = [];
  if (query.match) parts.push(`match: ${matchObject(query.match)}`);
  if (query.within) parts.push(`within: ${serializeSelectorQuery(query.within)}`);
  if (query.containing) parts.push(`containing: ${serializeSelectorQuery(query.containing)}`);
  if (query.position) parts.push(`position: ${positionObject(query.position)}`);
  return `{ ${parts.join(', ')} }`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @fliwright/core test SelectorSerializer`
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `pnpm --filter @fliwright/core lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-core/src/SelectorSerializer.ts packages/fliwright-core/tests/SelectorSerializer.test.ts
git commit -m "feat(core): add serializeSelectorQuery for structured selector output"
```

---

## Task 5: Verification + adaptive disambiguation engine

**Files:**
- Create: `packages/fliwright-core/src/RecordedSelectorResolver.ts`
- Create: `packages/fliwright-core/tests/RecordedSelectorResolver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/fliwright-core/tests/RecordedSelectorResolver.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { RecordedSelectorResolver } from '../src/RecordedSelectorResolver.js';
import type { WidgetInfo } from '../src/types.js';

const op = { kind: 'tap' as const, position: { x: 10, y: 20 }, timestamp: 1000 };

function resolver(hitTestWidget: Partial<WidgetInfo> | null, resolveBySelector: (q: any) => any) {
  const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
    if (method === 'ext.fliwright.hitTest') {
      return Promise.resolve(hitTestWidget == null ? { widget: {} } : { widget: hitTestWidget });
    }
    if (method === 'ext.fliwright.resolve') {
      const query = JSON.parse((params as { selector: string }).selector);
      return Promise.resolve(resolveBySelector(query));
    }
    return Promise.resolve({});
  });
  return new RecordedSelectorResolver(sendRequest);
}

describe('RecordedSelectorResolver', () => {
  it('returns the base selector when it is already unique', async () => {
    const r = resolver(
      { id: '1', type: 'ElevatedButton', text: 'Login', properties: {} },
      () => ({ count: 1 }),
    );
    const result = await r.resolveUniqueSelector(op);
    expect(result.query).toEqual({ match: { text: 'Login' } });
    expect(result.ambiguous).toBe(false);
  });

  it('disambiguates with within(keyed ancestor) when the base matches many', async () => {
    const widget: Partial<WidgetInfo> = {
      id: '1', type: 'GestureDetector', properties: {},
      keyedAncestors: [{ key: 'cardList', type: 'Column' }],
    };
    const r = resolver(widget, (q: any) => {
      // base and containing match many; the within-scoped query matches one
      if (q.within) return { count: 1 };
      return { count: 5 };
    });
    const result = await r.resolveUniqueSelector(op);
    expect(result.query.within).toEqual({ match: { key: 'cardList' } });
    expect(result.ambiguous).toBe(false);
  });

  it('disambiguates with containing(descendant text) when within does not help', async () => {
    const widget: Partial<WidgetInfo> = {
      id: '1', type: 'GestureDetector', descendantText: 'Login', properties: {},
    };
    const r = resolver(widget, (q: any) => {
      if (q.containing) return { count: 1 };
      return { count: 3 };
    });
    const result = await r.resolveUniqueSelector(op);
    expect(result.query.containing).toEqual({ match: { text: 'Login' } });
    expect(result.ambiguous).toBe(false);
  });

  it('falls back to nth and flags ambiguous when nothing else is unique', async () => {
    const widget: Partial<WidgetInfo> = {
      id: '7', type: 'GestureDetector', properties: {},
      rect: { x: 0, y: 0, width: 10, height: 10 },
    };
    const r = resolver(widget, (q: any) => {
      if (q.position?.nth != null) return { count: 1 };
      // For the un-scoped resolution used to compute the index, return an
      // ordered list whose second entry is our target.
      return {
        count: 2,
        matches: [
          { id: '3', type: 'GestureDetector', rect: { x: 0, y: 0, width: 5, height: 5 }, properties: {} },
          widget,
        ],
      };
    });
    const result = await r.resolveUniqueSelector(op);
    expect(result.query.position?.nth).toBe(1);
    expect(result.ambiguous).toBe(true);
    expect(result.matchCount).toBe(2);
  });

  it('returns a generic Widget selector when hitTest is empty', async () => {
    const r = resolver(null, () => ({ count: 0 }));
    const result = await r.resolveUniqueSelector(op);
    expect(result.query).toEqual({ match: { type: 'Widget' } });
    expect(result.ambiguous).toBe(true);
  });

  it('survives a resolve rejection by falling back to nth/ambiguous', async () => {
    const widget: Partial<WidgetInfo> = { id: '1', type: 'GestureDetector', properties: {} };
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.hitTest') return Promise.resolve({ widget });
      if (method === 'ext.fliwright.resolve') return Promise.reject(new Error('boom'));
      return Promise.resolve({});
    });
    const r = new RecordedSelectorResolver(sendRequest);
    const result = await r.resolveUniqueSelector(op);
    expect(result.ambiguous).toBe(true);
    expect(result.query.match?.type).toBe('GestureDetector');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fliwright/core test RecordedSelectorResolver`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the engine**

Create `packages/fliwright-core/src/RecordedSelectorResolver.ts`:

```ts
import type {
  RecordedOperation,
  ResolvedSelector,
  SelectorQuery,
  WidgetInfo,
} from './types.js';
import { buildBaseSelector } from './SelectorResolver.js';
import { serializeSelectorQuery } from './SelectorSerializer.js';

type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

const RESOLVE_LIMIT = 8;
const NTH_LIMIT = 64;
const MAX_KEYED_ANCESTORS = 3;

interface ResolveOutcome {
  count: number;
  matches: WidgetInfo[];
}

/**
 * Resolves a recorded operation to a SelectorQuery that is unique at record
 * time. Pipeline: hitTest → buildBaseSelector → resolve(count) → adaptive
 * disambiguation (within keyed ancestor → containing descendant text → nth).
 *
 * Uniqueness semantics: count === 1 → unique; count === 0 → unverifiable,
 * keep the base selector (best-effort); count > 1 → disambiguate; a resolve
 * *failure* (exception) → keep the base selector but flag ambiguous.
 */
export class RecordedSelectorResolver {
  constructor(private readonly sendRequest: SendRequest) {}

  async resolveUniqueSelector(op: RecordedOperation): Promise<ResolvedSelector> {
    const widget = await this.hitTest(op);
    if (!widget?.type) {
      return { query: { match: { type: 'Widget' } }, ambiguous: true, matchCount: 0 };
    }

    const base = buildBaseSelector(widget);
    const initial = await this.countMatches(base);

    // Resolve failed entirely → keep base, flag ambiguous (per spec).
    if (initial === null) {
      return { query: base, ambiguous: true, matchCount: 0 };
    }
    // Exactly one match → done.
    if (initial.count === 1) {
      return { query: base, ambiguous: false, matchCount: 1 };
    }
    // Zero matches → unverifiable (e.g. transient state); keep base, not ambiguous.
    if (initial.count === 0) {
      return { query: base, ambiguous: false, matchCount: 0 };
    }

    // count > 1 → try to disambiguate; fall back to nth (ambiguous).
    const disambiguated = await this.tryDisambiguators(base, widget);
    if (disambiguated) return disambiguated;

    const nthQuery = await this.nthFallback(base, widget, initial);
    return { query: nthQuery, ambiguous: true, matchCount: initial.count };
  }

  private async hitTest(op: RecordedOperation): Promise<Partial<WidgetInfo> | undefined> {
    try {
      const result = await this.sendRequest('ext.fliwright.hitTest', {
        x: op.position.x,
        y: op.position.y,
      }) as { widget?: Partial<WidgetInfo> };
      return result.widget;
    } catch {
      return undefined;
    }
  }

  /** Returns null when the resolve call itself fails (distinguishes failure from count 0). */
  private async countMatches(query: SelectorQuery, limit = RESOLVE_LIMIT): Promise<ResolveOutcome | null> {
    try {
      const res = await this.sendRequest('ext.fliwright.resolve', {
        selector: JSON.stringify(query),
        strict: 'false',
        visible: 'any',
        limit: String(limit),
      }) as { count?: number; matches?: WidgetInfo[]; widgets?: WidgetInfo[] };
      return { count: res.count ?? 0, matches: res.matches ?? res.widgets ?? [] };
    } catch {
      return null;
    }
  }

  /** Try within(keyedAncestor) then containing(descendantText); shortest unique wins. */
  private async tryDisambiguators(
    base: SelectorQuery,
    widget: Partial<WidgetInfo>,
  ): Promise<ResolvedSelector | null> {
    const candidates: SelectorQuery[] = [];

    for (const ancestor of (widget.keyedAncestors ?? []).slice(0, MAX_KEYED_ANCESTORS)) {
      candidates.push({ ...base, within: { match: { key: ancestor.key } } });
    }

    if (widget.descendantText && widget.descendantText.trim()) {
      candidates.push({ ...base, containing: { match: { text: widget.descendantText.trim() } } });
    }

    let best: ResolvedSelector | null = null;
    for (const candidate of candidates) {
      const outcome = await this.countMatches(candidate);
      if (outcome !== null && outcome.count === 1) {
        const resolved: ResolvedSelector = {
          query: candidate,
          ambiguous: false,
          matchCount: 1,
        };
        if (
          best === null ||
          serializeSelectorQuery(candidate).length < serializeSelectorQuery(best.query).length
        ) {
          best = resolved;
        }
      }
    }
    return best;
  }

  /** Index the target inside the matched set and return base.nth(index). */
  private async nthFallback(
    base: SelectorQuery,
    widget: Partial<WidgetInfo>,
    initial: ResolveOutcome,
  ): Promise<SelectorQuery> {
    let matches = initial.matches;
    if (matches.length < initial.count) {
      const refill = await this.countMatches(base, NTH_LIMIT);
      if (refill) matches = refill.matches;
    }
    const foundIndex = matches.findIndex((m) => m.id === widget.id);
    const index = foundIndex >= 0 ? foundIndex : 0;
    return { ...base, position: { nth: index } };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @fliwright-core test RecordedSelectorResolver`
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `pnpm --filter @fliwright/core lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-core/src/RecordedSelectorResolver.ts packages/fliwright-core/tests/RecordedSelectorResolver.test.ts
git commit -m "feat(core): add RecordedSelectorResolver uniqueness verification and disambiguation"
```

---

## Task 6: Wire the engine into `RecorderController`

> **Atomic contract change:** Tasks 6→7→8 switch the recorded-selector contract from `Map<number, string>` to `Map<number, ResolvedSelector>` across `RecorderController` ↔ `CodeGenerator` ↔ `DartCodeGenerator`. Because the three share one type, no strict ordering produces a green `tsc --noEmit` until all three land. **Execute them consecutively.** Unit tests (Vitest) pass at each step; `tsc --noEmit` is fully green once Task 8 lands. Task 9 runs the final lint sweep. You may commit per task (tests green) or squash 6–8 into one commit — either is fine.

**Files:**
- Modify: `packages/fliwright-core/src/RecorderController.ts`
- Modify: `packages/fliwright-core/src/index.ts` (exports)
- Modify: `packages/fliwright-core/src/SelectorResolver.ts` (remove now-dead `resolveSelector`)
- Test: `packages/fliwright-core/tests/RecorderController.test.ts`

- [ ] **Step 1: Add / update failing controller tests**

In `packages/fliwright-core/tests/RecorderController.test.ts`, the existing tests already assert `page.locator({ text: 'Login' }).click()` and `page.locator({ type: 'Widget' }).click()` — these still hold after the change (text/type stay shorthand; the default resolve mock returns `{}` → count 0 → unique). Add one new test for disambiguation through the controller:

```ts
  it('disambiguates an ambiguous GestureDetector with descendant text', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      if (method === 'streamListen') return Promise.resolve({});
      if (method === 'ext.fliwright.startRecording') return Promise.resolve({ recording: true });
      if (method === 'ext.fliwright.stopRecording') return Promise.resolve({ recording: false });
      if (method === 'ext.fliwright.hitTest') {
        return Promise.resolve({
          widget: { id: '1', type: 'GestureDetector', descendantText: 'Login', properties: {} },
        });
      }
      if (method === 'ext.fliwright.resolve') {
        const q = JSON.parse((params as { selector: string }).selector);
        if (q.containing) return Promise.resolve({ count: 1 });
        return Promise.resolve({ count: 4 });
      }
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((cb) => { eventCallback = cb; return () => {}; }),
    );

    await controller.start();
    eventCallback?.({ kind: 'FliwrightRecording', timestamp: Date.now(), data: { type: 'pointerEvent', kind: 'down', pointer: 0, position: { x: 5, y: 5 }, timestamp: 1000, buttons: 1 } });
    eventCallback?.({ kind: 'FliwrightRecording', timestamp: Date.now(), data: { type: 'pointerEvent', kind: 'up', pointer: 0, position: { x: 5, y: 5 }, timestamp: 1100, buttons: 0 } });

    const code = await controller.stop();
    expect(code).toContain("containing: { text: 'Login' }");
    expect(code).not.toContain('// ambiguous');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fliwright/core test RecorderController`
Expected: FAIL — controller still calls `resolveSelector` (string); no `ext.fliwright.resolve` consumption; new test fails.

- [ ] **Step 3: Update `RecorderController`**

In `packages/fliwright-core/src/RecorderController.ts`:

Replace the import:
```ts
import { resolveSelector } from './SelectorResolver.js';
```
with:
```ts
import { RecordedSelectorResolver } from './RecordedSelectorResolver.js';
import { serializeSelectorQuery } from './SelectorSerializer.js';
```

Change the field type (around the `lastSelectors` declaration):
```ts
  private lastSelectors = new Map<number, ResolvedSelector>();
```
and the reset line `this.lastSelectors = new Map();` stays valid.

Add the resolver field, initialized where `sendRequest` is stored (in the constructor). If the constructor currently stores `this.sendRequest = sendRequest`, add right after:
```ts
  private readonly resolver: RecordedSelectorResolver;
```
and in the constructor body:
```ts
    this.resolver = new RecordedSelectorResolver(sendRequest);
```

Ensure `ResolvedSelector` is imported. Add a dedicated import line near the top of the file (or merge the name into the existing `import type { … } from './types.js';` if one is present):
```ts
import type { ResolvedSelector } from './types.js';
```

Replace the selector-resolution loop in `stop()` (the block that built `const selectors = new Map<number, string>()`) with:
```ts
    const selectors = new Map<number, ResolvedSelector>();
    for (let i = 0; i < this.operations.length; i++) {
      const resolved = await this.resolver.resolveUniqueSelector(this.operations[i]);
      selectors.set(i, resolved);
      const display = serializeSelectorQuery(resolved.query);
      this.classifyOperationWithSelector(i, display);
      this.setFrameSelector(i, display);
    }
    this.lastSelectors = selectors;
    this.lastCodegenOptions = options;

    return this.generateCode();
```

Delete the old private `resolveSelector(op)` method (it is fully replaced by `RecordedSelectorResolver`). Add `import type { ResolvedSelector } from './types.js';` if not already present via a combined import.

- [ ] **Step 4: Run controller test to verify it passes**

Run: `pnpm --filter @fliwright/core test RecorderController`
Expected: PASS (all existing tests + the new disambiguation test).

- [ ] **Step 5: Update `index.ts` exports and remove the now-dead `resolveSelector`**

In `packages/fliwright-core/src/index.ts`, replace the `SelectorSelector, resolveSelector` export line with:
```ts
export { SelectorResolver, buildBaseSelector } from './SelectorResolver.js';
export { serializeSelectorQuery } from './SelectorSerializer.js';
export { RecordedSelectorResolver } from './RecordedSelectorResolver.js';
```
and ensure `ResolvedSelector`, `KeyedAncestor` are exported from the types re-export if the file re-exports types (check the existing `export type { … } from './types.js';` line and add `ResolvedSelector`, `KeyedAncestor`).

`resolveSelector` now has no callers. In `packages/fliwright-core/src/SelectorResolver.ts`: delete the `resolveSelector` function and the `escapeSelectorValue` helper (now unused); keep `ROLE_MAP` (used by `buildBaseSelector`); repoint the `SelectorResolver` class's `resolve(widget)` method to `return buildBaseSelector(widget)` with return type `SelectorQuery` (so the class stays internally consistent). In `packages/fliwright-core/tests/SelectorResolver.test.ts`: delete the old tests that asserted on `resolveSelector` string output (and the now-unused `resolveSelector` import); keep the `buildBaseSelector` cascade tests added in Task 3.

- [ ] **Step 6: Commit (tests green; lint finalized in Task 9)**

```bash
git add packages/fliwright-core/src/RecorderController.ts packages/fliwright-core/src/index.ts packages/fliwright-core/src/SelectorResolver.ts packages/fliwright-core/tests/RecorderController.test.ts packages/fliwright-core/tests/SelectorResolver.test.ts
git commit -m "feat(core): wire RecordedSelectorResolver into RecorderController and drop resolveSelector"
```

(Unit tests pass. `tsc --noEmit` becomes fully green after Task 8 updates `DartCodeGenerator`; Task 9 runs the final lint sweep — see the atomic-contract note at the top of this task.)

---

## Task 7: TS `CodeGenerator` consumes `ResolvedSelector` + ambiguous comments

**Files:**
- Modify: `packages/fliwright-core/src/CodeGenerator.ts`
- Test: `packages/fliwright-core/tests/CodeGenerator.test.ts`

- [ ] **Step 1: Add failing codegen tests**

In `packages/fliwright-core/tests/CodeGenerator.test.ts`, add (adapting imports to match the file's existing style):

```ts
import { CodeGenerator } from '../src/CodeGenerator.js';
import type { RecordedOperation, ResolvedSelector } from '../src/types.js';

const op = (over: Partial<RecordedOperation> = {}): RecordedOperation =>
  ({ kind: 'tap', position: { x: 1, y: 1 }, timestamp: 1, ...over });

describe('CodeGenerator structured selectors', () => {
  it('serializes a simple selector as shorthand', () => {
    const selectors = new Map<number, ResolvedSelector>([
      [0, { query: { match: { text: 'Login' } }, ambiguous: false, matchCount: 1 }],
    ]);
    const code = new CodeGenerator().generate([op()], selectors);
    expect(code).toContain("page.locator({ text: 'Login' }).click()");
  });

  it('serializes a within-scoped selector', () => {
    const selectors = new Map<number, ResolvedSelector>([
      [0, {
        query: { match: { type: 'GestureDetector' }, within: { match: { key: 'list' } } },
        ambiguous: false, matchCount: 1,
      }],
    ]);
    const code = new CodeGenerator().generate([op()], selectors);
    expect(code).toContain("within: { key: 'list' }");
  });

  it('emits an ambiguous comment for an nth fallback', () => {
    const selectors = new Map<number, ResolvedSelector>([
      [0, { query: { match: { type: 'GestureDetector' }, position: { nth: 3 } }, ambiguous: true, matchCount: 5 }],
    ]);
    const code = new CodeGenerator().generate([op()], selectors);
    expect(code).toContain('// ambiguous: matched 5');
    expect(code).toContain('page.locator(');
  });
});
```

(If the file already imports `CodeGenerator`, reuse that import; only add the `ResolvedSelector` type import and the new describe block.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fliwright/core test CodeGenerator`
Expected: FAIL — `generate` still takes `Map<number, string>`; the structured selector shape is not understood.

- [ ] **Step 3: Update `CodeGenerator`**

In `packages/fliwright-core/src/CodeGenerator.ts`:

Change the import and signature:
```ts
import type { RecordedOperation, CodegenOptions, ResolvedSelector } from './types.js';
import { DartCodeGenerator } from './DartCodeGenerator.js';
import { serializeSelectorQuery } from './SelectorSerializer.js';
```

Change the `generate` signature's `selectors` parameter and the per-operation rendering:
```ts
  generate(
    operations: RecordedOperation[],
    selectors: Map<number, ResolvedSelector>,
    options?: CodegenOptions,
  ): string {
    if (options?.lang === 'dart') {
      return new DartCodeGenerator().generate(operations, selectors, options);
    }
    // …unchanged header / beforeEach / test() open…
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (op.status === 'ignored') continue;
      const resolved = selectors.get(i) ?? { query: { match: { type: 'Widget' } }, ambiguous: true, matchCount: 0 };
      const locator = `page.locator(${serializeSelectorQuery(resolved.query)})`;
      const lead = resolved.ambiguous ? `  // ambiguous: matched ${resolved.matchCount}, positional fallback\n` : '';

      switch (op.kind) {
        case 'tap':
          lines.push(`${lead}  await ${locator}.click();`);
          break;
        case 'longPress':
          lines.push(`${lead}  await ${locator}.longPress({ duration: ${op.duration} });`);
          break;
        case 'drag':
          lines.push(`${lead}  await ${locator}.drag(${op.delta!.x}, ${op.delta!.y});`);
          break;
        case 'type':
          if (op.action === 'replace') {
            lines.push(`${lead}  await ${locator}.fill('${escapeString(op.text ?? '')}');`);
          } else {
            lines.push(`${lead}  await ${locator}.type('${escapeString(op.text ?? '')}');`);
          }
          break;
      }
    }
    // …unchanged close…
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @fliwright/core test CodeGenerator`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-core/src/CodeGenerator.ts packages/fliwright-core/tests/CodeGenerator.test.ts
git commit -m "feat(core): serialize structured selectors and flag ambiguous nth fallbacks in codegen"
```

---

## Task 8: Dart `DartCodeGenerator` maps structured selectors to finders

**Files:**
- Modify: `packages/fliwright-core/src/DartCodeGenerator.ts`
- Test: `packages/fliwright-core/tests/DartCodeGenerator.test.ts`

- [ ] **Step 1: Add failing Dart-codegen tests**

In `packages/fliwright-core/tests/DartCodeGenerator.test.ts`, add (reusing existing imports):

```ts
import { DartCodeGenerator } from '../src/DartCodeGenerator.js';
import type { RecordedOperation, ResolvedSelector } from '../src/types.js';

const tap: RecordedOperation = { kind: 'tap', position: { x: 1, y: 1 }, timestamp: 1 };

function gen(query: ResolvedSelector['query']): string {
  return new DartCodeGenerator().generate([tap], new Map([[0, { query, ambiguous: false, matchCount: 1 }]]));
}

describe('DartCodeGenerator structured finders', () => {
  it('text → find.text', () => {
    expect(gen({ match: { text: 'Login' } })).toContain("find.text('Login')");
  });

  it('key → find.byKey', () => {
    expect(gen({ match: { key: 'submit' } })).toContain("find.byKey(const Key('submit'))");
  });

  it('type → find.byType', () => {
    expect(gen({ match: { type: 'GestureDetector' } })).toContain('find.byType(GestureDetector)');
  });

  it('tooltip → find.byTooltip', () => {
    expect(gen({ match: { tooltip: 'Add' } })).toContain("find.byTooltip('Add')");
  });

  it('semanticsLabel → find.bySemanticsLabel', () => {
    expect(gen({ match: { semanticsLabel: 'Open' } })).toContain("find.bySemanticsLabel('Open')");
  });

  it('within → find.descendant', () => {
    const code = gen({ match: { type: 'GestureDetector' }, within: { match: { key: 'list' } } });
    expect(code).toContain('find.descendant(');
    expect(code).toContain("of: find.byKey(const Key('list'))");
    expect(code).toContain('matching: find.byType(GestureDetector)');
  });

  it('containing → find.ancestor', () => {
    const code = gen({ match: { type: 'GestureDetector' }, containing: { match: { text: 'Login' } } });
    expect(code).toContain('find.ancestor(');
    expect(code).toContain("matching: find.text('Login')");
    expect(code).toContain('of: find.byType(GestureDetector)');
  });

  it('nth → .at', () => {
    expect(gen({ match: { type: 'GestureDetector' }, position: { nth: 2 } })).toContain('find.byType(GestureDetector).at(2)');
  });

  it('last → .last', () => {
    expect(gen({ match: { type: 'GestureDetector' }, position: { last: true } })).toContain('find.byType(GestureDetector).last');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fliwright/core test DartCodeGenerator`
Expected: FAIL — `dartFinder` is regex-based and the signature still takes strings.

- [ ] **Step 3: Rewrite `DartCodeGenerator` finder mapping**

Replace the contents of `packages/fliwright-core/src/DartCodeGenerator.ts`:

```ts
import type { RecordedOperation, CodegenOptions, ResolvedSelector, SelectorQuery } from './types.js';

const DEFAULT_TEST_NAME = 'recorded test';

export class DartCodeGenerator {
  generate(
    operations: RecordedOperation[],
    selectors: Map<number, ResolvedSelector>,
    options?: CodegenOptions,
  ): string {
    const testName = options?.testName ?? DEFAULT_TEST_NAME;

    const lines: string[] = [];
    lines.push("import 'package:flutter_test/flutter_test.dart';");
    lines.push("import 'package:integration_test/integration_test.dart';");
    lines.push('');
    lines.push('void main() {');
    lines.push('  IntegrationTestWidgetsFlutterBinding.ensureInitialized();');
    lines.push('');
    lines.push(`  testWidgets('${escapeString(testName)}', (WidgetTester tester) async {`);

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (op.status === 'ignored') continue;
      const resolved = selectors.get(i) ?? { query: { match: { type: 'Widget' } }, ambiguous: true, matchCount: 0 };
      const finder = dartFinder(resolved.query);
      const lead = resolved.ambiguous ? `    // ambiguous: matched ${resolved.matchCount}, positional fallback\n` : '';

      switch (op.kind) {
        case 'tap':
          lines.push(`${lead}    await tester.tap(${finder});`);
          lines.push('    await tester.pumpAndSettle();');
          break;
        case 'longPress':
          lines.push(`${lead}    await tester.longPress(${finder});`);
          lines.push('    await tester.pumpAndSettle();');
          break;
        case 'drag':
          lines.push(`${lead}    await tester.drag(${finder}, const Offset(${op.delta!.x}, ${op.delta!.y}));`);
          lines.push('    await tester.pumpAndSettle();');
          break;
        case 'type':
          lines.push(`${lead}    await tester.enterText(${finder}, '${escapeString(op.text ?? '')}');`);
          lines.push('    await tester.pumpAndSettle();');
          break;
      }
    }

    lines.push('  });');
    lines.push('}');
    return lines.join('\n');
  }
}

function dartFinder(query: SelectorQuery): string {
  const base = matchFinder(query.match);
  const scoped = query.containing
    ? `find.ancestor(of: ${base}, matching: ${dartFinder(query.containing)})`
    : query.within
      ? `find.descendant(of: ${dartFinder(query.within)}, matching: ${base})`
      : base;
  if (query.position?.last) return `${scoped}.last`;
  if (query.position?.nth != null) return `${scoped}.at(${query.position.nth})`;
  return scoped;
}

function matchFinder(match?: SelectorQuery['match']): string {
  if (!match) return 'find.byType(Widget)';
  if (match.text) return `find.text('${escapeString(match.text)}')`;
  if (match.key) return `find.byKey(const Key('${escapeString(match.key)}'))`;
  if (match.tooltip) return `find.byTooltip('${escapeString(match.tooltip)}')`;
  if (match.semanticsLabel) return `find.bySemanticsLabel('${escapeString(match.semanticsLabel)}')`;
  if (match.semanticsHint) return `find.bySemanticsLabel('${escapeString(match.semanticsHint)}')`;
  if (match.role) return `find.bySemanticsLabel('${escapeString(match.role)}')`;
  if (match.name) return `find.byKey(const Key('${escapeString(match.name)}'))`;
  if (match.ancestorKey) return `find.byKey(const Key('${escapeString(match.ancestorKey)}'))`;
  if (match.iconCodePoint != null) {
    return `find.byIcon(${match.iconCodePoint})`;
  }
  if (match.type) return `find.byType(${match.type})`;
  return 'find.byType(Widget)';
}

function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @fliwright/core test DartCodeGenerator`
Expected: PASS.

- [ ] **Step 5: Lint**

Run: `pnpm --filter @fliwright/core lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-core/src/DartCodeGenerator.ts packages/fliwright-core/tests/DartCodeGenerator.test.ts
git commit -m "feat(core): map structured selectors to Dart finders (descendant/ancestor/at/last)"
```

---

## Task 9: Integration verification and full sweep

**Files:**
- Test: `packages/fliwright-core/tests/recorder-integration.test.ts` (extend) or `RecorderController.test.ts`
- Run: full TS + Dart suites

- [ ] **Step 1: Add an end-to-end disambiguation assertion**

In `packages/fliwright-core/tests/RecorderController.test.ts`, add a test that records two taps on identical `GestureDetector`s distinguished only by descendant text, and asserts each emitted selector is specific and non-identical:

```ts
  it('emits distinct selectors for two GestureDetectors distinguished by inner text', async () => {
    const widgets = [
      { id: '1', type: 'GestureDetector', descendantText: 'Login', properties: {} },
      { id: '2', type: 'GestureDetector', descendantText: 'Sign up', properties: {} },
    ];
    let hit = 0;
    const sendRequest = vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
      if (method === 'ext.fliwright.hitTest') return Promise.resolve({ widget: widgets[hit++ % widgets.length] });
      if (method === 'ext.fliwright.resolve') {
        const q = JSON.parse((params as { selector: string }).selector);
        // Each containing-scoped query is unique; bare matches are ambiguous.
        if (q.containing) return Promise.resolve({ count: 1 });
        return Promise.resolve({ count: 2 });
      }
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((cb) => { eventCallback = cb; return () => {}; }),
    );

    await controller.start();
    for (const [x, ts] of [[10, 1000], [12, 1100]] as const) {
      eventCallback?.({ kind: 'FliwrightRecording', timestamp: Date.now(), data: { type: 'pointerEvent', kind: 'down', pointer: ts, position: { x, y: 5 }, timestamp: ts, buttons: 1 } });
      eventCallback?.({ kind: 'FliwrightRecording', timestamp: Date.now(), data: { type: 'pointerEvent', kind: 'up', pointer: ts, position: { x, y: 5 }, timestamp: ts + 50, buttons: 0 } });
    }

    const code = await controller.stop();
    expect(code).toContain("containing: { text: 'Login' }");
    expect(code).toContain("containing: { text: 'Sign up' }");
    expect(code).not.toContain("// ambiguous");
  });
```

- [ ] **Step 2: Run the full TS suite**

Run: `pnpm --filter @fliwright/core test`
Expected: PASS — all Selector, wire-protocol, SelectorResolver, SelectorSerializer, RecordedSelectorResolver, RecorderController, CodeGenerator, DartCodeGenerator tests green.

- [ ] **Step 3: Run TS lint**

Run: `pnpm --filter @fliwright/core lint`
Expected: PASS.

- [ ] **Step 4: Run the Dart suite and analyze**

Run: `melos run test`
Expected: PASS (bridge helper tests green).
Run: `melos run analyze`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-core/tests/RecorderController.test.ts
git commit -m "test(core): cover distinct selector emission for ambiguous wrappers"
```

---

## Done criteria

- Every recorded selector that can be unique at record time is unique (verified via `ext.fliwright.resolve`).
- `GestureDetector` / `InkWell` / `IconButton` wrappers resolve via descendant text (`containing`) or keyed ancestors (`within`) before any `nth` fallback.
- `nth` fallbacks are emitted with an `// ambiguous` comment in both TS and Dart output.
- TS and Dart generated finders are structurally equivalent.
- All TS and Dart tests pass; lint and analyze are clean.

## Out of scope (per spec YAGNI)

- AI/ML selector suggestion, recording-time selector editing UI, cross-recording dedup, `Selector` class refactor.
