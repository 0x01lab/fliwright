import type { HealingStrategy } from '../interfaces/HealingStrategy.js';
import type { WidgetSnapshot, HealingResult } from '../types.js';

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

function positionScore(a: WidgetSnapshot, b: WidgetSnapshot): number {
  const ca = center(a.rect);
  const cb = center(b.rect);
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
    const textMatch = candidate.description?.match(/'([^']+)'/);
    if (textMatch?.[1]) return `text=${textMatch[1]}`;
    return `byType=${candidate.type}`;
  }
}
