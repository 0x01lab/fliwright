---
module: "MultiDimensionalHealingStrategy"
package: "@fliwright/core"
source: "src/strategies/MultiDimensionalHealingStrategy.ts"
generated: "2026-06-02"
---

# MultiDimensionalHealingStrategy

> Heals broken selectors via weighted scoring across position, context, codeBinding, and text dimensions.

## Overview

Implements `HealingStrategy` with four scoring dimensions:
- **Position** (20%): Euclidean distance between widget centers
- **Context** (30%): Parent type match + adjacent text Jaccard similarity + type match
- **Code binding** (15%): Callback name matching via Levenshtein distance
- **Text** (35%): N-gram (bigram) cosine similarity of descriptions

Default threshold: 0.85. Weights must sum to 1.0.

## Constructor

```typescript
constructor(weights?: Partial<StrategyWeights>)
```

## Public Methods

### `score(original: WidgetSnapshot, candidate: WidgetSnapshot): number`

Computes weighted score across all dimensions.

### `scoreDimensions(original, candidate): { position, context, codeBinding, text, weighted }`

Returns per-dimension scores for diagnostics.

### `heal(original: WidgetSnapshot, candidates: WidgetSnapshot[], threshold?: number): HealingResult | null`

Finds the best matching candidate above the threshold.

## Exported Functions

### `ngramSimilarity(textA: string, textB: string, n?: number): number`

Computes bigram cosine similarity between two strings.

### `buildNgramFreq(text: string, n: number): Map<string, number>`

Builds n-gram frequency map.

### `cosineSimilarity(a: Map, b: Map): number`

Computes cosine similarity between frequency maps.

## Related

- **Used by:** [SelfHealingEngine](./SelfHealingEngine.md)
- **Source:** `src/strategies/MultiDimensionalHealingStrategy.ts`
