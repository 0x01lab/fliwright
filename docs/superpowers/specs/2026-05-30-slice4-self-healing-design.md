# Slice 4: Self-Healing Loop — Auto-Fix on Failure

**Date**: 2026-05-30
**Status**: Approved
**Depends on**: Slice 0 (Extensible Architecture), Slice 1 (Minimal Loop), Slice 2 (Assertion Loop), Slice 3 (Mock Loop)

---

## Goal

When selectors break due to UI changes, automatically find alternative widgets and continue execution. After Slice 4, a test that previously passed will self-heal when a button's text changes from "确认支付" to "去结算", passing with a confidence report instead of failing.

---

## Delivery Approach: Vertical Slice Iteration

Four iterations, each delivering a demoable end-to-end capability:

| Iteration | Scope | User Gets |
|-----------|-------|-----------|
| 4-A | Dart snapshot extension + SnapshotStore | "Trigger snapshot → store to disk" end-to-end |
| 4-B | MultiDimensionalHealingStrategy (4-dimension weighted scoring with n-gram) | "Given original + candidates → return match scores" end-to-end |
| 4-C | SelfHealingEngine + Assertion integration + Healing report | "Assertion fails → self-heal → pass with report" end-to-end |
| 4-D | Integration test | Simulate UI changes, verify healing accuracy |

---

## 1. Dart Snapshot Extension — `ext.fliwright.snapshot`

### 1.1 Purpose

Collect multi-dimensional feature metadata for all visible interactive widgets on the current screen. This data feeds the fuzzy matching algorithm on the TS side.

### 1.2 Widget Feature Extraction

For each interactive widget (ElevatedButton, TextButton, TextField, IconButton, Checkbox, Switch, etc.), extract:

| Feature | Source | Example |
|---------|--------|---------|
| `id` | Widget inspector internal ID | `"widget_123"` |
| `type` | Widget runtime type name | `"ElevatedButton"` |
| `text` | Child Text widget content | `"确认支付"` |
| `key` | Widget Key if present | `null` |
| `rect` | RenderBox paint bounds | `{ x: 100, y: 400, width: 200, height: 48 }` |
| `parentType` | Direct parent widget type | `"Column"` |
| `parentText` | Parent's child text (if any) | `null` |
| `adjacentTexts` | Sibling widgets' text content | `["总金额: ¥99", "取消"]` |
| `callbackNames` | onPressed/onChanged callback function names | `["_onConfirm"]` |
| `properties` | Additional properties (enabled, checked, etc.) | `{ enabled: true }` |

### 1.3 Response Format

```json
{
  "widgets": [
    {
      "id": "widget_123",
      "type": "ElevatedButton",
      "text": "确认支付",
      "key": null,
      "rect": { "x": 100, "y": 400, "width": 200, "height": 48 },
      "parentType": "Column",
      "parentText": null,
      "adjacentTexts": ["总金额: ¥99", "取消"],
      "callbackNames": ["_onConfirm"],
      "properties": { "enabled": true }
    }
  ]
}
```

### 1.4 Implementation

- Traverse `WidgetsBinding.instance.renderViewElement` recursively
- Filter to interactive widgets using a known-type whitelist
- `adjacentTexts`: collect text from sibling nodes (same parent)
- `callbackNames`: extract via `WidgetInspectorService` properties or debugger inspection
- Reuse partial logic from existing `inspect` extension

**Estimate**: 2 days

---

## 2. Metadata Storage — SnapshotStore

### 2.1 Storage Location

```
.fliwright/
  snapshots/
    {sanitized_test_name}/
      {url_encoded_selector}.json
```

Example: `.fliwright/snapshots/login_test/text%3D%E7%99%BB%E5%BD%95.json`

### 2.2 Snapshot File Format

