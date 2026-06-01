---
feature: "Self-Healing Pipeline"
packages: ["@fliwright/core", "fliwright-bridge"]
status: implemented
agent_accessible: true
mcp_tool: "fliwright_get_failure"
generated: "2026-06-01"
---

# Self-Healing Pipeline

> Automatically recovers from broken selectors when the Flutter UI changes between test runs.

## Architecture

1. **Assertion** (`Assertion`): When a selector fails, invokes the self-healing engine before throwing.
2. **SelfHealingEngine** (`SelfHealingEngine`): Orchestrates healing by fetching current widget snapshots and delegating to the strategy.
3. **MultiDimensionalHealingStrategy** (`MultiDimensionalHealingStrategy`): Scores candidates across position, context, code binding, and text dimensions.
4. **SnapshotStore** (`SnapshotStore`): Persists successful widget snapshots to disk for future comparison.
5. **SnapshotExtension** (Dart bridge): Captures interactive widget metadata from the Flutter widget tree.
6. **FailureCollector** (`FailureCollector`): Captures screenshot, widget tree, and source location on failure.

## Agent Integration

AI agents can use `fliwright_get_failure` to retrieve healing suggestions. Each failure entry includes a `healingSuggestion` with the original selector, suggested replacement, confidence score, and per-dimension breakdown.

## Data Flow

```
Assertion fails
    │
    ▼
SelfHealingEngine.tryHeal()
    │
    ├── Fetch original snapshot from SnapshotStore
    ├── Fetch current candidates via bridge (ext.fliwright.snapshot)
    │
    ▼
MultiDimensionalHealingStrategy.heal()
    │
    ├── positionScore() — Euclidean distance
    ├── contextScore()  — Jaccard similarity of adjacent text
    ├── codeBindingScore() — Levenshtein on callback names
    ├── textScore()     — Levenshtein on text content
    │
    ▼
Weighted score > threshold (0.85)?
    │
    ├── Yes → Return HealingResult with suggested selector
    └── No  → Return null, assertion throws AssertionError
    │
    ▼ (on success)
FailureCollector.collect()
    │
    ├── ext.fliwright.screenshot → PNG
    ├── ext.fliwright.snapshot  → widget tree
    └── Error stack trace → source location
    │
    ▼
Write MCP failure context → available via fliwright_get_failure
```

## Key Files

- `packages/fliwright-core/src/Assertion.ts` — Assertion with healing trigger
- `packages/fliwright-core/src/SelfHealingEngine.ts` — Healing orchestrator
- `packages/fliwright-core/src/SnapshotStore.ts` — Snapshot persistence
- `packages/fliwright-core/src/strategies/MultiDimensionalHealingStrategy.ts` — Scoring strategy
- `packages/fliwright-core/src/FailureCollector.ts` — Failure context capture
- `packages/fliwright-bridge/lib/src/extensions/snapshot.dart` — Widget snapshot capture
