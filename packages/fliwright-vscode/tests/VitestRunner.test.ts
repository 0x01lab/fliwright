import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { parseVitestJson, buildVitestArgs, buildRunEnv, resolveVitestCli } from '../src/runner/VitestRunner.js';
import type { RunParams } from '../src/runner/TestRunner.js';

describe('VitestRunner', () => {
  it('parses vitest json reporter output', () => {
    const result = parseVitestJson(JSON.stringify({
      numTotalTests: 2,
      numPassedTests: 1,
      numFailedTests: 1,
      testResults: [
        {
          name: '/repo/tests/sample.test.ts',
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
    expect(result.results[0]).toMatchObject({ name: 'suite > passes', filePath: '/repo/tests/sample.test.ts' });
    expect(result.results[1]).toMatchObject({ name: 'suite > fails', filePath: '/repo/tests/sample.test.ts', error: 'boom' });
  });

  it('reports a stopped run when the Vitest process exits from cancellation', () => {
    const result = parseVitestJson('', 'Fliwright test run stopped by user.', 130);

    expect(result.passed).toBe(false);
    expect(result.failedTests).toBe(1);
    expect(result.results[0]).toMatchObject({
      name: 'Vitest run',
      passed: false,
      error: 'Fliwright test run stopped by user.',
    });
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
      'run',
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
      'run',
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

  it('sets FLIWRIGHT_RUN_ID when runId is provided', () => {
    const env = buildRunEnv({
      ...baseParams,
      runId: '2026-06-22T10-00-00',
    });

    expect(env.FLIWRIGHT_RUN_ID).toBe('2026-06-22T10-00-00');
  });

  it('sets E2E automation environment variables when enabled', () => {
    const env = buildRunEnv({
      ...baseParams,
      e2eAutomationEnabled: true,
    });

    expect(env.FLIWRIGHT_E2E_AUTOMATION).toBe('true');
    expect(env.EXIO_AUTOMATION).toBe('true');
    expect(env.EXIO_DISABLE_ALIYUN_CAPTCHA).toBe('true');
  });

  it('uses run-integrated trace layout when trace is enabled', () => {
    const env = buildRunEnv({
      ...baseParams,
      traceMode: 'full',
      traceDir: { fsPath: '/home/.fliwright/projects/app/runs', scheme: 'file' } as any,
    });

    expect(env.FLIWRIGHT_TRACE).toBe('full');
    expect(env.FLIWRIGHT_TRACE_DIR).toBe('/home/.fliwright/projects/app/runs');
    expect(env.FLIWRIGHT_TRACE_LAYOUT).toBe('run');
  });

  it('does not set FLIWRIGHT_RUNS_ROOT when runsRoot is unset', () => {
    const env = buildRunEnv({ ...baseParams });
    expect(env.FLIWRIGHT_RUNS_ROOT).toBeUndefined();
  });
});

describe('resolveVitestCli', () => {
  it('resolves the workspace-installed vitest cli', () => {
    const cli = resolveVitestCli(path.resolve(__dirname, '..', '..', '..'));

    expect(cli).toMatch(/vitest[\\/]vitest\.mjs$/);
  });
});