```json
{
  "testName": "user can log in",
  "selector": "text=登录",
  "snapshot": {
    "type": "ElevatedButton",
    "parentType": "Column",
    "adjacentText": ["用户名", "密码"],
    "rect": { "x": 100, "y": 400, "width": 200, "height": 48 },
    "callbackNames": ["_onLogin"],
    "description": "ElevatedButton with text '登录', parent Column, adjacent [用户名, 密码]"
  },
  "firstSeen": "2026-05-30T10:00:00Z",
  "lastUpdated": "2026-05-30T10:00:00Z"
}
```

### 2.3 Snapshot Trigger Points

1. **On first success**: When `locator.click()`, `locator.type()`, or `expect(locator).toBeVisible()` succeeds, record the Widget metadata snapshot keyed by `(testName, selector)`
2. **On heal success**: After a successful self-heal, update the snapshot with the new Widget's metadata

### 2.4 API

```typescript
class SnapshotStore {
  constructor(baseDir?: string);  // default: .fliwright/snapshots
  load(testName: string, selector: string): WidgetSnapshot | null;
  save(testName: string, selector: string, snapshot: WidgetSnapshot): Promise<void>;
  list(testName: string): Map<string, WidgetSnapshot>;
}
```

**Estimate**: 1 day

---

## 3. Text Similarity — Character N-Gram Cosine Similarity

### 3.1 Approach

Replace ONNX embedding with a zero-dependency character n-gram cosine similarity. This computes text similarity by:

1. Split each text into character bigrams (n=2)
2. Build a frequency vector per text
3. Compute cosine similarity between vectors

**Why not embedding model**: ONNX Runtime + model adds ~30MB dependency and initialization overhead. N-gram similarity is <1ms per comparison with zero dependencies, and effective for the typical UI change patterns (typos, partial text changes, wording variations).

### 3.2 Widget Description Text

Construct a description string from structured features for comparison:

```
${type} ${text} ${parentType} ${adjacentTexts.join(' ')}
```

Example: `"ElevatedButton 确认支付 Column 总金额: ¥99 取消"`

For major semantic rewrites where text changes completely (e.g. "确认支付" → "去结算"), the other three dimensions (position, context, code binding) compensate — the match is still found because parent type, adjacent text, and position remain stable.

### 3.3 Algorithm

```typescript
function ngramSimilarity(textA: string, textB: string, n = 2): number {
  const gramsA = buildNgramFreq(textA, n);
  const gramsB = buildNgramFreq(textB, n);
  return cosineSimilarity(gramsA, gramsB);
}

function buildNgramFreq(text: string, n: number): Map<string, number> {
  const freq = new Map<string, number>();
  for (let i = 0; i <= text.length - n; i++) {
    const gram = text.substring(i, i + n);
    freq.set(gram, (freq.get(gram) ?? 0) + 1);
  }
  return freq;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dotProduct = 0, normA = 0, normB = 0;
  for (const [key, val] of a) {
    dotProduct += val * (b.get(key) ?? 0);
    normA += val * val;
  }
  for (const val of b.values()) normB += val * val;
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
```

### 3.4 Integration

N-gram similarity is computed inline within `MultiDimensionalHealingStrategy.score()`. No separate engine class needed — no initialization, no async, no model loading.

**Estimate**: 0.5 days (down from 1 day — no ONNX integration)

---

## 4. Multi-Dimensional Fuzzy Matching Strategy

### 4.1 Four Scoring Dimensions

Each dimension scores independently in `[0, 1]`. Final score = weighted sum.

| Dimension | Weight | Algorithm | Details |
|-----------|--------|-----------|---------|
| Position similarity | 0.20 | `1 - euclidean(center_a, center_b) / max_distance` | Normalized by screen diagonal; closer = higher |
| Context similarity | 0.30 | `0.5 * parent_type_match + 0.3 * jaccard(adjacent_texts) + 0.2 * type_match` | Parent type exact match, adjacent text Jaccard, widget type exact match |
| Code binding | 0.15 | Exact match 1.0 / fuzzy match 0.6 / no match 0.0 | Callback function name comparison (Levenshtein distance <= 3 = fuzzy) |
| Text similarity | 0.35 | `ngram_cosine_similarity(desc_a, desc_b)` | Character bigram cosine similarity on widget description text |

