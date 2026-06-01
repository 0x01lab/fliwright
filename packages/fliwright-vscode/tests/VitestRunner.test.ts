import { describe, expect, it } from 'vitest';
import { parseVitestJson } from '../src/runner/VitestRunner.js';

describe('VitestRunner', () => {
  it('parses vitest json reporter output', () => {
    const result = parseVitestJson(JSON.stringify({
      numTotalTests: 2,
      numPassedTests: 1,
      numFailedTests: 1,
      testResults: [
        {
          name: 'sample.test.ts',
          assertionResults: [
            { ancestorTitles: ['suite'], title: 'passes', status: 'passed', duration: 3 },
            { ancestorTitles: ['suite'], title: 'fails', status: 'failed', duration: 4, failureMessages: ['boom'] },
          ],
        },
      ],
    }), '', 1);

    expect(result.passed).toBe(false);
    expect(result.totalTests).toBe(2);
    expect(result.failedTests).toBe(1);
    expect(result.results[1]).toMatchObject({ name: 'suite > fails', error: 'boom' });
  });
});
