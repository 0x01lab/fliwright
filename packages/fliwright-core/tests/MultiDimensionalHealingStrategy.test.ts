import { describe, it, expect } from 'vitest';
import {
  MultiDimensionalHealingStrategy,
  ngramSimilarity,
} from '../src/strategies/MultiDimensionalHealingStrategy.js';
import type { WidgetSnapshot } from '../src/types.js';

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

  it('scores higher for same position and type vs different', () => {
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

  it('heal returns null when no candidates', () => {
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
    expect(score).toBe(1.0);
  });

  it('strategyName is multidimensional', () => {
    const strategy = new MultiDimensionalHealingStrategy();
    expect(strategy.strategyName).toBe('multidimensional');
  });
});