### 4.2 Threshold

- Default: **0.85** (configurable via `healing.threshold`)
- Best score >= threshold → heal succeeds, redirect to matched widget
- Best score < threshold → heal fails, throw original AssertionError

### 4.3 Class

```typescript
class MultiDimensionalHealingStrategy implements HealingStrategy {
  readonly strategyName = 'multidimensional';
  private weights: { position: number; context: number; codeBinding: number; text: number };

  constructor(weights?: Partial<Weights>);

  score(original: WidgetSnapshot, candidate: WidgetSnapshot): number;
  heal(original: WidgetSnapshot, candidates: WidgetSnapshot[], threshold?: number): HealingResult | null;
}
```

**Estimate**: 2 days

---

## 5. Self-Healing Engine

### 5.1 Healing Flow

```
Assertion fails (AssertionError)
  → SelfHealingEngine.tryHeal(locator, testName, failureContext)
    → 1. Load stored snapshot for (testName, selector) from SnapshotStore
    → 2. If no stored snapshot → return { healed: false }
    → 3. Call ext.fliwright.snapshot to get all candidate widgets
    → 4. Compute scores for each candidate vs stored snapshot
    → 5. If bestScore >= threshold:
         → Return { healed: true, report: HealingReport }
    → 6. Assertion receives result:
         → Re-run assertion with new selector
         → If passes → "healed pass", generate report
         → If fails → throw original AssertionError
```

### 5.2 API

```typescript
class SelfHealingEngine {
  private store: SnapshotStore;
  private strategy: HealingStrategy;
  private enabled: boolean;
  private reports: HealingReport[];

  setEnabled(enabled: boolean): void;

  // Called on first success (from Locator/Assertion)
  async recordSuccess(locator: Locator, testName: string): Promise<void>;

  // Called on assertion failure
  async tryHeal(
    locator: Locator, testName: string, failure: FailureContext
  ): Promise<{ healed: boolean; report?: HealingReport }>;

  // Query historical reports
  getReports(testName?: string): HealingReport[];
}
```

### 5.3 Driver Integration

```typescript
class FliwrightDriver {
  private _healing: SelfHealingEngine | null;

  get healing(): SelfHealingEngine {
    if (!this._healing) {
      this._healing = new SelfHealingEngine(
        new SnapshotStore(),
        new MultiDimensionalHealingStrategy(),
      );
    }
    return this._healing;
  }
}
```

**Estimate**: 1 day

---

## 6. Assertion-Healing Integration

### 6.1 Integration Point

In `Assertion.ts`, after `pollUntil` returns `false` (timeout), before throwing `AssertionError`:

```typescript
// After pollUntil fails — this pattern applies to ALL matchers (toBeVisible, toHaveText, etc.)
if (this.healingEngine && this.healingEngine.enabled) {
  const result = await this.healingEngine.tryHeal(
    this.locator, this.testName, failureContext
  );
  if (result.healed && result.report) {
    // Re-run assertion with suggested selector (e.g. "text=去结算" if text changed)
    const newLocator = page.locator(result.report.suggestedSelector);
    const healedAssertion = new Assertion(newLocator, this.negated, this.failureCollector);
    // Re-run the same matcher that failed (caller-specific, not hardcoded to toBeVisible)
    await healedAssertion[matcherName](matcherArgs);
    this._reportHealing(result.report);
    return;  // healed pass
  }
}
// No healing or heal failed — throw original error
```

### 6.2 Trigger Conditions

- **Only AssertionError triggers healing**: Operation failures (click/type finding no widget) do not trigger healing — they throw regular `Error`
- **Max 1 heal attempt per assertion**: Prevent recursive healing attempts
- **Configurable**: `driver.healing.setEnabled(false)` to disable

