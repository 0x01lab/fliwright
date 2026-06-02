---
module: "MultiDimensionalHealingStrategy"
package: "@fliwright/core"
source: "src/strategies/MultiDimensionalHealingStrategy.ts"
tests: "tests/MultiDimensionalHealingStrategy.test.ts"
generated: "2026-06-02"
---

# MultiDimensionalHealingStrategy

> Scores candidate widget snapshots against a baseline across four weighted dimensions: position, context, code-binding, and text similarity.

## Overview

The strategy combines four sub-scores via configurable weights (defaults: position 0.20, context 0.30, codeBinding 0.15, text 0.35 — must sum to 1.0). The best candidate above the confidence threshold (default 0.85) is returned with a freshly built selector.

## Constructor

```typescript
constructor(weights?: Partial<StrategyWeights>)
```

```typescript
interface StrategyWeights {
  position: number;
  context: number;
  codeBinding: number;
  text: number;
}
```

**Throws:** `Error('Strategy weights must sum to 1.0')` if weights don't total 1.

## Public Methods

### `score(original, candidate): number`

Returns the weighted total score.

### `scoreDimensions(original, candidate): { position, context, codeBinding, text, weighted }`

Returns per-dimension sub-scores plus the weighted total. Used by `SelfHealingEngine` to populate `HealingReport.scores`.

### `heal(original, candidates, threshold?): HealingResult | null`

Finds the highest-scoring candidate, returns `null` if it's below `threshold` (default 0.85). Otherwise returns:

```typescript
{
  originalSelector: '',
  suggestedSelector: string,  // 'text=...' or 'byType=...'
  confidence: number,         // best score
  matchedWidget: { id, type, text?, rect, properties: {} },
}
```

## Standalone Functions

### `ngramSimilarity(textA, textB, n?): number`

Cosine similarity over n-gram frequency vectors. Returns 0..1.

### `buildNgramFreq(text, n): Map<string, number>`

### `cosineSimilarity(a, b): number`

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `strategyName` | `'multidimensional'` | Static identifier |

## Sub-Score Formulas

| Dimension | Formula |
|-----------|---------|
| `position` | `max(0, 1 − euclidean(center(a), center(b)) / sqrt(800² + 1600²))` |
| `context` | `0.5 · parentTypeMatch + 0.3 · adjacentTextJaccard + 0.2 · typeMatch` |
| `codeBinding` | Best of: 1.0 exact callback name match, 0.6 if Levenshtein ≤ 3, else 0.5 if both empty |
| `text` | `ngramSimilarity(a.description, b.description)` (n=2) |

## Example

```typescript
import { MultiDimensionalHealingStrategy, ngramSimilarity } from '@fliwright/core';

const strategy = new MultiDimensionalHealingStrategy();
const result = strategy.heal(baselineSnapshot, candidateSnapshots);
console.log(result?.confidence, result?.suggestedSelector);

const sim = ngramSimilarity('Login', 'Log in', 2);
```

## Related

- **Implements:** `HealingStrategy` (interface)
- **Used by:** [SelfHealingEngine](./SelfHealingEngine.md)
- **Source:** `packages/fliwright-core/src/strategies/MultiDimensionalHealingStrategy.ts`
