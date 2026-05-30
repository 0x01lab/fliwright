# Slice 4: Self-Healing Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When selectors break due to UI changes, automatically find alternative widgets via multi-dimensional fuzzy matching and continue test execution with a healing report.

**Architecture:** Dart snapshot extension collects widget metadata (type, position, parent, adjacent text, callbacks) → stored locally as JSON → on assertion failure, TS engine computes 4-dimension weighted scores (position, context, code binding, n-gram text similarity) → if best candidate exceeds threshold, re-run assertion with suggested selector → generate healing report.

**Tech Stack:** Dart (Flutter Widget tree traversal), TypeScript (Vitest), zero new dependencies

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/fliwright-bridge/lib/src/extensions/snapshot.dart` | Dart VM Service extension: collect interactive widget metadata from widget tree |
| `packages/fliwright-bridge/test/snapshot_test.dart` | Dart tests for snapshot extension |
| `packages/fliwright-core/src/SnapshotStore.ts` | Load/save widget snapshots to `.fliwright/snapshots/` as JSON files |
| `packages/fliwright-core/src/strategies/MultiDimensionalHealingStrategy.ts` | 4-dimension scoring: position, context, code binding, n-gram text similarity |
| `packages/fliwright-core/src/SelfHealingEngine.ts` | Orchestrate snapshot loading, candidate scoring, healing redirect, report generation |
| `packages/fliwright-core/tests/SnapshotStore.test.ts` | Tests for SnapshotStore |
| `packages/fliwright-core/tests/MultiDimensionalHealingStrategy.test.ts` | Tests for scoring strategy including n-gram similarity |
| `packages/fliwright-core/tests/SelfHealingEngine.test.ts` | Tests for healing engine |

### Modified Files

| File | Change |
|------|--------|
| `packages/fliwright-bridge/lib/src/bridge.dart` | Import + register SnapshotExtension |
| `packages/fliwright-bridge/lib/fliwright_bridge.dart` | Export snapshot extension |
| `packages/fliwright-core/src/types.ts` | Add `HealingReport` type, extend `WidgetSnapshot` |
| `packages/fliwright-core/src/Driver.ts` | Add `healing` getter |
| `packages/fliwright-core/src/Assertion.ts` | Add healingEngine/testName params, trigger healing on failure |
| `packages/fliwright-core/src/index.ts` | Export new classes |

---

## Task 1: Dart Snapshot Extension

**Files:**
- Create: `packages/fliwright-bridge/lib/src/extensions/snapshot.dart`
- Modify: `packages/fliwright-bridge/lib/src/bridge.dart`
- Modify: `packages/fliwright-bridge/lib/fliwright_bridge.dart`
- Test: `packages/fliwright-bridge/test/snapshot_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// packages/fliwright-bridge/test/snapshot_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  group('SnapshotExtension', () {
    setUp(() async {
      await FliwrightBridge.reset();
    });

    test('registers ext.fliwright.snapshot on init', () async {
      await FliwrightBridge.init();
      expect(
        FliwrightBridge.registry.registeredMethods,
        contains('ext.fliwright.snapshot'),
      );
    });

    test('returns widgets array from snapshot', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.snapshot',
        {},
      );
      expect(result, contains('widgets'));
      expect(result['widgets'], isA<List>());
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/fliwright-bridge && flutter test test/snapshot_test.dart`
Expected: FAIL — `Extension "ext.fliwright.snapshot" is not registered`

- [ ] **Step 3: Write the snapshot extension**

```dart
// packages/fliwright-bridge/lib/src/extensions/snapshot.dart
import 'package:flutter/widgets.dart';

import '../bridge.dart';

/// Interactive widget types that the self-healing engine should consider.
const _interactiveTypes = {
  'ElevatedButton', 'TextButton', 'OutlinedButton', 'IconButton',
  'FloatingActionButton', 'TextField', 'TextFormField',
  'Checkbox', 'Switch', 'Radio', 'Slider',
  'DropdownButton', 'PopupMenuButton', 'ListTile',
  'InkWell', 'GestureDetector', 'DropdownButtonFormField',
};

class SnapshotExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.snapshot', _snapshot);
  }

  static Future<Map<String, dynamic>> _snapshot(
    Map<String, String> params,
  ) async {
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {'widgets': <dynamic>[], 'error': 'No widget tree available'};
    }

    final widgets = <Map<String, dynamic>>[];
    _walkTree(root, null, (Element element, Element? parent) {
      final widget = element.widget;
      final typeName = widget.runtimeType.toString();
      if (!_interactiveTypes.contains(typeName)) return;

      final renderObject = element.findRenderObject();
      Map<String, dynamic>? rect;
      if (renderObject is RenderBox && renderObject.hasSize) {
        final topLeft = renderObject.localToGlobal(Offset.zero);
        final size = renderObject.size;
        rect = {
          'x': topLeft.dx,
          'y': topLeft.dy,
          'width': size.width,
          'height': size.height,
        };
      }
      if (rect == null) return;

      final text = _extractText(element);
      final key = _extractKey(widget);
      final parentType = parent != null
          ? parent.widget.runtimeType.toString()
          : null;
      final parentText = parent != null ? _extractText(parent) : null;
      final adjacentTexts = _extractAdjacentTexts(element);
      final callbackNames = _extractCallbackNames(widget);
      final properties = _extractProperties(widget);

      widgets.add({
        'id': '${element.hashCode}',
        'type': typeName,
        if (text != null) 'text': text,
        if (key != null) 'key': key,
        'rect': rect,
        if (parentType != null) 'parentType': parentType,
        if (parentText != null) 'parentText': parentText,
        'adjacentTexts': adjacentTexts,
        'callbackNames': callbackNames,
        'properties': properties,
      });
    });

    return {'widgets': widgets, 'count': widgets.length};
  }

  static void _walkTree(
    Element root,
    Element? parent,
    void Function(Element, Element?) visitor,
  ) {
    visitor(root, parent);
    root.debugVisitOnstageChildren((Element child) {
      _walkTree(child, root, visitor);
    });
  }

  static String? _extractText(Element element) {
    final widget = element.widget;
    if (widget is Text) return widget.data;
    if (widget is RichText) return widget.text.toPlainText();
    if (widget is EditableText) return widget.controller.text;
    return null;
  }

  static String? _extractKey(Widget widget) {
    final key = widget.key;
    if (key is ValueKey<String>) return key.value;
    if (key is ValueKey) return key.value.toString();
    return null;
  }

  static List<String> _extractAdjacentTexts(Element element) {
    final texts = <String>[];
    element.visitChildElements((Element child) {
      final text = _extractText(child);
      if (text != null && text.isNotEmpty) texts.add(text);
    });
    // Also look at siblings (children of parent that are not this element).
    element.visitAncestorElements((Element ancestor) {
      ancestor.visitChildElements((Element sibling) {
        if (sibling.hashCode != element.hashCode) {
          final text = _extractText(sibling);
          if (text != null && text.isNotEmpty) texts.add(text);
        }
      });
      return false; // Only check immediate parent.
    });
    return texts;
  }

  static List<String> _extractCallbackNames(Widget widget) {
    // Callback extraction is limited without debugger inspection.
    // We check common callback property names via toString reflection.
    final names = <String>[];
    final str = widget.toStringShort();
    // Extract named callbacks from common patterns (best-effort).
    final regex = RegExp(r'(\w+)\s*:');
    for (final match in regex.allMatches(str)) {
      final name = match.group(1);
      if (name != null &&
          (name.startsWith('on') || name == 'onPressed' || name == 'onChanged')) {
        names.add(name);
      }
    }
    return names;
  }

  static Map<String, dynamic> _extractProperties(Widget widget) {
    final props = <String, dynamic>{};
    if (widget is TextField) {
      props['enabled'] = widget.enabled;
    }
    // Add more property extraction as needed.
    return props;
  }
}
```

- [ ] **Step 4: Register the extension in bridge.dart**

In `packages/fliwright-bridge/lib/src/bridge.dart`, add the import and registration:

```dart
// Add at top, after other extension imports:
import 'extensions/snapshot.dart';

// Add in init(), after the existing extension registrations (e.g., after ScrollExtension.register):
SnapshotExtension.register(_registry);
```

- [ ] **Step 5: Export in fliwright_bridge.dart**

In `packages/fliwright-bridge/lib/fliwright_bridge.dart`, add:

```dart
export 'src/extensions/snapshot.dart';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/fliwright-bridge && flutter test test/snapshot_test.dart`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add packages/fliwright-bridge/lib/src/extensions/snapshot.dart \
  packages/fliwright-bridge/lib/src/bridge.dart \
  packages/fliwright-bridge/lib/fliwright_bridge.dart \
  packages/fliwright-bridge/test/snapshot_test.dart
git commit -m "feat(bridge): add snapshot extension for widget metadata collection"
```

---

## Task 2: SnapshotStore — Local File Storage

**Files:**
- Create: `packages/fliwright-core/src/SnapshotStore.ts`
- Test: `packages/fliwright-core/tests/SnapshotStore.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/fliwright-core/tests/SnapshotStore.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SnapshotStore } from '../src/SnapshotStore.js';
import type { WidgetSnapshot } from '../src/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fliwright-snapshot-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SnapshotStore', () => {
  it('load returns null when no snapshot exists', () => {
    const store = new SnapshotStore(tmpDir);
    const result = store.load('my test', 'text=Login');
    expect(result).toBeNull();
  });

  it('save and load round-trips a snapshot', async () => {
    const store = new SnapshotStore(tmpDir);
    const snapshot: WidgetSnapshot = {
      type: 'ElevatedButton',
      parentType: 'Column',
      adjacentText: ['User', 'Pass'],
      rect: { x: 10, y: 20, width: 100, height: 40 },
      callbackNames: ['_onLogin'],
      description: "ElevatedButton with text 'Login', parent Column",
    };
    await store.save('my test', 'text=Login', snapshot);
    const loaded = store.load('my test', 'text=Login');
    expect(loaded).toEqual(snapshot);
  });

  it('save overwrites existing snapshot', async () => {
    const store = new SnapshotStore(tmpDir);
    const v1: WidgetSnapshot = {
      type: 'ElevatedButton',
      parentType: 'Column',
      adjacentText: [],
      rect: { x: 0, y: 0, width: 100, height: 40 },
      callbackNames: [],
      description: 'v1',
    };
    const v2: WidgetSnapshot = {
      type: 'TextButton',
      parentType: 'Row',
      adjacentText: ['Cancel'],
      rect: { x: 0, y: 0, width: 80, height: 30 },
      callbackNames: ['_onSubmit'],
      description: 'v2',
    };
    await store.save('test', 'text=Go', v1);
    await store.save('test', 'text=Go', v2);
    const loaded = store.load('test', 'text=Go');
    expect(loaded!.description).toBe('v2');
  });

  it('list returns all snapshots for a test', async () => {
    const store = new SnapshotStore(tmpDir);
    const snap: WidgetSnapshot = {
      type: 'TextButton',
      parentType: 'Column',
      adjacentText: [],
      rect: { x: 0, y: 0, width: 100, height: 40 },
      callbackNames: [],
      description: 'btn',
    };
    await store.save('login test', 'text=Login', snap);
    await store.save('login test', 'text=Submit', snap);
    const all = store.list('login test');
    expect(all.size).toBe(2);
    expect(all.has('text=Login')).toBe(true);
    expect(all.has('text=Submit')).toBe(true);
  });

  it('list returns empty map for unknown test', () => {
    const store = new SnapshotStore(tmpDir);
    const all = store.list('unknown');
    expect(all.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/fliwright-core && npx vitest run tests/SnapshotStore.test.ts`
