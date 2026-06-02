---
feature: "Self-Healing Pipeline"
packages: ["@fliwright/core", "fliwright-bridge"]
status: implemented
agent_accessible: true
mcp_tool: "fliwright_run / fliwright_get_failure"
generated: "2026-06-02"
---

# Self-Healing Pipeline

> Automatically repairs broken widget selectors when assertions fail, using multi-dimensional similarity scoring against previously recorded snapshots.

## Architecture

1. **Record Success** (`Assertion`): When an assertion passes, `SelfHealingEngine.recordSuccess()` captures the widget snapshot via `ext.fliwright.snapshot` and stores it in `SnapshotStore` under `.fliwright/snapshots/<test>/<selector>.json`.

2. **Detect Failure** (`Assertion`): When an assertion fails after polling, `SelfHealingEngine.tryHeal()` is invoked before throwing the error.

3. **Load Snapshot** (`SnapshotStore`): Loads the previously stored `WidgetSnapshot` for the (testName, selector) pair.

4. **Fetch Candidates** (`Assertion`): Calls `ext.fliwright.snapshot` to get all current interactive widgets on screen.

5. **Score & Match** (`MultiDimensionalHealingStrategy`): Scores each candidate across four weighted dimensions:
   - **Position** (20%): Euclidean distance between widget centers
   - **Context** (30%): Parent type match + adjacent text Jaccard similarity + type match
   - **Code binding** (15%): Callback name matching via Levenshtein distance
   - **Text** (35%): Bigram cosine similarity of semantics descriptions

6. **Re-run Assertion** (`Assertion`): If a candidate scores above the 0.85 threshold, creates a new `Locator` with the suggested selector and re-runs the assertion.

7. **Report** (`SelfHealingEngine`): Generates a `HealingReport` with per-dimension scores, stored for MCP agent retrieval.

## Agent Integration

AI agents can leverage self-healing through:
- **`fliwright_run`**: Runs tests; healing happens automatically during assertion execution
- **`fliwright_get_failure`**: Returns failure entries with `healingSuggestion` including original selector, suggested selector, confidence score, and per-dimension breakdown

## Data Flow

```
Assertion Pass
    │
    ▼
SelfHealingEngine.recordSuccess()
    │
    ▼
SnapshotStore.save(testName, selector, WidgetSnapshot)
    │                │
    │                ▼
    │    .fliwright/snapshots/<test>/<selector>.json
    │
    ▼ (later, on failure)
Assertion Fail → SelfHealingEngine.tryHeal()
    │
    ├── SnapshotStore.load() ──→ stored WidgetSnapshot
    │
    ├── ext.fliwright.snapshot ──→ current WidgetSnapshot[]
    │
    ├── MultiDimensionalHealingStrategy.heal()
    │   ├── positionScore()     ← 20%
    │   ├── contextScore()      ← 30%
    │   ├── codeBindingScore()  ← 15%
    │   └── textScore()         ← 35%
    │
    ├── score ≥ 0.85? ──→ YES → new Locator(suggestedSelector)
    │                           │
    │                           ▼
    │                    Re-run assertion
    │                           │
    │                    ┌──────┴──────┐
    │                    Pass          Fail
    │                    │             │
    │                    ▼             ▼
    │                Success      AssertionError
    │
    └── score < 0.85? ──→ throw AssertionError
```

## Key Files

- `packages/fliwright-core/src/Assertion.ts` — Assertion with self-healing integration
- `packages/fliwright-core/src/SelfHealingEngine.ts` — Orchestrates record + heal
- `packages/fliwright-core/src/SnapshotStore.ts` — File-based snapshot persistence
- `packages/fliwright-core/src/strategies/MultiDimensionalHealingStrategy.ts` — Scoring algorithm
- `packages/fliwright-bridge/lib/src/extensions/snapshot.dart` — Widget snapshot capture
