import { describe, it, expect } from 'vitest';
import { RecordedSelectorResolver } from '../src/RecordedSelectorResolver.js';
import type { RecordedOperation, SelectorQuery } from '../src/types.js';

const tap = { kind: 'tap' as const, position: { x: 10, y: 20 }, timestamp: 1000 };
function candidate(query: SelectorQuery, stability = 'key', matchCount = 1, matchesTarget = true) {
  return { query, stability, matchCount, matchesTarget };
}
function operation(candidates: unknown[], overrides: Record<string, unknown> = {}): RecordedOperation {
  return { ...tap, recordedTarget: {
    targetId: 'target-1', status: 'resolved', candidates,
    type: 'ElevatedButton', ...overrides,
  } } as RecordedOperation;
}
const key = { match: { key: 'save' } };
const semantics = { match: { semanticIdentifier: 'save-action' } };
const label = { match: { type: 'ElevatedButton' }, containing: { match: { text: 'Save' } } };

describe('RecordedSelectorResolver frozen candidates', () => {
  it('selects the frozen key before semantics or label without querying the live app', async () => {
    const result = await new RecordedSelectorResolver().resolveUniqueSelector(operation([
      candidate(label, 'label'), candidate(semantics, 'semantics'), candidate(key),
    ]));
    expect(result).toMatchObject({ query: key, ambiguous: false, matchCount: 1, stability: 'key' });
  });

  it('uses semantics and role-scoped labels when stronger candidates do not identify the target', async () => {
    const resolver = new RecordedSelectorResolver();
    expect((await resolver.resolveUniqueSelector(operation([
      candidate(key, 'key', 1, false), candidate(semantics, 'semantics'), candidate(label, 'label'),
    ])))?.query).toEqual(semantics);
    expect((await resolver.resolveUniqueSelector(operation([
      candidate(semantics, 'semantics', 0, false), candidate(label, 'label'),
    ])))?.query).toEqual(label);
  });

  it('can use a frozen stable ancestor query', async () => {
    const query = { match: { type: 'TextField' }, within: { match: { key: 'shipping' } } };
    const result = await new RecordedSelectorResolver().resolveUniqueSelector(operation([candidate(query, 'ancestor')]));
    expect(result).toMatchObject({ query, ambiguous: false });
  });

  it('keeps nth as an ambiguous draft even when its frozen count is one', async () => {
    const query = { match: { type: 'TextField' }, position: { nth: 1 } };
    const result = await new RecordedSelectorResolver().resolveUniqueSelector(operation([candidate(query, 'positional')]));
    expect(result).toMatchObject({ query, ambiguous: true });
  });

  it('does not let a mislabeled positional or ephemeral query become durable', async () => {
    for (const query of [
      { ...key, position: { nth: 0 } },
      { ...key, fallback: { textContains: 'Save' } },
      { match: { id: 'temporary-element' } },
      { match: { type: 'Widget' } },
      { match: { text: 'Save' } },
    ]) {
      const result = await new RecordedSelectorResolver().resolveUniqueSelector(operation([candidate(query)]));
      expect(result?.ambiguous ?? true).toBe(true);
    }
  });

  it('preserves ambiguous frozen candidates for review', async () => {
    const result = await new RecordedSelectorResolver().resolveUniqueSelector(operation([candidate(key, 'key', 2)]));
    expect(result).toMatchObject({ query: key, ambiguous: true, matchCount: 2 });
  });

  it('never substitutes the sole match when it is not the original target', async () => {
    expect(await new RecordedSelectorResolver().resolveUniqueSelector(operation([candidate(key, 'key', 1, false)]))).toBeUndefined();
  });

  it('returns unresolved for missing, malformed or budget-exhausted capture', async () => {
    const resolver = new RecordedSelectorResolver();
    for (const op of [tap, operation([]), operation([{ query: { unexpected: true } }]),
      operation([candidate(key)], { status: 'unresolved', issue: 'capture budget exceeded' })]) {
      expect(await resolver.resolveUniqueSelector(op)).toBeUndefined();
    }
  });
});
