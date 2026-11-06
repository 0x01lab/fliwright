import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

it('retains Vitest for/each, options and modifiers after scenario selection on every retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-scenario-registration-'));
  const sessions = join(root, 'sessions.jsonl');
  const integration = fileURLToPath(new URL('../src/index.ts', import.meta.url));
  const runner = fileURLToPath(new URL('../src/runner.ts', import.meta.url));
  try {
    await writeFile(join(root, 'vitest.config.mjs'), `export default { test: {
      include: ['cases.test.mjs'], runner: ${JSON.stringify(runner)}, maxWorkers: 1,
    } };`);
    await writeFile(join(root, 'cases.test.mjs'), `
      import { expect } from 'vitest';
      import { createFliwrightTest, extendFliwrightTest } from ${JSON.stringify(integration)};
      let preparations = 0;
      const seen = new Map();
      const driver = { app: { invoke: async () => { preparations++; } },
        sendRequest: async () => ({ success: true }), getDiagnostics: () => [],
        healing: { getReports: () => [] }, mock: {}, dispose: async () => {} };
      const base = createFliwrightTest({ vmServiceUrl: 'ws://unused', recording: { mode: 'off' },
        requireAssertions: false, log: { format: 'silent' }, scenarios: {
          ready: { name: 'ready', layers: [{ kind: 'app', capability: 'fixture', method: 'prepare' }] },
        } }, { driverProvider: async () => driver });
      const test = extendFliwrightTest(base, {
        project: async ({}, use) => { await use('injected'); },
      });
      test.scenario('ready').for(['home', 'assets'])('refresh %s',
        { retry: 1, meta: { ticket: '464' } }, async (target, { project, task }) => {
          expect(project).toBe('injected'); expect(task.meta.ticket).toBe('464');
          const count = (seen.get(target) ?? 0) + 1; seen.set(target, count);
          expect(preparations).toBe(target === 'home' ? count : count + 2);
          expect(count).toBe(2);
        });
      test.scenario('ready').each([[1, 2], [3, 4]])('sum %i %i', (a, b) => {
        expect(a + b).toBeGreaterThan(0);
      });
      test.scenario('ready').skip.for([1, 2])('skip %i', () => { throw Error('must not run'); });
      test.scenario('ready').todo('later');
      test.scenario('ready')('standard options', { timeout: 1000, meta: { ticket: 'options' } }, ({ task }) => {
        expect(task.meta.ticket).toBe('options'); expect(preparations).toBe(7);
      });
      const selected = createFliwrightTest({ vmServiceUrl: 'ws://unused', recording: { mode: 'off' },
        requireAssertions: false, log: { format: 'silent' }, defaultScenario: 'ready', scenarios: {
          ready: { name: 'ready', layers: [{ kind: 'app', capability: 'fixture', method: 'prepare' }] },
        } }, { driverProvider: async () => driver });
      selected.scenario('ready').for([8])('default %i', (n) => { expect(preparations).toBe(n); });
    `);
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)),
      'run', '--config', join(root, 'vitest.config.mjs')], {
      cwd: root, timeout: 20_000, env: { ...process.env, FLIWRIGHT_RUN_ID: 'scenario-registration',
        FLIWRIGHT_RUNS_ROOT: join(root, 'runs'), FLIWRIGHT_SESSION_RESULTS_PATH: sessions },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    expect(code, output).toBe(0);
    const results = (await readFile(sessions, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(results.filter(result => result.testOutcome === 'passed')).toHaveLength(8);
    expect(results.filter(result => result.testOutcome === 'skipped')).toHaveLength(3);
    expect(results.filter(result => result.flaky).map(result => result.testName)).toEqual([
      'refresh home', 'refresh home', 'refresh assets', 'refresh assets',
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);