### 6.3 Assertion Constructor Extension

```typescript
class Assertion {
  constructor(
    locator: Locator,
    negated?: boolean,
    failureCollector?: FailureCollector,
    healingEngine?: SelfHealingEngine,  // new optional param
    testName?: string,                   // new optional param for snapshot keying
  );
}
```

**Estimate**: 1 day

---

## 7. Healing Report

### 7.1 Structure

```typescript
interface HealingReport {
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
  originalWidget: WidgetSnapshot;
  matchedWidget: WidgetInfo;
  timestamp: string;
}
```

### 7.2 Suggested Selector Construction

When a healing match succeeds, `suggestedSelector` is constructed from the matched widget's most distinctive feature:
1. If widget has unique text → `text={matchedText}` (most common case)
2. If widget has a Key → `key={key}`
3. Otherwise → `type={widgetType}`

### 7.3 Storage

- Path: `.fliwright/healing-reports/{timestamp}_{sanitized_test_name}.json`
- Queryable via `driver.healing.getReports(testName?)`
- Future MCP Server can read reports to push to AI Agent

**Estimate**: 1 day (included in SelfHealingEngine estimate)

---

## 8. File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/fliwright-bridge/lib/src/extensions/snapshot.dart` | Widget metadata snapshot extension |
| `packages/fliwright-core/src/SelfHealingEngine.ts` | Self-healing engine main class |
| `packages/fliwright-core/src/SnapshotStore.ts` | Local file storage for snapshots |
| `packages/fliwright-core/src/strategies/MultiDimensionalHealingStrategy.ts` | Four-dimension weighted scoring (includes n-gram similarity) |
| `packages/fliwright-core/tests/SelfHealingEngine.test.ts` | Engine unit tests |
| `packages/fliwright-core/tests/SnapshotStore.test.ts` | Storage tests |
| `packages/fliwright-core/tests/MultiDimensionalHealingStrategy.test.ts` | Strategy tests (includes n-gram tests) |

### Modified Files

| File | Change |
|------|--------|
| `packages/fliwright-bridge/lib/src/bridge.dart` | Register snapshot extension |
| `packages/fliwright-bridge/lib/fliwright_bridge.dart` | Export snapshot extension |
| `packages/fliwright-core/src/Assertion.ts` | Trigger self-healing on assertion failure |
| `packages/fliwright-core/src/Driver.ts` | Add `healing` convenience getter |
| `packages/fliwright-core/src/types.ts` | Add `HealingReport` type |
| `packages/fliwright-core/src/index.ts` | Export new classes |

---

## 9. Estimates Summary

| Task | Description | Days | Iteration |
|------|-------------|------|-----------|
| 4.1 | Dart: Snapshot extension | 2d | 4-A |
| 4.2 | TS: SnapshotStore | 1d | 4-A |
| 4.3 | TS: MultiDimensionalHealingStrategy (with n-gram similarity) | 2d | 4-B |
| 4.4 | TS: SelfHealingEngine | 1d | 4-C |
| 4.5 | TS: Assertion-healing integration | 1d | 4-C |
| 4.6 | TS: Healing report | 1d | 4-C |
| 4.7 | Integration test | 2d | 4-D |
| **Total** | | **10d** | |

---

## 10. Dependencies

- Slice 0: PluginRegistry, HealingStrategy interface, WidgetSnapshot/HealingResult types
- Slice 1: FliwrightDriver, VM Service communication
- Slice 2: Assertion engine, Locator, FailureCollector
- Slice 3: Mock + State injection (for integration test scenarios)

### New NPM Dependencies

None. All similarity computation is pure TypeScript with no external dependencies.

---

## 11. Out of Scope

- Healing for non-assertion failures (click/type finding no widget)
- Cross-screen healing (widget moved to different page/route)
- Healing for structural changes (widget removed entirely)
- MCP Server healing report integration (Slice 7)
- VS Code healing UI (Slice 8)