Expected: FAIL — cannot resolve `../src/SnapshotStore.js`

- [ ] **Step 3: Write SnapshotStore implementation**

```typescript
// packages/fliwright-core/src/SnapshotStore.ts
import type { WidgetSnapshot } from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export class SnapshotStore {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(process.cwd(), '.fliwright', 'snapshots');
  }

  load(testName: string, selector: string): WidgetSnapshot | null {
    const filePath = this.filePath(testName, selector);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      return data.snapshot as WidgetSnapshot;
    } catch {
      return null;
    }
  }

  async save(testName: string, selector: string, snapshot: WidgetSnapshot): Promise<void> {
    const filePath = this.filePath(testName, selector);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const data = {
      testName,
      selector,
      snapshot,
      firstSeen: snapshot.firstSeen ?? new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  list(testName: string): Map<string, WidgetSnapshot> {
    const dir = path.join(this.baseDir, sanitize(testName));
    const result = new Map<string, WidgetSnapshot>();
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
          const data = JSON.parse(raw);
          result.set(data.selector, data.snapshot);
        } catch {
          // Skip malformed files.
        }
      }
    } catch {
      // Directory doesn't exist yet.
    }
    return result;
  }

  private filePath(testName: string, selector: string): string {
    return path.join(this.baseDir, sanitize(testName), encodeURIComponent(selector) + '.json');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/fliwright-core && npx vitest run tests/SnapshotStore.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-core/src/SnapshotStore.ts packages/fliwright-core/tests/SnapshotStore.test.ts
git commit -m "feat(core): add SnapshotStore for local widget metadata persistence"
```

---

## Task 3: MultiDimensionalHealingStrategy — N-Gram + 4-Dimension Scoring

**Files:**
- Create: `packages/fliwright-core/src/strategies/MultiDimensionalHealingStrategy.ts`
- Test: `packages/fliwright-core/tests/MultiDimensionalHealingStrategy.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/fliwright-core/tests/MultiDimensionalHealingStrategy.test.ts
import { describe, it, expect } from 'vitest';
import {
  MultiDimensionalHealingStrategy,
  ngramSimilarity,
} from '../src/strategies/MultiDimensionalHealingStrategy.js';
import type { WidgetSnapshot, WidgetInfo, HealingResult } from '../src/types.js';

function makeSnapshot(overrides: Partial<WidgetSnapshot> = {}): WidgetSnapshot {
  return {
    type: 'ElevatedButton',
    parentType: 'Column',
    adjacentText: ['User', 'Pass'],
    rect: { x: 100, y: 400, width: 200, height: 48 },
    callbackNames: ['_onConfirm'],
    description: "ElevatedButton with text '确认支付', parent Column, adjacent [User, Pass]",
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<WidgetSnapshot & { id?: string; text?: string }> = {}): WidgetSnapshot {
  return makeSnapshot(overrides);
}

describe('ngramSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(ngramSimilarity('hello', 'hello')).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    expect(ngramSimilarity('abc', 'xyz')).toBe(0);
  });

  it('returns high similarity for partially overlapping strings', () => {
    const score = ngramSimilarity('确认支付', '确认结算');
    expect(score).toBeGreaterThan(0.3);
  });

  it('returns 0 for empty strings', () => {
    expect(ngramSimilarity('', '')).toBe(0);
    expect(ngramSimilarity('abc', '')).toBe(0);
  });
});

describe('MultiDimensionalHealingStrategy', () => {
  it('scores identical widget as 1.0', () => {
    const strategy = new MultiDimensionalHealingStrategy();
    const original = makeSnapshot();
    const candidate = makeSnapshot();
    const score = strategy.score(original, candidate);
    expect(score).toBe(1.0);
  });

  it('scores higher for same position and type', () => {
    const strategy = new MultiDimensionalHealingStrategy();
    const original = makeSnapshot();
    const samePosition = makeSnapshot({ description: "TextButton with text '去结算', parent Column, adjacent [User, Pass]" });
    const diffPosition = makeSnapshot({
      rect: { x: 0, y: 0, width: 100, height: 30 },
      description: "TextButton with text '去结算', parent Row, adjacent [Foo, Bar]",
    });
    const scoreSame = strategy.score(original, samePosition);
    const scoreDiff = strategy.score(original, diffPosition);
    expect(scoreSame).toBeGreaterThan(scoreDiff);
  });

  it('heal returns best match above threshold', () => {
    const strategy = new MultiDimensionalHealingStrategy();
    const original = makeSnapshot();
    const good = makeSnapshot({ description: "ElevatedButton with text '去结算', parent Column, adjacent [User, Pass]" });
    const bad = makeSnapshot({
      type: 'TextField',
      parentType: 'Row',
      rect: { x: 0, y: 0, width: 100, height: 30 },
      adjacentText: [],
      callbackNames: [],
      description: "TextField with text '', parent Row",
    });
    const result = strategy.heal(original, [good, bad], 0.5);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('heal returns null when all candidates below threshold', () => {
    const strategy = new MultiDimensionalHealingStrategy();
    const original = makeSnapshot();
    const result = strategy.heal(original, [], 0.5);
    expect(result).toBeNull();
  });

  it('uses custom weights', () => {
    const strategy = new MultiDimensionalHealingStrategy({ position: 1.0, context: 0, codeBinding: 0, text: 0 });
    const original = makeSnapshot();
    const samePos = makeSnapshot({ description: 'completely different' });
    const score = strategy.score(original, samePos);
    // Only position matters; same rect → score 1.0
    expect(score).toBe(1.0);
  });

  it('strategyName is multidimensional', () => {
    const strategy = new MultiDimensionalHealingStrategy();
    expect(strategy.strategyName).toBe('multidimensional');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/fliwright-core && npx vitest run tests/MultiDimensionalHealingStrategy.test.ts`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Write the strategy implementation**

