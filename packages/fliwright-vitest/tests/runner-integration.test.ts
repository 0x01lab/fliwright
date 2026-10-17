import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const directory = dirname(fileURLToPath(import.meta.url));
const runnerPath = resolve(directory, '../src/runner.ts');
const vitestCliPath = resolve(directory, '../../../node_modules/vitest/vitest.mjs');

describe('FliwrightRunner integration', () => {
  it('discovers shared test/script paths and delivers full preset settings in a direct Vitest process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-direct-preset-config-'));
    const runsRoot = join(root, 'runs');
    try {
      await mkdir(join(root, 'checks'));
      await mkdir(join(root, 'tasks'));
      await writeFile(join(root, 'vitest.config.mjs'), `
        import { fliwrightPreset } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest/preset'))};
        export default { root: ${JSON.stringify(root)}, ...fliwrightPreset({
          paths: { tests: 'checks', scripts: 'tasks' },
          recording: { mode: 'off', requireAssertions: false, testFinalScreenshots: false,
            failureCaptureBudgetMs: 1234, testFinalizationBudgetMs: 4567 },
          test: { maxWorkers: 1, reporters: ['dot'] },
        }) };
      `);
      for (const [file, fixture] of [['checks/config.test.ts', 'test'], ['tasks/config.script.ts', 'script']]) {
        await writeFile(join(root, file), `
          import { ${fixture} } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest'))};
          import { strict as assert } from 'node:assert';
          ${fixture}('${fixture} receives project settings', async ({ timeline }) => {
            const config = JSON.parse(process.env.FLIWRIGHT_CONFIG);
            assert.equal(config.recording.mode, 'off');
            assert.equal(config.recording.requireAssertions, false);
            assert.equal(config.recording.testFinalScreenshots, false);
            assert.equal(config.recording.failureCaptureBudgetMs, 1234);
            assert.equal(config.recording.testFinalizationBudgetMs, 4567);
          });
        `);
      }
      const output = join(root, 'sessions.jsonl');
      expect((await run(root, output, runsRoot)).code).toBe(0);
      const results = (await readFile(output, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      expect(results).toHaveLength(2);
      expect(results.every((result) => result.testOutcome === 'passed' && result.evidenceStatus === 'disabled')).toBe(true);
      expect(results.map((result) => result.testFile).sort()).toEqual(['checks/config.test.ts', 'tasks/config.script.ts']);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it('creates a RunSession for real Vitest task results, including failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-runner-integration-'));
    const outputPath = join(root, 'sessions.jsonl');
    const runsRoot = join(root, 'runs');
    await writeFile(join(root, 'vitest.config.mjs'), `
      export default {
        root: ${JSON.stringify(root)},
        test: {
          include: ['integration.test.mjs'],
          runner: ${JSON.stringify(runnerPath)},
          reporters: ['dot'],
          maxWorkers: 1,
          minWorkers: 1,
        },
      };
    `);
    await writeFile(join(root, 'integration.test.mjs'), `
      import { afterEach, beforeEach, expect, test } from 'vitest';
      beforeEach(() => {});
      afterEach(() => {});
      test('session passes', () => expect(1).toBe(1));
      test('session fails', () => expect(1).toBe(2));
    `);
    try {
      const result = await run(root, outputPath, runsRoot);
      expect(result.code).toBe(1);
      const sessions = (await readFile(outputPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      expect(sessions).toHaveLength(2);
      expect(sessions).toEqual(expect.arrayContaining([
        expect.objectContaining({ testName: 'session passes', status: 'passed', operations: [] }),
        expect.objectContaining({ testName: 'session fails', status: 'failed' }),
      ]));
      const attemptFiles = await import('node:fs/promises').then(({ readdir }) => readdir(join(runsRoot, 'run-test')));
      expect(attemptFiles).toContain('tests');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('persists one result per attempt and keeps skipped/expected outcomes distinct', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-runner-attempts-'));
    const outputPath = join(root, 'sessions.jsonl');
    const runsRoot = join(root, 'runs');
    const markerPath = join(root, 'retry-marker');
    await writeFile(join(root, 'vitest.config.mjs'), `
      export default {
        root: ${JSON.stringify(root)},
        test: {
          include: ['attempts.test.mjs'],
          runner: ${JSON.stringify(runnerPath)},
          reporters: ['dot'],
          maxWorkers: 1,
          minWorkers: 1,
          retry: 0,
        },
      };
    `);
    await writeFile(join(root, 'attempts.test.mjs'), `
      import { existsSync, writeFileSync } from 'node:fs';
      import { expect, test } from 'vitest';
      test('retries once', { retry: 1 }, () => {
        if (!existsSync(${JSON.stringify(markerPath)})) {
          writeFileSync(${JSON.stringify(markerPath)}, 'seen');
          throw new Error('first attempt');
        }
        expect(true).toBe(true);
      });
      test.fails('expected failure', () => { throw new Error('expected'); });
      test.skip('skipped test', () => { throw new Error('must not run'); });
      test('same title', () => expect(1).toBe(1));
      test('same title', () => expect(1).toBe(1));
    `);

    try {
      const result = await run(root, outputPath, runsRoot);
      expect(result.code).toBe(0);
      const sessions = (await readFile(outputPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      expect(sessions.filter((entry) => entry.testName === 'retries once')).toHaveLength(2);
      expect(sessions.filter((entry) => entry.testName === 'retries once').map((entry) => entry.status)).toEqual(['failed', 'passed']);
      expect(sessions.find((entry) => entry.testName === 'expected failure')).toMatchObject({ status: 'failed', attemptIndex: 0 });
      expect(sessions.find((entry) => entry.testName === 'skipped test')).toMatchObject({ status: 'skipped', attemptIndex: 0 });

      const testDirectories = await import('node:fs/promises').then(({ readdir }) =>
        readdir(join(runsRoot, 'run-test', 'tests')));
      expect(testDirectories.length).toBe(5);
      let retryResult = '';
      for (const testDirectory of testDirectories) {
        try {
          retryResult = await readFile(
            join(runsRoot, 'run-test', 'tests', testDirectory, 'attempts', 'attempt-1', 'result.json'),
            'utf8',
          );
          break;
        } catch {
          // Only the retried test has an attempt-1 directory.
        }
      }
      expect(retryResult).not.toBe('');
      expect(JSON.parse(retryResult)).toMatchObject({ status: 'passed', attemptIndex: 1 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('seeds a running attempt before a worker crash so the parent can repair it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-runner-crash-marker-'));
    const runsRoot = join(root, 'runs');
    await writeFile(join(root, 'vitest.config.mjs'), `
      export default {
        root: ${JSON.stringify(root)},
        test: {
          include: ['crash.test.mjs'],
          runner: ${JSON.stringify(runnerPath)},
          reporters: ['dot'],
          maxWorkers: 1,
          minWorkers: 1,
        },
      };
    `);
    await writeFile(join(root, 'crash.test.mjs'), `
      import { test } from 'vitest';
      test('worker disappears', () => process.kill(process.pid, 'SIGKILL'));
    `);
    try {
      const result = await run(root, join(root, 'sessions.jsonl'), runsRoot);
      expect(result.code).not.toBe(0);
      const testsRoot = join(runsRoot, 'run-test', 'tests');
      const testDirectories = await import('node:fs/promises').then(({ readdir }) => readdir(testsRoot));
      expect(testDirectories).toHaveLength(1);
      const attemptDirectories = await import('node:fs/promises').then(({ readdir }) =>
        readdir(join(testsRoot, testDirectories[0], 'attempts')));
      expect(attemptDirectories).toEqual(['attempt-0']);
      const marker = JSON.parse(await readFile(
        join(testsRoot, testDirectories[0], 'attempts', 'attempt-0', 'result.json'),
        'utf8',
      ));
      expect(marker).toMatchObject({ status: 'running', attemptOutcome: 'running', testOutcome: 'running' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

function run(root: string, outputPath: string, runsRoot: string): Promise<{ code: number | null }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [vitestCliPath, 'run', '--config', join(root, 'vitest.config.mjs')], {
      cwd: root,
      env: {
        ...process.env,
        FLIWRIGHT_SESSION_RESULTS_PATH: outputPath,
        FLIWRIGHT_RUNS_ROOT: runsRoot,
        FLIWRIGHT_RUN_ID: 'run-test',
      },
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('close', (code) => resolveResult({ code }));
  });
}
