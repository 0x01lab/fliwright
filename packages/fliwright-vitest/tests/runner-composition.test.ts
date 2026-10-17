import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

it('composes an existing runner constructor and hooks while retaining Vitest assertion semantics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-composed-runner-'));
  try {
    const calls = join(root, 'custom-hooks.jsonl');
    const sessions = join(root, 'sessions.jsonl');
    await writeFile(join(root, 'runner.mjs'), `
      import { VitestTestRunner } from ${JSON.stringify(import.meta.resolve('vitest/runners'))};
      import { createFliwrightRunner } from ${JSON.stringify(new URL('../src/runner.ts', import.meta.url).pathname)};
      import { appendFileSync } from 'node:fs';
      class ExistingRunner extends VitestTestRunner {
        constructor(config) { super(config); appendFileSync(${JSON.stringify(calls)}, '"constructor"\\n'); }
        async onBeforeTryTask(task, options) {
          await super.onBeforeTryTask(task, options);
          appendFileSync(${JSON.stringify(calls)}, JSON.stringify('before:' + task.name) + '\\n');
        }
        async onTaskFinished(task) {
          appendFileSync(${JSON.stringify(calls)}, JSON.stringify('finished:' + task.name) + '\\n');
        }
      }
      export default createFliwrightRunner(ExistingRunner);
    `);
    await writeFile(join(root, 'vitest.config.mjs'), `export default { root: ${JSON.stringify(root)},
      test: { include: ['composed.test.mjs'], runner: './runner.mjs', maxWorkers: 1, reporters: ['dot'] } };`);
    await writeFile(join(root, 'composed.test.mjs'), `
      import { test, expect } from 'vitest';
      test('passes', () => expect(1).toBe(1));
      test('preserves assertion failure', () => expect(1).toBe(2));
      test('snapshot', () => expect({ value: 1 }).toMatchInlineSnapshot(${JSON.stringify('{\n  "value": 1,\n}')}));
    `);
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)), 'run', '--config', join(root, 'vitest.config.mjs')], {
        cwd: root, env: { ...process.env, FLIWRIGHT_RUN_ID: 'composed',
          FLIWRIGHT_RUNS_ROOT: join(root, 'runs'), FLIWRIGHT_SESSION_RESULTS_PATH: sessions },
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, output }));
    });
    expect(result.code, result.output).toBe(1);
    const results = (await readFile(sessions, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(results.map((item) => [item.testName, item.testOutcome]), result.output).toEqual([
      ['passes', 'passed'], ['preserves assertion failure', 'failed'], ['snapshot', 'passed'],
    ]);
    const hooks = (await readFile(calls, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(hooks, result.output).toEqual(['constructor', 'before:passes', 'finished:passes',
      'before:preserves assertion failure', 'finished:preserves assertion failure', 'before:snapshot', 'finished:snapshot']);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);
