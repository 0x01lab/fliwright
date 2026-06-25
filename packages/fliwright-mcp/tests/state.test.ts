import { describe, it, expect, beforeEach } from 'vitest';
import { createServerState } from '../src/state.js';

describe('createServerState', () => {
  let state: ReturnType<typeof createServerState>;

  beforeEach(() => {
    state = createServerState();
  });

  it('initializes with null lastRunResult', () => {
    expect(state.getLastRunResult()).toBeNull();
  });

  it('initializes with empty failure entries', () => {
    expect(state.getLastFailures()).toEqual([]);
  });

  it('initializes with null vmServiceUrl', () => {
    expect(state.getVmServiceUrl()).toBeNull();
  });

  it('stores and retrieves run result', () => {
    const result = {
      passed: true,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      duration: 100,
      results: [{ name: 'test', passed: true, duration: 100 }],
    };
    state.setLastRunResult(result);
    expect(state.getLastRunResult()).toEqual(result);
  });

  it('stores and retrieves failure entries', () => {
    const failure = {
      testName: 'test',
      assertion: { matcher: 'toBeVisible', expected: 'visible', actual: 'not found', timeout: 5000 },
      widgetTree: {},
      source: { file: 'test.ts', line: 1, snippet: 'snippet' },
      timestamp: '2026-05-31T00:00:00Z',
    };
    state.setLastFailures([failure]);
    expect(state.getLastFailures()).toHaveLength(1);
    expect(state.getLastFailures()[0].testName).toBe('test');
  });

  it('stores and retrieves vmServiceUrl', () => {
    state.setVmServiceUrl('ws://localhost:1234/ws');
    expect(state.getVmServiceUrl()).toBe('ws://localhost:1234/ws');
  });

  it('filters failures by testName', () => {
    const failures = [
      { testName: 'login', assertion: { matcher: 'toBeVisible', expected: 'visible', actual: 'not found', timeout: 5000 }, widgetTree: {}, source: { file: 'a.ts', line: 1, snippet: '' }, timestamp: '' },
      { testName: 'logout', assertion: { matcher: 'hasText', expected: 'text', actual: '', timeout: 5000 }, widgetTree: {}, source: { file: 'b.ts', line: 2, snippet: '' }, timestamp: '' },
    ];
    state.setLastFailures(failures);
    expect(state.getFailuresByTestName('login')).toHaveLength(1);
    expect(state.getFailuresByTestName('login')[0].testName).toBe('login');
  });

  it('returns all failures when no testName filter', () => {
    state.setLastFailures([
      { testName: 'a', assertion: { matcher: 'm', expected: 'e', actual: 'a', timeout: 5000 }, widgetTree: {}, source: { file: 'f', line: 1, snippet: '' }, timestamp: '' },
      { testName: 'b', assertion: { matcher: 'm', expected: 'e', actual: 'a', timeout: 5000 }, widgetTree: {}, source: { file: 'f', line: 2, snippet: '' }, timestamp: '' },
    ]);
    expect(state.getFailuresByTestName()).toHaveLength(2);
  });

  it('stores and retrieves TDD workflow context', () => {
    const context = {
      testName: 'checkout flow',
      flowId: 'checkout',
      selectorDiagnostics: [{ elementId: 'submit', status: 'missing' }],
    };

    state.setTddWorkflowContext(context);

    expect(state.getTddWorkflowContext()).toEqual(context);
  });
});
