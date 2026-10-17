import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const integration = resolve(directory, '../src/index.ts');
const runner = resolve(directory, '../src/runner.ts');
const cli = resolve(directory, '../../../node_modules/vitest/vitest.mjs');

describe('whole-test endpoint lease', () => {
  it.each(['standard', 'off'])('finalizes preparation failure and continues with the next test (%s)', async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-test-lease-preparation-'));
    const endpoint = `ws://preparation-${root.split('/').at(-1)}/ws`;
    try {
      await mkdir(join(root, '.fliwright/tests'), { recursive: true });
      await writeFile(join(root, 'runner.mjs'), `
        import { FliwrightRunner } from ${JSON.stringify(runner)};
        export default class PreparationProbeRunner extends FliwrightRunner {
          async onBeforeRunTask(task) {
            if (task.name === 'preparation fails') {
              const key = Symbol.for('@fliwright/vitest/prepare-task');
              const prepare = task.meta[key];
              task.meta[key] = async (...args) => {
                await prepare(...args);
                throw new Error('original App preparation error');
              };
            }
            await super.onBeforeRunTask(task);
          }
        }
      `);
      await writeFile(join(root, 'vitest.config.mjs'), `export default { root: ${JSON.stringify(root)}, test: {
        include: ['.fliwright/tests/preparation.test.mjs'], runner: './runner.mjs',
        maxWorkers: 1, reporters: ['dot'],
      } };`);
      await writeFile(join(root, '.fliwright/tests/preparation.test.mjs'), `
        import { beforeEach, expect } from 'vitest';
        import { appendFile } from 'node:fs/promises';
        import { createFliwrightTest } from ${JSON.stringify(integration)};
        const test = createFliwrightTest({ vmServiceUrl: ${JSON.stringify(endpoint)},
          recording: { mode: ${JSON.stringify(mode)} }, requireAssertions: false, log: { format: 'silent' },
        });
        beforeEach(async ({ task }) => { await appendFile(${JSON.stringify(join(root, 'setup.jsonl'))}, JSON.stringify(task.name) + '\\n'); });
        test('preparation fails', () => { throw new Error('failed preparation must not execute the body'); });
        test('after preparation failure', () => { expect(true).toBe(true); });
      `);
      const child = spawn(process.execPath, [cli, 'run', '--config', join(root, 'vitest.config.mjs')], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000,
        env: { ...process.env, FLIWRIGHT_RUN_ID: 'run-preparation-failure', FLIWRIGHT_RECORDING_MODE: '', FLIWRIGHT_CONFIG: '',
          FLIWRIGHT_RUNS_ROOT: join(root, 'runs'), FLIWRIGHT_SESSION_RESULTS_PATH: join(root, 'sessions.jsonl') },
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const code = await new Promise((resolveCode, reject) => { child.once('error', reject); child.once('close', resolveCode); });
      expect(code, output).toBe(1);
      expect(output).toContain('1 failed | 1 passed');
      expect((await readFile(join(root, 'setup.jsonl'), 'utf8')).trim()).toBe(JSON.stringify('after preparation failure'));
      const results = (await readFile(join(root, 'sessions.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      expect(results).toHaveLength(2);
      expect(results.find((result) => result.testName === 'after preparation failure')).toMatchObject({
        finalized: true, testOutcome: 'passed',
      });
      const failed = results.find((result) => result.testName === 'preparation fails');
      expect(failed).toMatchObject({ finalized: true, attemptOutcome: 'failed', testOutcome: 'failed',
        evidenceStatus: mode === 'off' ? 'disabled' : 'partial' });
      expect(failed.runnerErrors).toContainEqual(expect.objectContaining({ message: 'original App preparation error' }));
      if (mode !== 'off') {
        const { RunArtifactStore } = await import('@fliwright/core');
        const store = new RunArtifactStore({ runsRoot: join(root, 'runs'), runId: 'run-preparation-failure' });
        const attempt = store.attemptDir(failed.testId, failed.attemptId);
        expect(JSON.parse(await readFile(join(attempt, 'timeline.json'), 'utf8')).status).toBe('failed');
        expect(JSON.parse(await readFile(join(attempt, 'trace/trace.json'), 'utf8')).meta.status).toBe('failed');
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 12_000);

  it.each(['standard', 'off'])('cancels an external lease wait before the body can run (%s)', async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-test-lease-cancel-'));
    const endpoint = `ws://cancel-wait-${root.split('/').at(-1)}/ws`;
    try {
      await mkdir(join(root, '.fliwright/tests'), { recursive: true });
      await writeFile(join(root, 'runner.mjs'), `
        import { FliwrightRunner } from ${JSON.stringify(runner)};
        import { EndpointLeaseManager } from ${JSON.stringify(import.meta.resolve('@fliwright/core'))};
        import { writeFile } from 'node:fs/promises';
        export default class CancelProbeRunner extends FliwrightRunner {
          async onBeforeRunTask(task) {
            const owner = await new EndpointLeaseManager().acquire(${JSON.stringify(endpoint)});
            const key = Symbol.for('@fliwright/vitest/prepare-task');
            const prepare = task.meta[key];
            let canceledAt;
            task.meta[key] = async (registered, signal) => {
              setTimeout(() => { canceledAt = performance.now(); this.cancel('keyboard-input'); }, 25);
              return prepare(registered, signal);
            };
            const fallback = setTimeout(() => { void owner.release(); }, 1000);
            try {
              await super.onBeforeRunTask(task);
              await writeFile(${JSON.stringify(join(root, 'cancel.json'))}, JSON.stringify({
                elapsedAfterCancel: performance.now() - canceledAt,
              }));
            } finally { clearTimeout(fallback); await owner.release(); }
          }
        }
      `);
      await writeFile(join(root, 'vitest.config.mjs'), `export default { root: ${JSON.stringify(root)}, test: {
        include: ['.fliwright/tests/cancel.test.mjs'], runner: './runner.mjs',
        maxWorkers: 1, reporters: ['dot'],
      } };`);
      await writeFile(join(root, '.fliwright/tests/cancel.test.mjs'), `
        import { writeFile } from 'node:fs/promises';
        import { createFliwrightTest } from ${JSON.stringify(integration)};
        const test = createFliwrightTest({ vmServiceUrl: ${JSON.stringify(endpoint)},
          recording: { mode: ${JSON.stringify(mode)} }, requireAssertions: false, log: { format: 'silent' },
        });
        test('canceled while waiting', async () => { await writeFile(${JSON.stringify(join(root, 'body-ran'))}, 'ran'); });
      `);
      const child = spawn(process.execPath, [cli, 'run', '--config', join(root, 'vitest.config.mjs')], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 6000,
        env: { ...process.env, FLIWRIGHT_RUN_ID: 'run-cancel-wait', FLIWRIGHT_RECORDING_MODE: '', FLIWRIGHT_CONFIG: '',
          FLIWRIGHT_RUNS_ROOT: join(root, 'runs'), FLIWRIGHT_SESSION_RESULTS_PATH: join(root, 'sessions.jsonl') },
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      await new Promise((resolveCode, reject) => { child.once('error', reject); child.once('close', resolveCode); });
      const cancellation = JSON.parse(await readFile(join(root, 'cancel.json'), 'utf8'));
      expect(cancellation.elapsedAfterCancel, output).toBeLessThan(500);
      expect(await readFile(join(root, 'body-ran')).then(() => true, () => false)).toBe(false);
      const result = JSON.parse((await readFile(join(root, 'sessions.jsonl'), 'utf8')).trim());
      expect(result).toMatchObject({ attemptOutcome: 'interrupted', testOutcome: 'interrupted', finalized: true });
      expect(result.runnerErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('keyboard-input') }),
      ]));
      expect(result.evidenceStatus).toBe(mode === 'off' ? 'disabled' : 'partial');
      const { EndpointLeaseManager, RunArtifactStore } = await import('@fliwright/core');
      const store = new RunArtifactStore({ runsRoot: join(root, 'runs'), runId: 'run-cancel-wait' });
      const attempt = store.attemptDir(result.testId, result.attemptId);
      expect(JSON.parse(await readFile(join(attempt, 'result.json'), 'utf8'))).toMatchObject({
        testOutcome: 'interrupted', finalized: true,
      });
      if (mode !== 'off') {
        expect(JSON.parse(await readFile(join(attempt, 'timeline.json'), 'utf8')).status).toBe('interrupted');
        expect(JSON.parse(await readFile(join(attempt, 'trace/trace.json'), 'utf8')).meta.status).toBe('interrupted');
      }
      // Canceling the waiter must not poison the shared lock after the owner releases it.
      const next = await new EndpointLeaseManager().acquire(endpoint, { signal: AbortSignal.timeout(500) });
      await next.release();
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 12_000);

  it('does not charge another test body for time spent waiting for the same App', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-test-lease-body-budget-'));
    try {
      await writeFile(join(root, 'runner.mjs'), `
        import { FliwrightRunner } from ${JSON.stringify(runner)};
        import { readFile } from 'node:fs/promises';
        export default class BudgetProbeRunner extends FliwrightRunner {
          async onBeforeRunTask(task) {
            if (task.name === 'short body after lease wait') {
              for (let index = 0; ; index++) {
                if (await readFile(${JSON.stringify(join(root, 'owner-started'))}).then(() => true, () => false)) break;
                if (index > 500) throw new Error('owner test did not start');
                await new Promise((resolve) => setTimeout(resolve, 2));
              }
            }
            await super.onBeforeRunTask(task);
          }
        }
      `);
      await writeFile(join(root, 'vitest.config.mjs'), `export default { root: ${JSON.stringify(root)}, test: {
        include: ['budget.test.mjs'], runner: './runner.mjs',
        maxWorkers: 1, minWorkers: 1, reporters: ['dot'], testTimeout: 1500,
      } };`);
      await writeFile(join(root, 'budget.test.mjs'), `
        import { writeFile } from 'node:fs/promises';
        import { createFliwrightTest } from ${JSON.stringify(integration)};
        const test = createFliwrightTest({ vmServiceUrl: 'ws://body-budget-app/ws', runsRoot: ${JSON.stringify(join(root, 'runs'))},
          recording: { mode: 'off' }, requireAssertions: false, log: { format: 'silent' },
        }, { driverProvider: async () => ({ sendRequest: async () => ({ success: true }),
          getDiagnostics: () => [], healing: { getReports: () => [] }, mock: {}, dispose: async () => {},
        }) });
        test.concurrent('owns App while doing work', async ({ page }) => {
          await page.clickAt(1, 2);
          await writeFile(${JSON.stringify(join(root, 'owner-started'))}, 'started');
          await new Promise((resolve) => setTimeout(resolve, 600));
        });
        test.concurrent('short body after lease wait', { timeout: 250 }, async ({ page }) => {
          await page.clickAt(3, 4);
        });
      `);
      const child = spawn(process.execPath, [cli, 'run', '--config', join(root, 'vitest.config.mjs')], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
        env: { ...process.env, FLIWRIGHT_RUN_ID: 'run-body-budget', FLIWRIGHT_RUNS_ROOT: join(root, 'runs') },
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const code = await new Promise((resolveCode, reject) => { child.once('error', reject); child.once('close', resolveCode); });
      expect(code, output).toBe(0);
      expect(output).toContain('2 passed');
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 15_000);

  it('releases after skip, timeout, setup/cleanup failures and retries in one live worker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-test-lease-outcomes-'));
    try {
      await writeFile(join(root, 'vitest.config.mjs'), `export default { root: ${JSON.stringify(root)}, test: {
        include: ['outcomes.test.mjs'], runner: ${JSON.stringify(runner)},
        maxWorkers: 1, minWorkers: 1, reporters: ['dot'], testTimeout: 1000,
      } };`);
      await writeFile(join(root, 'outcomes.test.mjs'), `
        import { beforeEach, afterEach, aroundEach, expect } from 'vitest';
        import { createFliwrightTest } from ${JSON.stringify(integration)};
        const test = createFliwrightTest({ vmServiceUrl: 'ws://lifecycle-app/ws', runsRoot: ${JSON.stringify(join(root, 'runs'))},
          recording: { mode: 'off' }, requireAssertions: false, log: { format: 'silent' },
        }, { driverProvider: async () => ({ sendRequest: async () => ({ success: true }),
          getDiagnostics: () => [], healing: { getReports: () => [] }, mock: {}, dispose: async () => {},
        }) });
        beforeEach(({ task }) => { if (task.name === 'setup') throw new Error('setup failed'); });
        afterEach(({ task }) => { if (task.name === 'cleanup') throw new Error('cleanup failed'); });
        aroundEach(async (runTest, { task, skip }) => { if (task.name === 'around skip') skip(); await runTest(); });
        test('around skip', async ({ page }) => { throw new Error('body must not run'); });
        test('after around skip', async ({ page }) => { await page.clickAt(1, 2); });
        test('skip', ({ skip }) => { skip(); });
        test('after skip', async ({ page }) => { await page.clickAt(1, 2); });
        test('timeout', { timeout: 30 }, async ({ page }) => { await page.clickAt(1, 2); await new Promise(() => {}); });
        test('after timeout', async ({ page }) => { await page.clickAt(1, 2); });
        test('setup', async ({ page }) => { throw new Error('body must not run'); });
        test('after setup', async ({ page }) => { await page.clickAt(1, 2); });
        test('cleanup', async ({ page }) => { await page.clickAt(1, 2); });
        test('after cleanup', async ({ page }) => { await page.clickAt(1, 2); });
        let calls = 0;
        test('retry', { retry: 1 }, async ({ page }) => { await page.clickAt(1, 2); expect(++calls).toBe(2); });
        test('after retry', async ({ page }) => { await page.clickAt(1, 2); });
      `);
      const child = spawn(process.execPath, [cli, 'run', '--config', join(root, 'vitest.config.mjs')], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000,
        env: { ...process.env, FLIWRIGHT_RUN_ID: 'run-outcomes', FLIWRIGHT_RUNS_ROOT: join(root, 'runs') },
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const code = await new Promise((resolveCode, reject) => { child.once('error', reject); child.once('close', resolveCode); });
      expect(code, output).toBe(1);
      expect(output).toContain('3 failed | 7 passed | 2 skipped');
      const { readdir } = await import('node:fs/promises');
      const results: Array<{ testName: string; status: string; flaky: boolean }> = [];
      for (const id of await readdir(join(root, 'runs/run-outcomes/tests'))) {
        const attempts = join(root, 'runs/run-outcomes/tests', id, 'attempts');
        for (const attempt of await readdir(attempts)) results.push(JSON.parse(await readFile(join(attempts, attempt, 'result.json'), 'utf8')));
      }
      expect(results.filter((result) => result.testName.startsWith('after '))).toHaveLength(6);
      expect(results.filter((result) => result.testName.startsWith('after ')).every((result) => result.status === 'passed')).toBe(true);
      expect(results.filter((result) => result.testName === 'retry')).toHaveLength(2);
      expect(results.filter((result) => result.testName === 'retry').every((result) => result.flaky)).toBe(true);
      expect(results.find((result) => result.testName === 'around skip')?.status).toBe('skipped');
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 25_000);

  it.each([true, false])('serializes the entire setup/body/cleanup only for a shared app: %s', async (sameApp) => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-test-lease-'));
    const events = join(root, 'events.jsonl');
    try {
      await mkdir(join(root, '.fliwright/tests'), { recursive: true });
      await writeFile(join(root, 'vitest.config.mjs'), `export default { root: ${JSON.stringify(root)}, test: {
        include: ['.fliwright/tests/*.test.mjs'], runner: ${JSON.stringify(runner)},
        maxWorkers: 2, minWorkers: 2, reporters: ['dot'], testTimeout: 5000,
      } };`);
      for (const name of ['a', 'b']) {
        await writeFile(join(root, `.fliwright/tests/${name}.test.mjs`), `
          import { beforeAll, beforeEach, afterEach, aroundEach, expect } from 'vitest';
          import { appendFile, readFile, writeFile } from 'node:fs/promises';
          import { createFliwrightTest, extendFliwrightTest } from ${JSON.stringify(integration)};
          const root = ${JSON.stringify(root)};
          const name = '${name}';
          const log = (phase) => appendFile(${JSON.stringify(events)}, JSON.stringify({ name, phase, pid: process.pid }) + '\\n');
          aroundEach(async (runTest) => {
            await log('around-setup');
            await runTest();
            await log('around-teardown');
          });
          beforeAll(async () => {
            await writeFile(root + '/' + name + '.ready', 'ready');
            const peer = name === 'a' ? 'b' : 'a';
            for (let i = 0; ; i++) {
              if (await readFile(root + '/' + peer + '.ready').then(() => true, () => false)) break;
              if (i > 500) throw new Error('peer worker did not start');
              await new Promise((resolve) => setTimeout(resolve, 5));
            }
          });
          const base = createFliwrightTest({ vmServiceUrl: 'ws://${sameApp ? 'shared' : name}-app/ws',
            runsRoot: root + '/runs', recording: { mode: 'standard' }, requireAssertions: false,
            log: { format: 'silent' },
          }, { driverProvider: async () => ({
            sendRequest: async (method) => method === 'ext.fliwright.screenshot'
              ? { success: true, screenshot: Buffer.from(name).toString('base64') }
              : { success: true },
            getDiagnostics: () => [], healing: { getReports: () => [] }, mock: {}, dispose: async () => {},
          }) });
          const test = extendFliwrightTest(base, {
            resource: async ({ page }, use) => {
              await log('fixture-setup');
              await page.clickAt(1, 2);
              await use(true);
              await new Promise((resolve) => setTimeout(resolve, 100));
              await page.clickAt(3, 4);
              await log('fixture-cleanup');
            },
          });
          beforeEach(async () => { await log('setup'); });
          afterEach(async () => { await log('teardown'); });
          test(name, async ({ resource, page }) => {
            expect(resource).toBe(true);
            await log('body');
            await page.clickAt(5, 6);
            await new Promise((resolve) => setTimeout(resolve, 300));
            await log('body-end');
          });
        `);
      }
      const child = spawn(process.execPath, [cli, 'run', '--config', join(root, 'vitest.config.mjs')], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000,
        env: { ...process.env, FLIWRIGHT_RUN_ID: 'run-test-lease', FLIWRIGHT_RUNS_ROOT: join(root, 'runs') },
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const code = await new Promise((resolveCode, reject) => { child.once('error', reject); child.once('close', resolveCode); });
      expect(code, output).toBe(0);
      const entries = (await readFile(events, 'utf8')).trim().split('\n')
        .map((line) => JSON.parse(line) as { name: string; phase: string; pid: number });
      expect(new Set(entries.map(({ pid }) => pid)).size).toBe(2);
      for (const name of ['a', 'b']) expect(entries.filter((event) => event.name === name).map(({ phase }) => phase))
        .toEqual(['around-setup', 'setup', 'fixture-setup', 'body', 'body-end', 'teardown', 'fixture-cleanup', 'around-teardown']);
      const first = entries[0].name;
      const lastFirstIndex = entries.length - 1 - [...entries].reverse().findIndex((entry) => entry.name === first);
      const nextStartIndex = entries.findIndex((entry) => entry.name !== first);
      if (sameApp) expect(nextStartIndex, JSON.stringify(entries)).toBeGreaterThan(lastFirstIndex);
      else expect(nextStartIndex, JSON.stringify(entries)).toBeLessThan(lastFirstIndex);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 25_000);
});
