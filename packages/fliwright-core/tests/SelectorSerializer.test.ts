import { describe, it, expect } from 'vitest';
import { serializeSelectorQuery } from '../src/SelectorSerializer.js';
import type { SelectorQuery } from '../src/types.js';

describe('serializeSelectorQuery', () => {
  it('emits shorthand for a single text criterion', () => {
    expect(serializeSelectorQuery({ match: { text: 'Login' } })).toBe("{ text: 'Login' }");
  });

  it('emits shorthand for a single key criterion', () => {
    expect(serializeSelectorQuery({ match: { key: 'submit' } })).toBe("{ key: 'submit' }");
  });

  it('emits shorthand for a single type criterion', () => {
    expect(serializeSelectorQuery({ match: { type: 'GestureDetector' } })).toBe("{ type: 'GestureDetector' }");
  });

  it('escapes quotes and backslashes in values', () => {
    expect(serializeSelectorQuery({ match: { text: "user's \\path" } })).toBe(
      "{ text: 'user\\'s \\\\path' }",
    );
  });

  it('uses the full query form for role (no valid shorthand)', () => {
    expect(serializeSelectorQuery({ match: { role: 'button' } })).toBe("{ match: { role: 'button' } }");
  });

  it('serializes within as a nested query', () => {
    const q: SelectorQuery = { match: { type: 'GestureDetector' }, within: { match: { key: 'list' } } };
    expect(serializeSelectorQuery(q)).toBe("{ match: { type: 'GestureDetector' }, within: { key: 'list' } }");
  });

  it('serializes containing as a nested query', () => {
    const q: SelectorQuery = { match: { type: 'GestureDetector' }, containing: { match: { text: 'Login' } } };
    expect(serializeSelectorQuery(q)).toBe(
      "{ match: { type: 'GestureDetector' }, containing: { text: 'Login' } }",
    );
  });

  it('serializes nth position', () => {
    const q: SelectorQuery = { match: { type: 'GestureDetector' }, position: { nth: 2 } };
    expect(serializeSelectorQuery(q)).toBe("{ match: { type: 'GestureDetector' }, position: { nth: 2 } }");
  });

  it('serializes last position', () => {
    const q: SelectorQuery = { match: { type: 'GestureDetector' }, position: { last: true } };
    expect(serializeSelectorQuery(q)).toBe("{ match: { type: 'GestureDetector' }, position: { last: true } }");
  });
});
