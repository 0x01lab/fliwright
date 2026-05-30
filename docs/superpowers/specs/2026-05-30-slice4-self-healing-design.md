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
| 4-A | Dart snapshot extension + SnapshotStore + EmbeddingEngine | "Trigger snapshot → store to disk → embedding ready" end-to-end |
| 4-B | MultiDimensionalHealingStrategy (4-dimension weighted scoring) | "Given original + candidates → return match scores" end-to-end |
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

## 3. Embedding Engine — ONNX Runtime Integration

### 3.1 Model

- **Model**: `all-MiniLM-L6-v2` (22MB, 384-dimensional embeddings)
- **Runtime**: `onnxruntime-node`
- **Location**: Shipped with `@fliwright/core` or downloaded on first use to `.fliwright/models/`

### 3.2 Widget Description Text

Construct a natural language description from structured features for embedding:

```
${type} with text '${text}', parent ${parentType}, adjacent [${adjacentTexts.join(', ')}]
```

Example: `"ElevatedButton with text '确认支付', parent Column, adjacent [总金额: ¥99, 取消]"`

When text changes from "确认支付" to "去结算", the context (parent, adjacent) stays the same and embeddings remain semantically close.

### 3.3 API

```typescript
class EmbeddingEngine {
  private session: InferenceSession | null;
  
  async init(): Promise<void>;                    // Load model (lazy, once)
  async embed(text: string): Promise<number[]>;   // Return 384-dim vector
  async embedBatch(texts: string[]): Promise<number[][]>;  // Batch for efficiency
  async dispose(): Promise<void>;
}
```

### 3.4 Initialization

Model is loaded during `Driver.connect()` to avoid cold-start latency during test execution.

**Estimate**: 1 day

---

## 4. Multi-Dimensional Fuzzy Matching Strategy

### 4.1 Four Scoring Dimensions

Each dimension scores independently in `[0, 1]`. Final score = weighted sum.

| Dimension | Weight | Algorithm | Details |
|-----------|--------|-----------|---------|
| Position similarity | 0.20 | `1 - euclidean(center_a, center_b) / max_distance` | Normalized by screen diagonal; closer = higher |
| Context similarity | 0.30 | `0.5 * parent_type_match + 0.3 * jaccard(adjacent_texts) + 0.2 * type_match` | Parent type exact match, adjacent text Jaccard, widget type exact match |
| Code binding | 0.15 | Exact match 1.0 / fuzzy match 0.6 / no match 0.0 | Callback function name comparison (Levenshtein for fuzzy) |
| Semantic vector | 0.35 | `cosine_similarity(desc_embedding_a, desc_embedding_b)` | Widget description embedding cosine similarity |

### 4.2 Threshold

- Default: **0.85** (configurable via `healing.threshold`)
- Best score >= threshold → heal succeeds, redirect to matched widget
- Best score < threshold → heal fails, throw original AssertionError

### 4.3 Class

```typescript
class MultiDimensionalHealingStrategy implements HealingStrategy {
  readonly strategyName = 'multidimensional';
  private embeddingEngine: EmbeddingEngine;
  private weights: { position: number; context: number; codeBinding: number; semantic: number };
  
  constructor(embeddingEngine: EmbeddingEngine, weights?: Partial<Weights>);
  
  score(original: WidgetSnapshot, candidate: WidgetSnapshot): number;
  heal(original: WidgetSnapshot, candidates: WidgetSnapshot[], threshold?: number): HealingResult | null;
}
```

**Estimate**: 2 days (matching algorithm 1.5d + scoring integration 0.5d)

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
  private embeddingEngine: EmbeddingEngine;
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
        new MultiDimensionalHealingStrategy(this._embeddingEngine),
        this._embeddingEngine,
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
// After pollUntil fails:
if (this.healingEngine && this.healingEngine.enabled) {
  const result = await this.healingEngine.tryHeal(
    this.locator, this.testName, failureContext
  );
  if (result.healed && result.report) {
    // Re-run assertion with suggested selector
    const newLocator = page.locator(result.report.suggestedSelector);
    const healedAssertion = new Assertion(newLocator, this.negated, this.failureCollector);
    // Re-run the same matcher
    await healedAssertion.toBeVisible(options);
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
    semantic: number;
    weighted: number;
  };
  originalWidget: WidgetSnapshot;
  matchedWidget: WidgetInfo;
  timestamp: string;
}
```

### 7.2 Storage

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
| `packages/fliwright-core/src/EmbeddingEngine.ts` | ONNX Runtime embedding wrapper |
| `packages/fliwright-core/src/strategies/MultiDimensionalHealingStrategy.ts` | Four-dimension weighted scoring |
| `packages/fliwright-core/tests/SelfHealingEngine.test.ts` | Engine unit tests |
| `packages/fliwright-core/tests/SnapshotStore.test.ts` | Storage tests |
| `packages/fliwright-core/tests/EmbeddingEngine.test.ts` | Embedding tests |
| `packages/fliwright-core/tests/MultiDimensionalHealingStrategy.test.ts` | Strategy tests |

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
| 4.3 | TS: EmbeddingEngine (ONNX) | 1d | 4-A |
| 4.4 | TS: MultiDimensionalHealingStrategy | 2d | 4-B |
| 4.5 | TS: SelfHealingEngine | 1d | 4-C |
| 4.6 | TS: Assertion-healing integration | 1d | 4-C |
| 4.7 | TS: Healing report | 1d | 4-C |
| 4.8 | Integration test | 2d | 4-D |
| **Total** | | **11d** | |

---

## 10. Dependencies

- Slice 0: PluginRegistry, HealingStrategy interface, WidgetSnapshot/HealingResult types
- Slice 1: FliwrightDriver, VM Service communication
- Slice 2: Assertion engine, Locator, FailureCollector
- Slice 3: Mock + State injection (for integration test scenarios)

### New NPM Dependencies

- `onnxruntime-node`: ONNX model inference runtime
- `all-MiniLM-L6-v2` model file (22MB, vendored or downloaded)

---

## 11. Out of Scope

- Healing for non-assertion failures (click/type finding no widget)
- Cross-screen healing (widget moved to different page/route)
- Healing for structural changes (widget removed entirely)
- MCP Server healing report integration (Slice 7)
- VS Code healing UI (Slice 8)
