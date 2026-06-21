import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { parseVitestJson, buildVitestArgs, buildRunEnv } from '../src/runner/VitestRunner.js';
import type { RunParams } from '../src/runner/TestRunner.js';

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

const baseParams: RunParams = {
  workspaceRoot: { fsPath: '/repo', scheme: 'file' } as any,
  failureContextDir: { fsPath: '/repo/.fliwright/failures', scheme: 'file' } as any,
};

describe('buildVitestArgs', () => {
  it('adds -t "<pattern>" after the relative test file when testNamePattern is set', () => {
    const args = buildVitestArgs({
      ...baseParams,
      testFile: { fsPath: '/repo/tests/a.test.ts', scheme: 'file' } as any,
      testNamePattern: 'case A',
    });

    expect(args).toEqual([
      'vitest', 'run',
      path.relative('/repo', '/repo/tests/a.test.ts'),
      '-t', 'case A',
      '--reporter=json',
    ]);
    expect(args).toContain('-t');
    expect(args[args.indexOf('-t') + 1]).toBe('case A');
  });

  it('does not add -t when testNamePattern is unset', () => {
    const args = buildVitestArgs({
      ...baseParams,
      testFile: { fsPath: '/repo/tests/a.test.ts', scheme: 'file' } as any,
    });

    expect(args).not.toContain('-t');
    expect(args).toEqual([
      'vitest', 'run',
      path.relative('/repo', '/repo/tests/a.test.ts'),
      '--reporter=json',
    ]);
  });
});

describe('buildRunEnv', () => {
  it('sets FLIWRIGHT_RUNS_ROOT when runsRoot is provided', () => {
    const env = buildRunEnv({
      ...baseParams,
      runsRoot: '/home/.fliwright/projects/abc/runs',
    });

    expect(env.FLIWRIGHT_RUNS_ROOT).toBe('/home/.fliwright/projects/abc/runs');
  });

  it('does not set FLIWRIGHT_RUNS_ROOT when runsRoot is unset', () => {
    const env = buildRunEnv({ ...baseParams });
    expect(env.FLIWRIGHT_RUNS_ROOT).toBeUndefined();
  });
});
