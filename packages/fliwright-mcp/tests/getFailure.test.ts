import { describe, it, expect, beforeEach } from 'vitest';
import { handleGetFailure } from '../src/tools/getFailure.js';
import { createServerState } from '../src/state.js';
import type { FailureEntry } from '../src/types.js';

describe('handleGetFailure', () => {
  let state: ReturnType<typeof createServerState>;

  beforeEach(() => {
    state = createServerState();
  });

  it('returns empty failures when no run has occurred', () => {
    const result = handleGetFailure({}, state);
    expect(result.failures).toEqual([]);
  });

  it('returns all stored failures', () => {
    const failures: FailureEntry[] = [
      {
        testName: 'login',
        assertion: { matcher: 'toBeVisible', expected: 'visible', actual: 'not found', timeout: 5000 },
        widgetTree: { widgets: [] },
        source: { file: 'tests/auth.test.ts', line: 10, snippet: 'expect(locator).toBeVisible()' },
        timestamp: '2026-05-31T10:00:00Z',
      },
      {
        testName: 'logout',
        assertion: { matcher: 'hasText', expected: 'logged out', actual: '', timeout: 5000 },
        widgetTree: { widgets: [] },
        source: { file: 'tests/auth.test.ts', line: 20, snippet: 'expect(locator).hasText("logged out")' },
        healingSuggestion: {
          originalSelector: 'text=Logout',
          suggestedSelector: 'text=Sign Out',
          confidence: 0.92,
          scores: { position: 0.95, context: 0.88, codeBinding: 0, text: 0.93, weighted: 0.92 },
        },
        timestamp: '2026-05-31T10:00:01Z',
      },
    ];
    state.setLastFailures(failures);
    const result = handleGetFailure({}, state);
    expect(result.failures).toHaveLength(2);
  });

  it('filters failures by testName', () => {
    state.setLastFailures([
      { testName: 'login', assertion: { matcher: 'm', expected: 'e', actual: 'a', timeout: 5000 }, widgetTree: {}, source: { file: 'f', line: 1, snippet: '' }, timestamp: '' },
      { testName: 'logout', assertion: { matcher: 'm', expected: 'e', actual: 'a', timeout: 5000 }, widgetTree: {}, source: { file: 'f', line: 2, snippet: '' }, timestamp: '' },
    ]);
    const result = handleGetFailure({ testName: 'login' }, state);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].testName).toBe('login');
  });

  it('includes healing suggestion when present', () => {
    state.setLastFailures([
      {
        testName: 'test',
        assertion: { matcher: 'toBeVisible', expected: 'visible', actual: 'not found', timeout: 5000 },
        widgetTree: {},
        source: { file: 'f.ts', line: 1, snippet: '' },
        healingSuggestion: {
          originalSelector: 'text=Old',
          suggestedSelector: 'text=New',
          confidence: 0.88,
          scores: { position: 0.9, context: 0.8, codeBinding: 0, text: 0.85, weighted: 0.88 },
        },
        timestamp: '',
      },
    ]);
    const result = handleGetFailure({}, state);
    expect(result.failures[0].healingSuggestion).toBeDefined();
    expect(result.failures[0].healingSuggestion!.suggestedSelector).toBe('text=New');
  });
});