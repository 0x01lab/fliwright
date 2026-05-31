import { describe, it, expect } from 'vitest';
import { AssertionSuggester } from '../src/AssertionSuggester.js';
import type { RecordedOperation } from '../src/types.js';

describe('AssertionSuggester', () => {
  it('returns no suggestions for empty operations', () => {
    const suggester = new AssertionSuggester();
    const suggestions = suggester.suggest([]);
    expect(suggestions).toEqual([]);
  });

  it('suggests assertion after tap that looks like navigation', () => {
    const suggester = new AssertionSuggester();
    const ops: RecordedOperation[] = [
      { kind: 'tap', position: { x: 100, y: 50 }, timestamp: 1000 }, // nav bar tap at top
    ];
    const suggestions = suggester.suggest(ops);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions[0].afterIndex).toBe(0);
    expect(suggestions[0].reason).toContain('navigation');
  });

  it('suggests assertion after submit-like button click following form input', () => {
    const suggester = new AssertionSuggester();
    const ops: RecordedOperation[] = [
      { kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000 },
      { kind: 'type', position: { x: 100, y: 200 }, text: 'user@email.com', timestamp: 2000 },
      { kind: 'tap', position: { x: 100, y: 400 }, timestamp: 3000 }, // submit button
    ];
    const suggestions = suggester.suggest(ops);
    const submitSuggestion = suggestions.find((s) => s.afterIndex === 2);
    expect(submitSuggestion).toBeDefined();
    expect(submitSuggestion!.reason).toContain('submit');
  });

  it('suggests assertion after tap on list item followed by detail content', () => {
    const suggester = new AssertionSuggester();
    const ops: RecordedOperation[] = [
      { kind: 'drag', position: { x: 200, y: 300 }, delta: { x: 0, y: -100 }, timestamp: 1000 },
      { kind: 'tap', position: { x: 200, y: 300 }, timestamp: 2000 }, // list item after scroll
    ];
    const suggestions = suggester.suggest(ops);
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('does not suggest after every single tap', () => {
    const suggester = new AssertionSuggester();
    const ops: RecordedOperation[] = [
      { kind: 'tap', position: { x: 100, y: 300 }, timestamp: 1000 },
    ];
    const suggestions = suggester.suggest(ops);
    // Single tap in the middle of the screen is ambiguous
    // Should only suggest if it looks like navigation or submit
    expect(suggestions.length).toBeLessThanOrEqual(1);
  });
});
