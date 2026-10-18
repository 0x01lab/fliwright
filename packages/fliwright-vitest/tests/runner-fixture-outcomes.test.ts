import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const directory = dirname(fileURLToPath(import.meta.url));
const integration = resolve(directory, '../src/index.ts');
const runner = resolve(directory, '../src/runner.ts');
const cli = resolve(directory, '../../../node_modules/vitest/vitest.mjs');

describe('runner outcomes with real Fliwright fixtures', () => {
  it('serializes action and evidence requests for the same VM endpoint across workers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-endpoint-worker-lease-'));
    const runs = join(root, 'runs');
    const events = join(root, 'requests.jsonl');
    await mkdir(join(root, '.fliwright/tests'), { recursive: true });
    await writeFile(join(root, 'vitest.config.mjs'), `export default { root: ${JSON.stringify(root)}, test: {
      include: ['.fliwright/tests/*.test.mjs'], runner: ${JSON.stringify(runner)},
      maxWorkers: 2, minWorkers: 2, reporters: ['dot'], testTimeout: 5000,
    } };`);
    const testSource = (name: string) => `
      import { appendFile } from 'node:fs/promises';
      import { createFliwrightTest } from ${JSON.stringify(integration)};
      const endpoint = 'ws://same-app/ws';
      const log = ${JSON.stringify(events)};
      const driver = {
        sendRequest: async (method) => {
          const token = JSON.stringify({ method, phase: 'start', pid: process.pid, at: Date.now() });
          await appendFile(log, token + '\\n');
          await new Promise((resolve) => setTimeout(resolve, 35));
          await appendFile(log, JSON.stringify({ method, phase: 'end', pid: process.pid, at: Date.now() }) + '\\n');
          if (method === 'ext.fliwright.screenshot') return { success: true, screenshot: Buffer.from('${name}').toString('base64') };
          if (method === 'ext.fliwright.snap') return { snapshot: { name: '${name}' }, refs: [], raw: '${name}' };
          return { success: true };
        },
        getDiagnostics: () => [], healing: { getReports: () => [] }, mock: {}, dispose: async () => {},
      };
      const test = createFliwrightTest({ vmServiceUrl: endpoint, runsRoot: ${JSON.stringify(runs)},
        recording: { mode: 'standard' }, requireAssertions: false, log: { format: 'silent' },
      }, { driverProvider: async () => driver });
      test('${name}', async ({ page }) => { await page.clickAt(1, 2); });
    `;
    await writeFile(join(root, '.fliwright/tests/a.test.mjs'), testSource('a'));
    await writeFile(join(root, '.fliwright/tests/b.test.mjs'), testSource('b'));
    try {
      const child = spawn(process.execPath, [cli, 'run', '--config', join(root, 'vitest.config.mjs')], {
        cwd: root,
        env: { ...process.env, FLIWRIGHT_RUN_ID: 'run-worker-lease', FLIWRIGHT_RUNS_ROOT: runs },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const code = await new Promise<number | null>((resolveCode, reject) => {
        child.once('error', reject);
        child.once('close', resolveCode);
      });
      expect(code, output).toBe(0);
      const requests = (await readFile(events, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as {
        method: string; phase: 'start' | 'end'; pid: number; at: number;
      });
      const intervals = requests.reduce((all, event) => {
        if (event.phase === 'start') all.push({ method: event.method, pid: event.pid, start: event.at, end: 0 });
        else {
          const pending = [...all].reverse().find((candidate) => candidate.pid === event.pid && candidate.method === event.method && candidate.end === 0);
          if (pending) pending.end = event.at;
        }
        return all;
      }, [] as Array<{ method: string; pid: number; start: number; end: number }>);
      expect(intervals.filter((interval) => interval.method === 'ext.fliwright.click')).toHaveLength(2);
      for (let index = 1; index < intervals.length; index++) {
        expect(intervals[index].start).toBeGreaterThanOrEqual(intervals[index - 1].end);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('preserves a VM disconnect as a failed partial attempt with the original transport error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-vm-disconnect-'));
    const runs = join(root, 'runs');
    const disposedPath = join(root, 'driver-disposed');
    await mkdir(join(root, '.fliwright/tests'), { recursive: true });
    await writeFile(join(root, 'vitest.config.mjs'), `export default { root: ${JSON.stringify(root)}, test: {
      include: ['.fliwright/tests/*.test.mjs'], runner: ${JSON.stringify(runner)},
      maxWorkers: 1, minWorkers: 1, reporters: ['dot'], testTimeout: 1000,
    } };`);
    await writeFile(join(root, '.fliwright/tests/disconnect.test.mjs'), `
      import { createFliwrightTest } from ${JSON.stringify(integration)};
      import { writeFile } from 'node:fs/promises';
      let disconnected = false;
      const test = createFliwrightTest({ vmServiceUrl: 'ws://unused', runsRoot: ${JSON.stringify(runs)},
        recording: { mode: 'standard', failureCaptureBudgetMs: 100 }, requireAssertions: false,
        log: { format: 'silent' },
      }, { driverProvider: async () => ({
        sendRequest: async (method) => {
          if (disconnected) throw new Error('WebSocket connection closed');
          if (method === 'ext.fliwright.click') {
            disconnected = true;
            throw new Error('WebSocket connection closed');
          }
          if (method === 'ext.fliwright.screenshot') return { success: true, screenshot: Buffer.from('before-disconnect').toString('base64') };
          if (method === 'ext.fliwright.snap') return { snapshot: { connected: !disconnected }, refs: [], raw: 'connected' };
          if (method === 'ext.fliwright.snapshot') return { widgets: [] };
          if (method === 'ext.fliwright.captureFrame') return { diagnostics: { connected: !disconnected } };
          return { success: true };
        },
        getDiagnostics: () => [], healing: { getReports: () => [] }, mock: {},
        dispose: async () => { await writeFile(${JSON.stringify(disposedPath)}, 'disposed'); },
      }) });
      test('disconnects during action', async ({ page }) => { await page.clickAt(10, 20); });
    `);
    try {
      const child = spawn(process.execPath, [cli, 'run', '--config', join(root, 'vitest.config.mjs')], {
        cwd: root,
        env: { ...process.env, FLIWRIGHT_RUN_ID: 'run-disconnect', FLIWRIGHT_RUNS_ROOT: runs },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const code = await new Promise<number | null>((resolveCode, reject) => {
        child.once('error', reject);
        child.once('close', resolveCode);
      });
      expect(code, output).toBe(1);
      const testDirectories = await readdir(join(runs, 'run-disconnect', 'tests'));
      const attemptDir = join(runs, 'run-disconnect', 'tests', testDirectories[0], 'attempts', 'attempt-0');
      const result = JSON.parse(await readFile(join(attemptDir, 'result.json'), 'utf8')) as {
        status: string; testOutcome: string; evidenceStatus: string; runnerErrors: Array<{ message: string }>;
      };
      expect(result).toMatchObject({ status: 'failed', testOutcome: 'failed', evidenceStatus: 'partial' });
      expect(result.runnerErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ message: 'WebSocket connection closed' }),
      ]));
      await expect(readFile(disposedPath, 'utf8')).resolves.toBe('disposed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('attributes a project fixture cleanup failure to the attempt after the body passes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-fixture-cleanup-'));
    const runs = join(root, 'runs');
    await mkdir(join(root, '.fliwright/tests'), { recursive: true });
    await writeFile(join(root, 'vitest.config.mjs'), `export default { root: ${JSON.stringify(root)}, test: {
      include: ['.fliwright/tests/*.test.mjs'], runner: ${JSON.stringify(runner)},
      maxWorkers: 1, minWorkers: 1, reporters: ['dot'], testTimeout: 1000,
    } };`);
    await writeFile(join(root, '.fliwright/tests/cleanup.test.mjs'), `
      import { expect } from 'vitest';
      import { createFliwrightTest, extendFliwrightTest } from ${JSON.stringify(integration)};
      const base = createFliwrightTest({ vmServiceUrl: 'ws://unused', runsRoot: ${JSON.stringify(runs)},
        recording: { mode: 'standard', failureCaptureBudgetMs: 100 }, requireAssertions: false,
        log: { format: 'silent' },
      }, { driverProvider: async () => ({
        sendRequest: async (method) => method === 'ext.fliwright.screenshot'
          ? { success: true, screenshot: Buffer.from('cleanup').toString('base64') }
          : { success: true, snapshot: { cleanup: true }, diagnostics: { cleanup: true } },
        getDiagnostics: () => [], healing: { getReports: () => [] }, mock: {}, dispose: async () => {},
      }) });
      const test = extendFliwrightTest(base, {
        resource: async ({ timeline }, use) => {
          void timeline;
          await use({ opened: true });
          throw new Error('project fixture cleanup failed');
        },
      });
      test('body passes before fixture cleanup fails', async ({ resource }) => {
        expect(resource.opened).toBe(true);
      });
    `);
    try {
      const child = spawn(process.execPath, [cli, 'run', '--config', join(root, 'vitest.config.mjs')], {
        cwd: root,
        env: { ...process.env, FLIWRIGHT_RUN_ID: 'run-cleanup', FLIWRIGHT_RUNS_ROOT: runs },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const code = await new Promise<number | null>((resolveCode, reject) => {
        child.once('error', reject);
        child.once('close', resolveCode);
      });
      expect(code, output).toBe(1);
      const testDirectories = await readdir(join(runs, 'run-cleanup', 'tests'));
      expect(testDirectories).toHaveLength(1);
      const attemptDir = join(runs, 'run-cleanup', 'tests', testDirectories[0], 'attempts', 'attempt-0');
      const result = JSON.parse(await readFile(join(attemptDir, 'result.json'), 'utf8')) as {
        status: string; testOutcome: string; runnerErrors: Array<{ message: string }>;
      };
      const timeline = JSON.parse(await readFile(join(attemptDir, 'timeline.json'), 'utf8')) as { status: string };
      const trace = JSON.parse(await readFile(join(attemptDir, 'trace/trace.json'), 'utf8')) as { meta: { status: string } };
      expect(result).toMatchObject({ status: 'failed', testOutcome: 'failed' });
      expect(result.runnerErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ message: 'project fixture cleanup failed' }),
      ]));
      expect(timeline.status).toBe('failed');
      expect(trace.meta.status).toBe('failed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('reports a missing runner preset as a configuration error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-missing-preset-'));
    try {
      await writeFile(join(root, 'vitest.config.mjs'), `export default { root: ${JSON.stringify(root)}, test: { include: ['missing.test.mjs'], reporters: ['dot'] } };`);
      await writeFile(join(root, 'missing.test.mjs'), `
        import { createFliwrightTest } from ${JSON.stringify(integration)};
        const test = createFliwrightTest({ vmServiceUrl: 'ws://unused', requireAssertions: false });
        test('missing preset', async ({ timeline }) => {});
      `);
      const child = spawn(process.execPath, [cli, 'run', '--config', join(root, 'vitest.config.mjs')], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000,
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const code = await new Promise((resolveCode, reject) => {
        child.on('error', reject); child.on('close', resolveCode);
      });
      expect(code, output).toBe(1);
      expect(output).toContain('Configure fliwrightPreset()');
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 20_000);

  it('persists actual results and captures body/setup failures before cleanup changes the app', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-fixture-outcomes-'));
    const runs = join(root, 'runs');
    await mkdir(join(root, '.fliwright/tests'), { recursive: true });
    await writeFile(join(root, 'vitest.config.mjs'), `export default { root: ${JSON.stringify(root)}, test: {
      include: ['.fliwright/tests/*.test.mjs'], runner: ${JSON.stringify(runner)},
      maxWorkers: 1, minWorkers: 1, reporters: ['dot'], testTimeout: 1000,
    } };`);
    await writeFile(join(root, '.fliwright/tests/outcomes.test.mjs'), `
      import { beforeEach, afterEach, expect } from 'vitest';
      import { createFliwrightTest } from ${JSON.stringify(integration)};
      let state = 'body';
      const driver = {
        sendRequest: async (method, params) => {
          if (method === 'ext.fliwright.screenshot' && state === 'stall') return new Promise(() => {});
          if (method === 'ext.fliwright.screenshot') return { success: true, screenshot: Buffer.from(state).toString('base64') };
          if (method === 'ext.fliwright.snap') return { snapshot: { text: state }, refs: [], raw: state };
          if (method === 'ext.fliwright.snapshot') return { widgets: [{ text: state }] };
          if (method === 'ext.fliwright.captureFrame') return { diagnostics: { state } };
          if (method === 'ext.fliwright.action' && params.sensitive === 'true') return { success: false, error: 'rejected ' + params.text };
          if (method === 'ext.fliwright.click' && params.x === '99') return { success: false, error: 'caught action' };
          return { success: true, diagnostics: { state } };
        },
        getDiagnostics: () => [{ state }], healing: { getReports: () => [] },
        mock: {}, dispose: async () => {},
      };
      const test = createFliwrightTest({ vmServiceUrl: 'ws://unused', runsRoot: ${JSON.stringify(runs)},
        recording: { mode: 'standard', failureCaptureBudgetMs: 90 }, requireAssertions: false, log: { format: 'silent' },
      }, { driverProvider: async () => driver });
      const strictTest = createFliwrightTest({ vmServiceUrl: 'ws://unused', runsRoot: ${JSON.stringify(runs)}, requireAssertions: true, log: { format: 'silent' } }, { driverProvider: async () => driver });
      strictTest('regular assertion counts', async ({ page }) => { expect(true).toBe(true); });
      strictTest('no executed assertions', async ({ page }) => { await page.clickAt(1, 2); });
      beforeEach(({ task, page }) => {
        state = task.name === 'setup failure' ? 'setup' : 'body';
        if (task.name === 'setup failure') throw new Error('setup original error');
      });
      afterEach(({ task }) => {
        state = 'cleanup';
        if (task.name === 'teardown failure') throw new Error('teardown original error');
      });
      test('ordinary throw', async ({ page }) => { throw new Error('body original error'); });
      test('last assertion failure', async ({ page }) => { await page.clickAt(1, 2); expect(1).toBe(2); });
      test('setup failure', async ({ page }) => { throw new Error('must not run'); });
      test('teardown failure', async ({ page }) => { expect(true).toBe(true); });
      test.fails('unexpected success', async ({ page }) => { expect(true).toBe(true); });
      test('runtime skip', async ({ page, skip }) => { skip(); });
      test('repeated run', { repeats: 1 }, async ({ page }) => { expect(true).toBe(true); });
      test.fails('expected failure', async ({ page }) => { throw new Error('expected original error'); });
      test('caught action failure', async ({ page }) => { try { await page.clickAt(99, 0); } catch {} expect(true).toBe(true); });
      test('sensitive action failure', async ({ page }) => { await page.getByKey('password').fill('private-input-42', { sensitive: true }); });
      test('evidence timeout', async ({ page }) => { state = 'stall'; throw new Error('original with hung evidence'); });
      test('timeout failure', { timeout: 40 }, async ({ page }) => { await new Promise(() => {}); });
      test.skip('skipped task', async ({ page }) => { throw new Error('must not run'); });
      let tries = 0;
      test('retry succeeds', { retry: 1 }, async ({ page }) => { if (++tries === 1) throw new Error('first attempt'); expect(true).toBe(true); });
    `);
    try {
      const child = spawn(process.execPath, [cli, 'run', '--config', join(root, 'vitest.config.mjs')], {
        cwd: root, env: { ...process.env, FLIWRIGHT_RUN_ID: 'run-fixtures', FLIWRIGHT_RUNS_ROOT: runs,
        },
        stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000,
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const code = await new Promise((resolveCode, reject) => {
        child.on('error', reject);
        child.on('close', resolveCode);
      });
      expect(code, output).toBe(1);
      const attempts = [];
      for (const testId of await readdir(join(runs, 'run-fixtures/tests'))) {
        const base = join(runs, 'run-fixtures/tests', testId, 'attempts');
        for (const attemptId of await readdir(base)) {
          const dir = join(base, attemptId);
          const result = JSON.parse(await readFile(join(dir, 'result.json'), 'utf8'));
          const timeline = JSON.parse(await readFile(join(dir, 'timeline.json'), 'utf8'));
          const trace = JSON.parse(await readFile(join(dir, 'trace/trace.json'), 'utf8'));
          attempts.push({ dir, result, timeline, trace });
        }
      }
      expect(attempts).toHaveLength(18);
      for (const name of ['ordinary throw', 'last assertion failure', 'setup failure', 'teardown failure', 'timeout failure', 'no executed assertions']) {
        const attempt = attempts.find(({ result }) => result.testName === name)!;
        expect(attempt, name).toBeDefined();
        expect(attempt.result, name).toMatchObject({ status: 'failed', testOutcome: 'failed', attemptOutcome: 'failed' });
        expect(attempt.timeline.status, name).toBe('failed');
        expect(attempt.trace.meta.status, name).toBe('failed');
        const failure = attempt.timeline.nodes.find((node: { kind: string }) => node.kind === 'failure');
        expect(failure, name).toMatchObject({ status: 'failed' });
        const screenshot = failure.artifacts?.find((artifact: { kind: string }) => artifact.kind === 'screenshot');
        expect(screenshot, name).toBeDefined();
        const contents = await readFile(join(attempt.dir, screenshot.path), 'utf8');
        expect(contents, name).toBe(name === 'setup failure' ? 'setup' : name === 'teardown failure' ? 'cleanup' : 'body');
      }
      expect(attempts.find(({ result }) => result.testName === 'regular assertion counts')!.result.testOutcome).toBe('passed');
      const sensitive = attempts.find(({ result }) => result.testName === 'sensitive action failure')!;
      expect(JSON.stringify(sensitive)).not.toContain('private-input-42');
      const journalText = await readFile(join(sensitive.dir, 'events.jsonl'), 'utf8');
      expect(journalText).not.toContain('private-input-42');
      expect(journalText.trim().split('\n').map((line) => JSON.parse(line)).at(-1)).toMatchObject({ finalized: true });
      expect(output).not.toContain('private-input-42');
      const failureReport = await Promise.all(attempts.filter(({ result }) => result.failureContextPath).map(async (attempt) =>
        JSON.parse(await readFile(join(attempt.dir, attempt.result.failureContextPath), 'utf8'))));
      expect(JSON.stringify(failureReport)).not.toContain('private-input-42');
      const thrown = attempts.find(({ result }) => result.testName === 'ordinary throw')!;
      const failureEntry = failureReport.flat().find((entry: { testName: string }) => entry.testName === 'ordinary throw');
      expect(await readFile(join(thrown.dir, failureEntry.screenshot.path), 'utf8')).toBe('body');
      const stalled = attempts.find(({ result }) => result.testName === 'evidence timeout')!;
      expect(stalled.result).toMatchObject({ evidenceStatus: 'partial', testOutcome: 'failed',
        runnerErrors: [expect.objectContaining({ message: 'original with hung evidence' })] });
      expect(stalled.result.evidence).toContainEqual(expect.objectContaining({ kind: 'screenshot', result: expect.objectContaining({ status: 'timeout' }) }));
      expect(stalled.result.evidence).toContainEqual(expect.objectContaining({ kind: 'snapshot', result: expect.objectContaining({ status: 'captured' }) }));
      const unexpected = attempts.find(({ result }) => result.testName === 'unexpected success')!;
      expect(unexpected.result).toMatchObject({ attemptOutcome: 'passed', testOutcome: 'failed', expectedFailure: true });
      expect(unexpected.timeline.status).toBe('failed');
      expect(unexpected.timeline.nodes).toContainEqual(expect.objectContaining({ kind: 'failure', status: 'failed' }));
      const repeats = attempts.filter(({ result }) => result.testName === 'repeated run');
      expect(repeats).toHaveLength(2);
      expect(repeats[0].dir).not.toBe(repeats[1].dir);
      expect(repeats.every(({ result }) => result.testOutcome === 'passed' && !result.flaky)).toBe(true);
      const runtimeSkip = attempts.find(({ result }) => result.testName === 'runtime skip')!;
      expect(runtimeSkip.result.testOutcome).toBe('skipped');
      const expected = attempts.find(({ result }) => result.testName === 'expected failure')!;
      expect(expected.result).toMatchObject({ status: 'failed', attemptOutcome: 'failed', testOutcome: 'passed', expectedFailure: true });
      expect(expected.timeline.status).toBe('passed');
      expect(expected.trace.meta.status).toBe('passed');
      const caught = attempts.find(({ result }) => result.testName === 'caught action failure')!;
      expect(caught.timeline.status).toBe('passed');
      expect(caught.trace.meta.status).toBe('passed');
      expect(caught.result.operations).toContainEqual(expect.objectContaining({ outcome: 'failed' }));
      const skipped = attempts.find(({ result }) => result.testName === 'skipped task')!;
      expect(skipped.timeline.status).toBe('skipped');
      expect(skipped.trace.meta.status).toBe('skipped');
      const retried = attempts.filter(({ result }) => result.testName === 'retry succeeds');
      expect(retried.map(({ result }) => result.attemptOutcome).sort()).toEqual(['failed', 'passed']);
      expect(retried.every(({ result }) => result.testOutcome === 'passed' && result.flaky)).toBe(true);
      expect(retried[0].dir).not.toBe(retried[1].dir);
      const successfulRetry = retried.find(({ result }) => result.attemptOutcome === 'passed')!;
      expect(successfulRetry.timeline.nodes.filter((node: { kind: string }) => node.kind === 'failure')).toEqual([]);
      expect(successfulRetry.result.runnerErrors).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