```typescript
// packages/fliwright-core/src/strategies/MultiDimensionalHealingStrategy.ts
import type { HealingStrategy } from '../interfaces/HealingStrategy.js';
import type { WidgetSnapshot, HealingResult, WidgetInfo } from '../types.js';

export interface StrategyWeights {
  position: number;
  context: number;
  codeBinding: number;
  text: number;
}

const DEFAULT_WEIGHTS: StrategyWeights = {
  position: 0.20,
  context: 0.30,
  codeBinding: 0.15,
  text: 0.35,
};

const DEFAULT_THRESHOLD = 0.85;

export function buildNgramFreq(text: string, n: number): Map<string, number> {
  const freq = new Map<string, number>();
  for (let i = 0; i <= text.length - n; i++) {
    const gram = text.substring(i, i + n);
    freq.set(gram, (freq.get(gram) ?? 0) + 1);
  }
  return freq;
}

export function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (const [key, val] of a) {
    dotProduct += val * (b.get(key) ?? 0);
    normA += val * val;
  }
  for (const val of b.values()) normB += val * val;
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

export function ngramSimilarity(textA: string, textB: string, n = 2): number {
  if (textA.length < n || textB.length < n) return 0;
  return cosineSimilarity(buildNgramFreq(textA, n), buildNgramFreq(textB, n));
}

function euclidean(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function center(rect: { x: number; y: number; width: number; height: number }) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function positionScore(
  a: WidgetSnapshot,
  b: WidgetSnapshot,
): number {
  const ca = center(a.rect);
  const cb = center(b.rect);
  // Normalize by screen diagonal approximation (assume ~800x1600).
  const maxDist = Math.sqrt(800 ** 2 + 1600 ** 2);
  const dist = euclidean(ca, cb);
  return Math.max(0, 1 - dist / maxDist);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function contextScore(a: WidgetSnapshot, b: WidgetSnapshot): number {
  const parentMatch = (a.parentType && b.parentType && a.parentType === b.parentType) ? 1 : 0;
  const adjJaccard = jaccard(a.adjacentText, b.adjacentText);
  const typeMatch = a.type === b.type ? 1 : 0;
  return 0.5 * parentMatch + 0.3 * adjJaccard + 0.2 * typeMatch;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

function codeBindingScore(a: WidgetSnapshot, b: WidgetSnapshot): number {
  if (a.callbackNames.length === 0 && b.callbackNames.length === 0) return 0.5;
  let bestScore = 0;
  for (const nameA of a.callbackNames) {
    for (const nameB of b.callbackNames) {
      if (nameA === nameB) return 1.0;
      if (levenshtein(nameA, nameB) <= 3) bestScore = Math.max(bestScore, 0.6);
    }
  }
  return bestScore;
}

function textScore(a: WidgetSnapshot, b: WidgetSnapshot): number {
  const descA = a.description ?? '';
  const descB = b.description ?? '';
  return ngramSimilarity(descA, descB);
}

export class MultiDimensionalHealingStrategy implements HealingStrategy {
  readonly strategyName = 'multidimensional';
  private readonly weights: StrategyWeights;

  constructor(weights?: Partial<StrategyWeights>) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
    const total = this.weights.position + this.weights.context +
      this.weights.codeBinding + this.weights.text;
    if (Math.abs(total - 1.0) > 0.001) {
      throw new Error(`Strategy weights must sum to 1.0, got ${total}`);
    }
  }

  score(original: WidgetSnapshot, candidate: WidgetSnapshot): number {
    return (
      this.weights.position * positionScore(original, candidate) +
      this.weights.context * contextScore(original, candidate) +
      this.weights.codeBinding * codeBindingScore(original, candidate) +
      this.weights.text * textScore(original, candidate)
    );
  }

  heal(
    original: WidgetSnapshot,
    candidates: WidgetSnapshot[],
    threshold: number = DEFAULT_THRESHOLD,
  ): HealingResult | null {
    if (candidates.length === 0) return null;

    let bestScore = -1;
    let bestCandidate: WidgetSnapshot | null = null;

    for (const candidate of candidates) {
      const s = this.score(original, candidate);
      if (s > bestScore) {
        bestScore = s;
        bestCandidate = candidate;
      }
    }

    if (bestScore < threshold || bestCandidate == null) return null;

    // Build suggested selector from best candidate.
    const suggestedSelector = this.buildSuggestedSelector(bestCandidate);

    return {
      originalSelector: '',
      suggestedSelector,
      confidence: bestScore,
      matchedWidget: {
        id: 'healed',
        type: bestCandidate.type,
        text: bestCandidate.description?.split("'")[1] ?? undefined,
        rect: bestCandidate.rect,
        properties: {},
      },
    };
  }

  private buildSuggestedSelector(candidate: WidgetSnapshot): string {
    // Prefer text selector if description contains quoted text.
    const textMatch = candidate.description?.match(/'([^']+)'/);
    if (textMatch?.[1]) return `text=${textMatch[1]}`;
    return `byType=${candidate.type}`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/fliwright-core && npx vitest run tests/MultiDimensionalHealingStrategy.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-core/src/strategies/MultiDimensionalHealingStrategy.ts \
  packages/fliwright-core/tests/MultiDimensionalHealingStrategy.test.ts
git commit -m "feat(core): add MultiDimensionalHealingStrategy with n-gram text similarity"
```

