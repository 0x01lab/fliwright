import { describe, it, expect } from 'vitest';
import { formatPretty, formatJson, formatJunit } from '../src/reporter.js';
import type { CliRunResult } from '../src/reporter.js';

const sampleResult: CliRunResult = {
  passed: false,
  totalTests: 3,
  passedTests: 2,
  failedTests: 1,
  duration: 1200,
  results: [
    { name: 'login form visible', passed: true, duration: 100 },
    { name: 'login validates creds', passed: true, duration: 250 },
    { name: 'cart updates quantity', passed: false, duration: 850, error: 'AssertionError: toBeVisible failed for "text=Qty: 2": expected visible, got visible=false' },
  ],
};

describe('formatJson', () => {
  it('returns valid JSON string matching the result object', () => {
    const output = formatJson(sampleResult);
    const parsed = JSON.parse(output);
    expect(parsed.passed).toBe(false);
    expect(parsed.totalTests).toBe(3);
    expect(parsed.results).toHaveLength(3);
  });
});

describe('formatJunit', () => {
  it('produces valid XML with testsuite and testcase elements', () => {
    const xml = formatJunit(sampleResult);
    expect(xml).toContain('<testsuite');
    expect(xml).toContain('tests="3"');
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('<testcase name="login form visible"');
    expect(xml).toContain('<testcase name="cart updates quantity"');
    expect(xml).toContain('<failure');
  });

  it('omits failure element for passing tests', () => {
    const passing: CliRunResult = {
      passed: true, totalTests: 1, passedTests: 1, failedTests: 0, duration: 10,
      results: [{ name: 'ok', passed: true, duration: 10 }],
    };
    const xml = formatJunit(passing);
    expect(xml).not.toContain('<failure');
  });
});

describe('formatPretty', () => {
  it('includes each test name with pass/fail indicator', () => {
    const output = formatPretty(sampleResult);
    expect(output).toContain('login form visible');
    expect(output).toContain('cart updates quantity');
  });

  it('includes summary line with total counts', () => {
    const output = formatPretty(sampleResult);
    expect(output).toContain('2 passed');
    expect(output).toContain('1 failed');
  });
});
