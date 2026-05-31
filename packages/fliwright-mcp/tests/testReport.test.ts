import { describe, it, expect, beforeEach } from 'vitest';
import { handleReadTestReport, registerTestReportResource } from '../src/resources/testReport.js';
import { createServerState } from '../src/state.js';

describe('handleReadTestReport', () => {
  let state: ReturnType<typeof createServerState>;

  beforeEach(() => {
    state = createServerState();
  });

  it('returns "no run" message when no test has run', () => {
    const report = handleReadTestReport(state);
    const parsed = JSON.parse(report);
    expect(parsed.message).toBe('No test run yet');
  });

  it('returns stored run result as JSON', () => {
    state.setLastRunResult({
      passed: true,
      totalTests: 2,
      passedTests: 2,
      failedTests: 0,
      duration: 1500,
      results: [
        { name: 'test1', passed: true, duration: 500 },
        { name: 'test2', passed: true, duration: 1000 },
      ],
    });
    const report = handleReadTestReport(state);
    const parsed = JSON.parse(report);
    expect(parsed.passed).toBe(true);
    expect(parsed.totalTests).toBe(2);
    expect(parsed.results).toHaveLength(2);
  });

  it('returns failed result with error details', () => {
    state.setLastRunResult({
      passed: false,
      totalTests: 1,
      passedTests: 0,
      failedTests: 1,
      duration: 3000,
      results: [
        { name: 'failing test', passed: false, duration: 3000, error: 'Expected visible, got not found' },
      ],
    });
    const report = handleReadTestReport(state);
    const parsed = JSON.parse(report);
    expect(parsed.passed).toBe(false);
    expect(parsed.results[0].error).toBe('Expected visible, got not found');
  });
});

describe('registerTestReportResource', () => {
  it('registers the planned test_report resource name and URI', () => {
    const calls: unknown[][] = [];
    const server = {
      resource: (...args: unknown[]) => {
        calls.push(args);
      },
    };

    registerTestReportResource(server as never, createServerState());

    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('test_report');
    expect(calls[0][1]).toBe('fliwright://test-report/latest');
  });
});