---

## Task 4: HealingReport Type + WidgetSnapshot Extension

**Files:**
- Modify: `packages/fliwright-core/src/types.ts`

- [ ] **Step 1: Add HealingReport type and extend WidgetSnapshot**

In `packages/fliwright-core/src/types.ts`, add the `HealingReport` interface and the `firstSeen` optional field to `WidgetSnapshot`:

```typescript
// Add to existing WidgetSnapshot interface (around line 22-28):
export interface WidgetSnapshot {
  type: string;
  parentType: string;
  adjacentText: string[];
  rect: { x: number; y: number; width: number; height: number };
  callbackNames: string[];
  description?: string;
  firstSeen?: string;
}

// Add after HealingResult interface (around line 35):
export interface HealingReport {
  testName: string;
  originalSelector: string;
  suggestedSelector: string;
  confidence: number;
  scores: {
    position: number;
    context: number;
    codeBinding: number;
    text: number;
    weighted: number;
  };
  originalSnapshot: WidgetSnapshot;
  matchedWidget: WidgetInfo;
  timestamp: string;
}
```

- [ ] **Step 2: Run existing tests to verify nothing breaks**

Run: `cd packages/fliwright-core && npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/fliwright-core/src/types.ts
git commit -m "feat(core): add HealingReport type, extend WidgetSnapshot with description"
```

---

## Task 5: SelfHealingEngine

