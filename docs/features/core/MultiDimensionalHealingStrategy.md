---
module: "MultiDimensionalHealingStrategy"
package: "@fliwright/core"
source: "src/strategies/MultiDimensionalHealingStrategy.ts"
generated: "2026-06-01"
---

# MultiDimensionalHealingStrategy

> Multi-dimensional widget matching strategy using position, context, code binding, and text similarity.

## Overview

`MultiDimensionalHealingStrategy` scores candidate widgets against an original snapshot across four dimensions: position (Euclidean distance), context (Jaccard similarity of adjacent text), code binding (callback name similarity), and text (Levenshtein distance). Each dimension is weighted and combined into a single confidence score.

## Constructor

```typescript
constructor(weights?: Partial<StrategyWeights>)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `weights.position` | `number` | Position weight (default: 0.20) |
| `weights.context` | `number` | Context weight (default: 0.30) |
| `weights.codeBinding` | `number` | Code binding weight (default: 0.15) |
| `weights.text` | `number` | Text weight (default: 0.35) |

Weights must sum to 1.0 (within 0.001 tolerance).

## Public Methods

### `score(original: WidgetSnapshot, candidate: WidgetSnapshot): number`

Returns the weighted score between 0 and 1.

### `scoreDimensions(original: WidgetSnapshot, candidate: WidgetSnapshot): { position, context, codeBinding, text, weighted }`

Returns per-dimension scores.

### `heal(original: WidgetSnapshot, candidates: WidgetSnapshot[], threshold?: number): HealingResult | null`

Finds the best candidate exceeding the threshold (default: 0.85). Returns `null` if no match.

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `strategyName` | `string` | `'multidimensional'` |

## Exported Functions

### `ngramSimilarity(textA: string, textB: string, n?: number): number`

Computes n-gram cosine similarity between two strings.

### `buildNgramFreq(text: string, n: number): Map<string, number>`

Builds n-gram frequency map.

### `cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number`

Computes cosine similarity between frequency maps.

## StrategyWeights

| Field | Type | Default |
|-------|------|---------|
| `position` | `number` | 0.20 |
| `context` | `number` | 0.30 |
| `codeBinding` | `number` | 0.15 |
| `text` | `number` | 0.35 |

## Constants

| Name | Value |
|------|-------|
| `DEFAULT_THRESHOLD` | `0.85` |

## Related

- **Implements:** `HealingStrategy`
- **Used by:** [SelfHealingEngine](./SelfHealingEngine.md)
- **Source:** `src/strategies/MultiDimensionalHealingStrategy.ts`
