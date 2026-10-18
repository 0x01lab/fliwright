import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

it('retains fluent registration, project fixtures, timeouts and user metadata with task preparation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-task-registration-'));
  const integration = fileURLToPath(new URL('../src/index.ts', import.meta.url));
  const runner = fileURLToPath(new URL('../src/runner.ts', import.meta.url));
  try {
    await writeFile(join(root, 'vitest.config.mjs'), `export default { test: {
      include: ['registration.test.mjs'], runner: ${JSON.stringify(runner)}, maxWorkers: 1, reporters: ['dot'],
    } };`);
    await writeFile(join(root, 'registration.test.mjs'), `
      import { expect } from 'vitest';
      import { createFliwrightTest } from ${JSON.stringify(integration)};
      const test = createFliwrightTest({ vmServiceUrl: 'ws://fluent-registration/ws',
        recording: { mode: 'off' }, requireAssertions: false, log: { format: 'silent' },
      }, { driverProvider: async () => ({ sendRequest: async () => ({ success: true }),
        getDiagnostics: () => [], healing: { getReports: () => [] }, mock: {}, dispose: async () => {},
      }) });
      test.each([1, 2])('each %i', (value) => { expect(value).toBeGreaterThan(0); });
      test.for([1, 2])('for %i', async (value, { page }) => { await page.clickAt(value, 2); });
      test.skip.each([1, 2])('skipped each %i', () => { throw new Error('must not run'); });
      test.skipIf(true)('skipped conditional', () => { throw new Error('must not run'); });
      test.runIf(true)('enabled conditional', async ({ page }) => { await page.clickAt(1, 2); });
      test.fails('expected failure', () => { throw new Error('expected assertion failure'); });
      test('keeps metadata', { concurrent: false, meta: { ticket: 'FW-123' } }, ({ task }) => {
        expect(task.meta.ticket).toBe('FW-123');
        expect(JSON.stringify(task.meta)).toBe(JSON.stringify({ ticket: 'FW-123' }));
      });
      test('numeric timeout overload', async ({ page }) => { await page.clickAt(1, 2); }, 1000);
      const extended = test.extend({ project: async ({ page }, use) => { await use({ value: 42, page }); } });
      extended('direct extension', async ({ project, page }) => {
        expect(project.value).toBe(42); expect(project.page).toBe(page);
      });
    `);
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)),
      'run', '--config', join(root, 'vitest.config.mjs')], {
      cwd: root, timeout: 15_000, env: { ...process.env, FLIWRIGHT_RUN_ID: 'registration',
        FLIWRIGHT_RUNS_ROOT: join(root, 'runs'), FLIWRIGHT_SESSION_RESULTS_PATH: join(root, 'sessions.jsonl') },
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    expect(code, output).toBe(0);
    const sessions = (await readFile(join(root, 'sessions.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(sessions).toHaveLength(12);
    expect(sessions.filter((result) => result.testOutcome === 'skipped')).toHaveLength(3);
    expect(sessions.filter((result) => result.testOutcome === 'passed')).toHaveLength(9);
    expect(sessions.find((result) => result.testName === 'expected failure')).toMatchObject({
      expectedFailure: true, attemptOutcome: 'failed', testOutcome: 'passed',
    });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 25_000);

it.each([
  ['test(name, fn, { timeout: 1000 })', 'removed in Vitest 4'],
  ['test(name, fn, fn)', 'Cannot use two functions as arguments'],
])('retains Vitest registration rejection for %s', async (registration, message) => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-invalid-registration-'));
  const integration = fileURLToPath(new URL('../src/index.ts', import.meta.url));
  const runner = fileURLToPath(new URL('../src/runner.ts', import.meta.url));
  try {
    await writeFile(join(root, 'vitest.config.mjs'), `export default { test: {
      include: ['invalid.test.mjs'], runner: ${JSON.stringify(runner)}, maxWorkers: 1, reporters: ['dot'],
    } };`);
    await writeFile(join(root, 'invalid.test.mjs'), `
      import { createFliwrightTest } from ${JSON.stringify(integration)};
      const test = createFliwrightTest({ vmServiceUrl: '', recording: { mode: 'off' },
        requireAssertions: false, log: { format: 'silent' } });
      const name = 'invalid registration';
      const fn = () => {};
      ${registration};
    `);
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)),
      'run', '--config', join(root, 'vitest.config.mjs')], {
      cwd: root, timeout: 10_000, env: { ...process.env, FLIWRIGHT_RUN_ID: 'invalid-registration',
        FLIWRIGHT_RUNS_ROOT: join(root, 'runs') },
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    expect(code, output).toBe(1);
    expect(output).toContain(message);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 15_000);