**Files:**
- Create: `packages/fliwright-core/src/SelfHealingEngine.ts`
- Test: `packages/fliwright-core/tests/SelfHealingEngine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/fliwright-core/tests/SelfHealingEngine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SelfHealingEngine } from '../src/SelfHealingEngine.js';
import { SnapshotStore } from '../src/SnapshotStore.js';
import { MultiDimensionalHealingStrategy } from '../src/strategies/MultiDimensionalHealingStrategy.js';
import type { WidgetSnapshot, WidgetInfo, FailureContext } from '../src/types.js';
import type { Locator } from '../src/Locator.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fliwright-healing-'));
});

function createMockLocator(selectorString: string): Locator {
  return { selectorString } as unknown as Locator;
}

const storedSnapshot: WidgetSnapshot = {
  type: 'ElevatedButton',
  parentType: 'Column',
  adjacentText: ['User', 'Pass'],
  rect: { x: 100, y: 400, width: 200, height: 48 },
  callbackNames: ['_onConfirm'],
  description: "ElevatedButton with text '确认支付', parent Column, adjacent [User, Pass]",
};

const candidateWidgets: WidgetSnapshot[] = [
  {
    type: 'ElevatedButton',
    parentType: 'Column',
    adjacentText: ['User', 'Pass'],
    rect: { x: 102, y: 401, width: 198, height: 47 },
    callbackNames: ['_onConfirm'],
    description: "ElevatedButton with text '去结算', parent Column, adjacent [User, Pass]",
  },
];

const failureContext: FailureContext = {
  assertion: { matcher: 'toBeVisible', expected: 'visible', actual: 'visible=false', timeout: 5000 },
  screenshot: null,
  widgetTree: {},
  source: { file: 'test.ts', line: 10, snippet: 'expect(locator).toBeVisible()' },
  timestamp: new Date().toISOString(),
};

describe('SelfHealingEngine', () => {
  it('setEnabled toggles healing', () => {
    const engine = new SelfHealingEngine(new SnapshotStore(tmpDir), new MultiDimensionalHealingStrategy());
    expect(engine.enabled).toBe(true);
    engine.setEnabled(false);
    expect(engine.enabled).toBe(false);
  });

  it('tryHeal returns healed=false when no stored snapshot', async () => {
    const store = new SnapshotStore(tmpDir);
    const engine = new SelfHealingEngine(store, new MultiDimensionalHealingStrategy());
    const locator = createMockLocator('text=确认支付');
    const result = await engine.tryHeal(locator, 'test1', failureContext, async () => candidateWidgets);
    expect(result.healed).toBe(false);
  });

  it('tryHeal returns healed=true when match found', async () => {
    const store = new SnapshotStore(tmpDir);
    await store.save('test1', 'text=确认支付', storedSnapshot);

    const engine = new SelfHealingEngine(store, new MultiDimensionalHealingStrategy());
    const locator = createMockLocator('text=确认支付');
    const result = await engine.tryHeal(locator, 'test1', failureContext, async () => candidateWidgets);
    expect(result.healed).toBe(true);
    expect(result.report).toBeDefined();
    expect(result.report!.confidence).toBeGreaterThan(0);
    expect(result.report!.suggestedSelector).toBeTruthy();
  });

  it('tryHeal returns healed=false when disabled', async () => {
    const store = new SnapshotStore(tmpDir);
    await store.save('test1', 'text=确认支付', storedSnapshot);

    const engine = new SelfHealingEngine(store, new MultiDimensionalHealingStrategy());
    engine.setEnabled(false);
    const locator = createMockLocator('text=确认支付');
    const result = await engine.tryHeal(locator, 'test1', failureContext, async () => candidateWidgets);
    expect(result.healed).toBe(false);
  });

  it('getReports returns accumulated reports', async () => {
    const store = new SnapshotStore(tmpDir);
    await store.save('test1', 'text=确认支付', storedSnapshot);

    const engine = new SelfHealingEngine(store, new MultiDimensionalHealingStrategy());
    const locator = createMockLocator('text=确认支付');
    await engine.tryHeal(locator, 'test1', failureContext, async () => candidateWidgets);

    const reports = engine.getReports();
    expect(reports.length).toBe(1);
    expect(reports[0].testName).toBe('test1');
  });

  it('getReports filters by test name', async () => {
    const store = new SnapshotStore(tmpDir);
    await store.save('test1', 'text=确认支付', storedSnapshot);

    const engine = new SelfHealingEngine(store, new MultiDimensionalHealingStrategy());
    const reports = engine.getReports('other');
    expect(reports.length).toBe(0);
  });

  it('recordSuccess saves snapshot from fetched widget data', async () => {
    const store = new SnapshotStore(tmpDir);
    const engine = new SelfHealingEngine(store, new MultiDimensionalHealingStrategy());
    const locator = createMockLocator('text=确认支付');

    const fetchedWidget: WidgetSnapshot = {
      type: 'ElevatedButton',
      parentType: 'Column',
      adjacentText: ['User'],
      rect: { x: 50, y: 200, width: 100, height: 40 },
      callbackNames: ['_onTap'],
      description: "ElevatedButton with text '确认支付', parent Column, adjacent [User]",
    };

    await engine.recordSuccess(locator, 'test2', async () => fetchedWidget);
    const loaded = store.load('test2', 'text=确认支付');
    expect(loaded).not.toBeNull();
    expect(loaded!.type).toBe('ElevatedButton');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/fliwright-core && npx vitest run tests/SelfHealingEngine.test.ts`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Write SelfHealingEngine implementation**

```typescript
// packages/fliwright-core/src/SelfHealingEngine.ts
import { SnapshotStore } from './SnapshotStore.js';
import type { HealingStrategy } from './interfaces/HealingStrategy.js';
import type { WidgetSnapshot, WidgetInfo, HealingReport, FailureContext } from './types.js';
import type { Locator } from './Locator.js';

type FetchSnapshot = () => Promise<WidgetSnapshot | WidgetSnapshot[]>;

export class SelfHealingEngine {
  private store: SnapshotStore;
  private strategy: HealingStrategy;
  private _enabled = true;
  private reports: HealingReport[] = [];

  constructor(store: SnapshotStore, strategy: HealingStrategy) {
    this.store = store;
    this.strategy = strategy;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  async recordSuccess(
    locator: Locator,
    testName: string,
    fetchSnapshot: FetchSnapshot,
  ): Promise<void> {
    const snapshot = await fetchSnapshot();
    const widgetSnapshot: WidgetSnapshot = Array.isArray(snapshot)
      ? snapshot[0]
      : snapshot;
    if (!widgetSnapshot) return;
    await this.store.save(testName, locator.selectorString, widgetSnapshot);
  }

  async tryHeal(
    locator: Locator,
    testName: string,
    failure: FailureContext,
    fetchCandidates: () => Promise<WidgetSnapshot[]>,
  ): Promise<{ healed: boolean; report?: HealingReport }> {
    if (!this._enabled) return { healed: false };

    const stored = this.store.load(testName, locator.selectorString);
    if (!stored) return { healed: false };

    const candidates = await fetchCandidates();
    if (candidates.length === 0) return { healed: false };

    const result = this.strategy.heal(stored, candidates);
    if (!result) return { healed: false };

    const report: HealingReport = {
      testName,
      originalSelector: locator.selectorString,
      suggestedSelector: result.suggestedSelector,
      confidence: result.confidence,
      scores: {
        position: 0,
        context: 0,
        codeBinding: 0,
        text: 0,
        weighted: result.confidence,
      },
      originalSnapshot: stored,
      matchedWidget: result.matchedWidget,
      timestamp: new Date().toISOString(),
    };

    this.reports.push(report);
    return { healed: true, report };
  }

  getReports(testName?: string): HealingReport[] {
    if (!testName) return [...this.reports];
    return this.reports.filter((r) => r.testName === testName);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/fliwright-core && npx vitest run tests/SelfHealingEngine.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-core/src/SelfHealingEngine.ts packages/fliwright-core/tests/SelfHealingEngine.test.ts
git commit -m "feat(core): add SelfHealingEngine with snapshot scoring and report generation"
```

