import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

it('prepares each scenario retry in its own attempt before aroundEach resolves automatic fixtures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-scenario-around-retry-'));
  const sessions = join(root, 'sessions.jsonl');
  const integration = fileURLToPath(new URL('../src/index.ts', import.meta.url));
  const runner = fileURLToPath(new URL('../src/runner.ts', import.meta.url));
  try {
    await writeFile(join(root, 'vitest.config.mjs'), `export default { test: {
      include: ['retry.test.mjs'], runner: ${JSON.stringify(runner)}, maxWorkers: 1, retry: 1,
    } };`);
    await writeFile(join(root, 'retry.test.mjs'), `
      import { aroundEach, expect } from 'vitest';
      import { createFliwrightTest } from ${JSON.stringify(integration)};
      aroundEach(async (runTest) => { await runTest(); });
      let calls = 0;
      let preparations = 0;
      const driver = { app: { invoke: async () => { preparations++; } },
        sendRequest: async (method) => method === 'ext.fliwright.screenshot'
          ? { success: true, screenshot: Buffer.from('retry').toString('base64') } : { success: true },
        getDiagnostics: () => [], healing: { getReports: () => [] }, mock: {}, dispose: async () => {},
      };
      const test = createFliwrightTest({ vmServiceUrl: 'ws://scenario-retry/ws', recording: { mode: 'standard' },
        log: { format: 'silent' }, scenarios: {
          ready: { name: 'ready', layers: [{ kind: 'app', capability: 'fixture', method: 'prepare' }] },
        } }, { driverProvider: async () => driver });
      test.scenario('ready')('scenario retry with aroundEach', async ({ page }) => {
        await page.clickAt(1, 2);
        calls++;
        expect(preparations).toBe(calls);
        expect(calls).toBe(2);
      });
    `);
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)),
      'run', '--config', join(root, 'vitest.config.mjs')], {
      cwd: root, timeout: 15_000, env: { ...process.env, FLIWRIGHT_RUN_ID: 'scenario-around-retry',
        FLIWRIGHT_RUNS_ROOT: join(root, 'runs'), FLIWRIGHT_SESSION_RESULTS_PATH: sessions },
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    expect(code, output).toBe(0);
    const results = (await readFile(sessions, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(results.map((result) => [result.attemptId, result.attemptOutcome, result.testOutcome, result.flaky])).toEqual([
      ['attempt-0', 'failed', 'passed', true], ['attempt-1', 'passed', 'passed', true],
    ]);
    for (const result of results) {
      const attempt = join(root, 'runs', result.runId, 'tests', encodeURIComponent(result.testId), 'attempts', result.attemptId);
      const timeline = JSON.parse(await readFile(join(attempt, 'timeline.json'), 'utf8'));
      expect(timeline.nodes.filter((node: { title: string }) => node.title === 'Scenario: ready')).toHaveLength(1);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 25_000);

it('composes named scenarios with lazy project fixtures and retains cleanup failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-scenario-composition-'));
  const events = join(root, 'events.jsonl');
  const sessions = join(root, 'sessions.jsonl');
  const integration = fileURLToPath(new URL('../src/index.ts', import.meta.url));
  const runner = fileURLToPath(new URL('../src/runner.ts', import.meta.url));
  try {
    await writeFile(join(root, 'vitest.config.mjs'), `export default { test: {
      include: ['scenario.test.mjs'], runner: ${JSON.stringify(runner)}, maxWorkers: 1,
    } };`);
    await writeFile(join(root, 'scenario.test.mjs'), `
      import { appendFileSync } from 'node:fs';
      import { createFliwrightTest, extendFliwrightTest } from ${JSON.stringify(integration)};
      import { expect } from 'vitest';
      const log = (value) => appendFileSync(${JSON.stringify(events)}, JSON.stringify(value) + '\\n');
      const driver = { app: { invoke: async (_capability, method) => {
        log(method); if (method === 'rejectSetup') throw new Error('scenario preparation rejected');
      } }, getDiagnostics: () => [], healing: { getReports: () => [] }, mock: {}, dispose: async () => {} };
      const base = createFliwrightTest({ vmServiceUrl: 'ws://unused', recording: { mode: 'off' },
        log: { format: 'silent' }, scenarios: {
          ready: { name: 'ready', layers: [{ kind: 'app', capability: 'fixture', method: 'prepare' }] },
          rejected: { name: 'rejected', layers: [{ kind: 'app', capability: 'fixture', method: 'rejectSetup' }] },
        } }, { driverProvider: async () => driver });
      const test = extendFliwrightTest(base, {
        project: async ({ page }, use) => { log('project:setup'); await use({ value: 'project-value', page }); log('project:cleanup'); },
        unused: async ({}, use) => { throw new Error('unused fixture must remain lazy'); },
      });
      test.scenario('ready')('project body', async ({ project, page }) => {
        expect(project.value).toBe('project-value'); expect(project.page).toBe(page); log('project:body');
      });
      test.scenario('ready')('without project', async () => { expect(true).toBe(true); log('plain:body'); });
      const nested = extendFliwrightTest(test, { business: async ({ project }, use) => {
        await use(project.value + ':nested');
      } });
      nested.scenario('ready')('nested extension', async ({ business }) => { expect(business).toBe('project-value:nested'); });
      const failing = extendFliwrightTest(base, { project: async ({}, use) => {
        await use('cleanup-value'); throw new Error('original project cleanup failure');
      } });
      failing.scenario('ready')('cleanup failure', async ({ project }) => { expect(project).toBe('cleanup-value'); });
      test.scenario('rejected')('scenario failure', async () => { log('must-not-run'); expect(true).toBe(true); });
    `);
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)),
      'run', '--config', join(root, 'vitest.config.mjs')], {
      cwd: root, env: { ...process.env, FLIWRIGHT_RUN_ID: 'scenario-composition',
        FLIWRIGHT_RUNS_ROOT: join(root, 'runs'), FLIWRIGHT_SESSION_RESULTS_PATH: sessions },
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject); child.once('close', resolve);
    });
    expect(code, output).toBe(1);
    expect(output).not.toContain('scenario is not a function');
    const results = (await readFile(sessions, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(results.map((result) => [result.testName, result.testOutcome]), output).toEqual([
      ['project body', 'passed'], ['without project', 'passed'], ['nested extension', 'passed'],
      ['cleanup failure', 'failed'], ['scenario failure', 'failed'],
    ]);
    expect(results[3].runnerErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'original project cleanup failure' }),
    ]));
    expect(results[4].runnerErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('scenario preparation rejected') }),
    ]));
    const calls = (await readFile(events, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(calls.filter((call) => call === 'prepare')).toHaveLength(4);
    expect(calls.filter((call) => call === 'project:setup')).toHaveLength(2);
    expect(calls.filter((call) => call === 'project:cleanup')).toHaveLength(2);
    expect(calls.indexOf('prepare')).toBeLessThan(calls.indexOf('project:body'));
    expect(calls).not.toContain('must-not-run');
    for (const result of results) {
      const path = join(root, 'runs', result.runId, 'tests', encodeURIComponent(result.testId), 'attempts', result.attemptId, 'result.json');
      const saved = JSON.parse(await readFile(path, 'utf8'));
      expect(saved.testOutcome).toBe(result.testOutcome);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);
