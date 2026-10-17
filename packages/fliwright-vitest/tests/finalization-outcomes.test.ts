import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const cli = resolve(directory, '../../../node_modules/vitest/vitest.mjs');
const runner = resolve(directory, '../src/runner.ts');
const integration = resolve(directory, '../src/index.ts');
const recoveryReporter = resolve(directory, '../src/RecoveryReporter.ts');

describe('real fixture finalization deadlines', () => {
  it('bounds hung cleanup and diagnosis while preserving runner errors and saved evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-finalization-'));
    const runs = join(root, 'runs');
    let retainEvidence = false;
    try {
      await mkdir(join(root, '.fliwright/tests'), { recursive: true });
      await writeFile(join(root, 'vitest.config.mjs'), `export default { root: ${JSON.stringify(root)}, test: {
        include: ['.fliwright/tests/*.test.mjs'], runner: ${JSON.stringify(runner)},
        maxWorkers: 1, minWorkers: 1, reporters: ['dot', ${JSON.stringify(recoveryReporter)}], hookTimeout: 800, testTimeout: 1000,
      } };`);
      await writeFile(join(root, '.fliwright/tests/deadlines.test.mjs'), `
        import { createFliwrightTest } from ${JSON.stringify(integration)};
        import { mkdir } from 'node:fs/promises';
        import { join } from 'node:path';
        import { afterEach, expect } from 'vitest';
        const config = { vmServiceUrl: 'ws://unused', runsRoot: ${JSON.stringify(runs)}, requireAssertions: false,
          recording: { mode: 'standard', failureCaptureBudgetMs: 60, testFinalizationBudgetMs: 150 },
          log: { format: 'silent' },
        };
        const driver = (dispose) => ({
          sendRequest: async (method) => {
            if (method === 'ext.fliwright.screenshot') return { success: true, screenshot: Buffer.from('last-saved-page').toString('base64') };
            if (method === 'ext.fliwright.snap') return { snapshot: { ready: true }, refs: [], raw: 'ready' };
            if (method === 'ext.fliwright.captureFrame') return { diagnostics: { ready: true } };
            return { success: true };
          },
          page: {}, getDiagnostics: () => [], healing: { getReports: () => [] }, mock: {}, dispose,
        });
        const cleanup = createFliwrightTest(config, { driverProvider: async () => driver(() => new Promise(() => {})) });
        cleanup('body failure with hung cleanup', async ({ page }) => { throw new Error('original business error'); });
        cleanup('passing body with hung cleanup', async ({ page }) => { expect(true).toBe(true); });
        const diagnosis = createFliwrightTest({ ...config, agentPolicy: { passive: true },
          ai: { adapter: { name: 'hung', invoke: () => new Promise(() => {}) }, timeoutMs: 10000 },
        }, { driverProvider: async () => driver(async () => {}) });
        diagnosis('body failure with hung diagnosis', async ({ page }) => { throw new Error('original diagnosis error'); });
        const slowDriver = driver(async () => {});
        const originalRequest = slowDriver.sendRequest;
        slowDriver.sendRequest = async (method) => slowDriver.failed && method === 'ext.fliwright.screenshot'
          ? new Promise(() => {}) : originalRequest(method);
        const evidence = createFliwrightTest({ ...config,
          recording: { ...config.recording, failureCaptureBudgetMs: 3000 },
        }, { driverProvider: async () => slowDriver });
        evidence('body failure with long evidence budget', async ({ page }) => {
          slowDriver.failed = true;
          throw new Error('original evidence error');
        });
        const normal = createFliwrightTest(config, { driverProvider: async () => driver(async () => {}) });
        normal('body failure with hung flush', async ({ page, timeline }) => {
          timeline.recorder.flushProgress = () => new Promise(() => {});
          throw new Error('original flush error');
        });
        normal('body failure with broken projection', async ({ page, timeline }) => {
          await mkdir(join(timeline.artifactStore.runDir, 'failures.json'));
          throw new Error('original projection error');
        });
        let tries = 0;
        normal('retry body outlives prior finalization deadline', { retry: 1 }, async ({ page }) => {
          if (++tries === 1) throw new Error('first retry error');
          await new Promise((resolve) => setTimeout(resolve, 250));
          expect(true).toBe(true);
        });
        afterEach(async ({ task }) => {
          if (task.name === 'project hook has its own timeout') await new Promise((resolve) => setTimeout(resolve, 250));
        });
        normal('project hook has its own timeout', async ({ page }) => { expect(true).toBe(true); });
      `);
      const child = spawn(process.execPath, [cli, 'run', '--config', join(root, 'vitest.config.mjs')], {
        cwd: root, env: { ...process.env, FLIWRIGHT_RUN_ID: 'run-deadlines', FLIWRIGHT_RUNS_ROOT: runs },
        stdio: ['ignore', 'pipe', 'pipe'], timeout: 6000,
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const code = await new Promise<number | null>((resolveCode, reject) => {
        child.once('error', reject); child.once('close', resolveCode);
      });
      await writeFile(join(root, 'vitest-output.log'), output);
      expect(code, output).toBe(1);
      const attempts = await Promise.all((await readdir(join(runs, 'run-deadlines', 'tests'))).map(async (id) => {
        return Promise.all((await readdir(join(runs, 'run-deadlines', 'tests', id, 'attempts'))).map(async (attemptId) => {
          const dir = join(runs, 'run-deadlines', 'tests', id, 'attempts', attemptId);
          return { dir, result: JSON.parse(await readFile(join(dir, 'result.json'), 'utf8')),
            timeline: JSON.parse(await readFile(join(dir, 'timeline.json'), 'utf8')),
            trace: JSON.parse(await readFile(join(dir, 'trace/trace.json'), 'utf8')) };
        }));
      })).then((groups) => groups.flat());
      expect(attempts).toHaveLength(9);
      const failed = attempts.filter(({ result }) => result.testOutcome === 'failed');
      expect(failed).toHaveLength(6);
      for (const attempt of failed) {
        expect(attempt.result).toMatchObject({ finalized: true, testOutcome: 'failed', evidenceStatus: 'partial' });
        expect(attempt.result.evidenceIssues).toEqual(expect.arrayContaining([
          expect.stringMatching(attempt.result.testName.includes('broken projection') ? /EISDIR/ : /finalization budget/),
        ]));
        expect(attempt.timeline.status).toBe('failed');
        expect(attempt.trace.meta.status).toBe('failed');
        const firstFailure = attempt.timeline.nodes.find((node: { kind: string }) => node.kind === 'failure');
        expect(Date.parse(attempt.timeline.endedAt) - Date.parse(firstFailure.startedAt)).toBeLessThan(600);
        const last = attempt.result.evidence.find((entry: { result: { artifactPaths?: string[] } }) => entry.result.artifactPaths?.length);
        expect(last).toBeDefined();
        await expect(readFile(join(attempt.dir, last.result.artifactPaths[0]), 'utf8')).resolves.toBe('last-saved-page');
      }
      for (const message of ['original business error', 'original diagnosis error', 'original evidence error',
        'original flush error', 'original projection error']) {
        const attempt = attempts.find(({ result }) => result.runnerErrors.some((error: { message: string }) => error.message === message));
        expect(attempt, message).toBeDefined();
        expect(attempt!.result.runnerErrors).toHaveLength(1);
      }
      const retried = attempts.filter(({ result }) => result.testName === 'retry body outlives prior finalization deadline');
      expect(retried).toHaveLength(2);
      expect(retried.map(({ result }) => result.attemptOutcome).sort()).toEqual(['failed', 'passed']);
      for (const attempt of retried) {
        expect(attempt.result).toMatchObject({ finalized: true, testOutcome: 'passed', flaky: true, evidenceStatus: 'complete' });
        expect(attempt.timeline.status).toBe('passed');
        expect(attempt.trace.meta.status).toBe('passed');
      }
      const projectHook = attempts.find(({ result }) => result.testName === 'project hook has its own timeout')!;
      expect(projectHook.result).toMatchObject({ finalized: true, testOutcome: 'passed', evidenceStatus: 'complete' });
      expect(projectHook.timeline.status).toBe('passed');
      expect(output).not.toContain('Hook timed out');
    } catch (error) {
      retainEvidence = true;
      throw new Error(`Finalization evidence retained at ${root}`, { cause: error });
    } finally { if (!retainEvidence) await rm(root, { recursive: true, force: true }); }
  }, 15_000);
});