---

## Task 6: Driver Integration — `healing` Getter

**Files:**
- Modify: `packages/fliwright-core/src/Driver.ts`

- [ ] **Step 1: Add healing getter to Driver**

In `packages/fliwright-core/src/Driver.ts`, add imports and the `healing` getter:

```typescript
// Add to imports at top:
import { SelfHealingEngine } from './SelfHealingEngine.js';
import { SnapshotStore } from './SnapshotStore.js';
import { MultiDimensionalHealingStrategy } from './strategies/MultiDimensionalHealingStrategy.js';

// Add class field (after _mock line):
private _healing: SelfHealingEngine | null = null;

// Add getter (after the mock getter):
get healing(): SelfHealingEngine {
  if (!this._healing) {
    this._healing = new SelfHealingEngine(
      new SnapshotStore(),
      new MultiDimensionalHealingStrategy(),
    );
  }
  return this._healing;
}
```

The full modified section of Driver.ts should look like:

```typescript
import { Page } from './Page.js';
import { PluginRegistry } from './PluginRegistry.js';
import { VMServiceConnector } from './VMServiceConnector.js';
import type { MockWebSocket } from './VMServiceConnector.js';
import type { FliwrightPlugin } from './interfaces/Plugin.js';
import type { StateAdapter } from './interfaces/StateAdapter.js';
import type { MockAdapter } from './interfaces/MockAdapter.js';
import type { FinderStrategy } from './interfaces/FinderStrategy.js';
import type { HealingStrategy } from './interfaces/HealingStrategy.js';
import { MockManager } from './MockManager.js';
import { SelfHealingEngine } from './SelfHealingEngine.js';
import { SnapshotStore } from './SnapshotStore.js';
import { MultiDimensionalHealingStrategy } from './strategies/MultiDimensionalHealingStrategy.js';
import type { TestResult } from './types.js';

export interface DriverOptions { plugins?: FliwrightPlugin[]; }

export class FliwrightDriver {
  private registry = new PluginRegistry();
  private connector = new VMServiceConnector();
  private _page: Page | null = null;
  private _mock: MockManager | null = null;
  private _healing: SelfHealingEngine | null = null;

  get mock(): MockManager {
    if (!this._mock) {
      this._mock = new MockManager((method, params) => this.connector.sendRequest(method, params));
    }
    return this._mock;
  }

  get healing(): SelfHealingEngine {
    if (!this._healing) {
      this._healing = new SelfHealingEngine(
        new SnapshotStore(),
        new MultiDimensionalHealingStrategy(),
      );
    }
    return this._healing;
  }

  get state(): StateAdapter {
    return this.registry.getStateAdapter('riverpod');
  }

  // ... rest of class unchanged ...
}
```

- [ ] **Step 2: Run existing Driver tests**

Run: `cd packages/fliwright-core && npx vitest run tests/Driver.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/fliwright-core/src/Driver.ts
git commit -m "feat(core): add healing getter to FliwrightDriver"
```

---

## Task 7: Assertion-Healing Integration

**Files:**
- Modify: `packages/fliwright-core/src/Assertion.ts`

- [ ] **Step 1: Extend Assertion constructor to accept healing params**

In `packages/fliwright-core/src/Assertion.ts`, add healing parameters to the constructor and add a healing hook in `toBeVisible`:

Add the import at the top:

```typescript
import type { SelfHealingEngine } from './SelfHealingEngine.js';
import type { FailureContext } from './types.js';
```

Extend the constructor to accept optional healing params:

```typescript
export class Assertion {
  private readonly locator: Locator;
  private readonly negated: boolean;
  private readonly failureCollector: FailureCollector | null;
  private readonly healingEngine: SelfHealingEngine | null;
  private readonly testName: string | null;
  private readonly sendRequest: ((method: string, params?: Record<string, unknown>) => Promise<unknown>) | null;

  constructor(
    locator: Locator,
    negated = false,
    failureCollector?: FailureCollector,
    healingEngine?: SelfHealingEngine,
    testName?: string,
    sendRequest?: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  ) {
    this.locator = locator;
    this.negated = negated;
    this.failureCollector = failureCollector ?? null;
    this.healingEngine = healingEngine ?? null;
    this.testName = testName ?? null;
    this.sendRequest = sendRequest ?? null;
  }
```

Update the `not` getter to pass through healing params:

```typescript
  get not(): Assertion {
    return new Assertion(
      this.locator,
      true,
      this.failureCollector ?? undefined,
      this.healingEngine ?? undefined,
      this.testName ?? undefined,
      this.sendRequest ?? undefined,
    );
  }
```

Add a private healing method:

```typescript
  private async attemptHealing(matcher: string, options?: { timeout?: number }): Promise<boolean> {
    if (!this.healingEngine || !this.testName || !this.sendRequest || this.negated) {
      return false;
    }
    try {
      const result = await this.healingEngine.tryHeal(
        this.locator,
        this.testName,
        {
          assertion: { matcher, expected: '', actual: '', timeout: options?.timeout ?? DEFAULT_TIMEOUT },
          screenshot: null,
          widgetTree: {},
          source: { file: '', line: 0, snippet: '' },
          timestamp: new Date().toISOString(),
        },
        async () => {
          const resp = await this.sendRequest!('ext.fliwright.snapshot', {}) as { widgets: WidgetSnapshot[] };
          return resp.widgets ?? [];
        },
      );

      if (result.healed && result.report) {
        // Re-run with the suggested selector.
        const newLocator = new (this.locator.constructor as any)(result.report.suggestedSelector, this.sendRequest);
        const healedAssertion = new Assertion(
          newLocator,
          false,
          this.failureCollector ?? undefined,
          // Don't pass healing engine to prevent recursion
        );
        await healedAssertion.toBeVisible(options);
        return true;
      }
    } catch {
      // Healing failed — will throw original error.
    }
    return false;
  }
```

Then in `toBeVisible`, add a healing attempt before throwing:

```typescript
  async toBeVisible(options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const selector = this.locator.selectorString;

    const passed = await pollUntil(
      () => this.locator.isVisible(),
      (visible) => (this.negated ? !visible : visible),
      timeout,
    );

    if (!passed) {
      // Try self-healing before throwing.
      if (!this.negated) {
        const healed = await this.attemptHealing('toBeVisible', options);
        if (healed) return;
      }
      const lastValue = await this.locator.isVisible();
      if (this.negated) {
        throw new AssertionError('toBeVisible', 'not visible', `visible=${lastValue}`, selector);
      } else {
        throw new AssertionError('toBeVisible', 'visible', `visible=${lastValue}`, selector);
      }
    }
  }
```

- [ ] **Step 2: Run existing Assertion tests**

Run: `cd packages/fliwright-core && npx vitest run tests/Assertion.test.ts`
Expected: PASS — all existing tests still pass (healing is optional, not provided by default)

- [ ] **Step 3: Commit**

```bash
git add packages/fliwright-core/src/Assertion.ts
git commit -m "feat(core): integrate self-healing into Assertion on toBeVisible failure"
```

---

## Task 8: Export New Modules

**Files:**
- Modify: `packages/fliwright-core/src/index.ts`

- [ ] **Step 1: Add exports**

In `packages/fliwright-core/src/index.ts`, add the following exports:

```typescript
// Add to type exports section:
export type { HealingReport } from './types.js';

// Add to value exports section:
export { SnapshotStore } from './SnapshotStore.js';
export { SelfHealingEngine } from './SelfHealingEngine.js';
export { MultiDimensionalHealingStrategy, ngramSimilarity } from './strategies/MultiDimensionalHealingStrategy.js';
```

- [ ] **Step 2: Run full test suite**

Run: `cd packages/fliwright-core && npx vitest run`
Expected: PASS — all tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/fliwright-core/src/index.ts
git commit -m "feat(core): export SelfHealingEngine, SnapshotStore, MultiDimensionalHealingStrategy"
```

---

## Task 9: Update Existing Driver Test for Healing Getter

**Files:**
- Modify: `packages/fliwright-core/tests/Driver.test.ts`

- [ ] **Step 1: Add test for healing getter**

In `packages/fliwright-core/tests/Driver.test.ts`, add after the existing `provides state adapter via convenience getter` test:

```typescript
  it('provides healing engine via convenience getter', async () => {
    const driver = new FliwrightDriver();
    await driver.attachMockConnector(createMockWSForDriver());
    const healing = driver.healing;
    expect(healing).toBeDefined();
    expect(healing.enabled).toBe(true);
  });
```

- [ ] **Step 2: Run Driver tests**

Run: `cd packages/fliwright-core && npx vitest run tests/Driver.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/fliwright-core/tests/Driver.test.ts
git commit -m "test(core): add test for driver.healing convenience getter"
```

---

## Task 10: Full Test Suite + Final Verification

**Files:** None new

- [ ] **Step 1: Run complete test suite**

Run: `cd packages/fliwright-core && npx vitest run`
Expected: All tests PASS

Run: `cd packages/fliwright-bridge && flutter test`
Expected: All tests PASS

- [ ] **Step 2: Run TypeScript type check**

Run: `cd packages/fliwright-core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify file structure matches spec**

Run: `find packages/ -name "SnapshotStore*" -o -name "SelfHealing*" -o -name "MultiDimensional*" -o -name "snapshot.dart" | sort`
Expected output should include:
```
packages/fliwright-bridge/lib/src/extensions/snapshot.dart
packages/fliwright-core/src/SelfHealingEngine.ts
packages/fliwright-core/src/SnapshotStore.ts
packages/fliwright-core/src/strategies/MultiDimensionalHealingStrategy.ts
packages/fliwright-core/tests/SelfHealingEngine.test.ts
packages/fliwright-core/tests/SnapshotStore.test.ts
packages/fliwright-core/tests/MultiDimensionalHealingStrategy.test.ts
```
