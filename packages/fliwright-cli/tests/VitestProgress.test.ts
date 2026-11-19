import { expect, it, vi } from 'vitest';
import { access, appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createVitestProgressReporter } from '../src/VitestProgress.js';
import { runCommand } from '../src/commands/run.js';

it('parses split and batched events without treating ordinary stdout as progress', async () => {
  const updates: unknown[] = [];
  const reporter = await createVitestProgressReporter(event => updates.push(event));
  const event = { filePath: '/tests/a.ts', titlePath: ['suite > nested', '中文 / case'], status: 'passed', durationMs: 3 };
  try {
    reporter.onOutput('ordinary log\nFLIWRIGHT_TEST_PRO');
    reporter.onOutput(`GRESS=${JSON.stringify(event).slice(0, 40)}`);
    reporter.onOutput(`${JSON.stringify(event).slice(40)}\nFLIWRIGHT_TEST_PROGRESS=invalid\nFLIWRIGHT_TEST_PROGRESS={"status":"passed"}\n`);
    reporter.onOutput(`FLIWRIGHT_TEST_PROGRESS=${JSON.stringify({ ...event, status: 'running' })}\n`);
    expect(updates).toEqual([event, { ...event, status: 'running' }]);
  } finally { await reporter.dispose(); }
  await expect(access(reporter.path)).rejects.toThrow();
});

it.each([false, true])('reports live CLI progress and preserves custom runner hooks (custom=%s)', async (customRunner) => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-live-progress-'));
  try {
    await writeFile(join(root, 'fliwright.config.ts'), "export default { recording: { mode: 'off' } };");
    await writeFile(join(root, 'progress.test.mjs'), `import { test, describe } from 'vitest';
      import { existsSync } from 'node:fs';
      describe('suite', () => {
        test('first', () => {});
        test('second', async () => {
          const deadline = Date.now() + 8000;
          while (!existsSync(${JSON.stringify(join(root, 'received'))}) && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
          if (!existsSync(${JSON.stringify(join(root, 'received'))})) throw new Error('live result was not delivered');
        });
      });`);
    if (customRunner) {
      await writeFile(join(root, 'vitest.config.mjs'), "export default { test: { runner: './custom-runner.mjs' } };");
      await writeFile(join(root, 'custom-runner.mjs'), `import { TestRunner } from ${JSON.stringify(import.meta.resolve('vitest'))};
        import { writeFile } from 'node:fs/promises';
        export default class extends TestRunner {
          async onBeforeRunTask(task) { await super.onBeforeRunTask?.(task); await writeFile(${JSON.stringify(join(root, 'custom-hook'))}, 'ran'); }
        }`);
    }
    const updates: unknown[] = [];
    const result = await runCommand({ cwd: root, testPattern: 'progress.test.mjs', runsRoot: join(root, 'runs'), print: false }, {
      resolveVmUrl: async () => 'ws://unused',
      onTestProgress: event => {
        updates.push(event);
        if (event.titlePath.at(-1) === 'first' && event.status === 'passed') writeFileSync(join(root, 'received'), 'ready');
      },
    });
    expect(result, JSON.stringify({ updates, result })).toMatchObject({ passed: true, passedTests: 2 });
    if (customRunner) await expect(access(join(root, 'custom-hook'))).resolves.toBeUndefined();
    expect(updates).toEqual([
      expect.objectContaining({ titlePath: ['suite', 'first'], status: 'running' }),
      expect.objectContaining({ titlePath: ['suite', 'first'], status: 'passed' }),
      expect.objectContaining({ titlePath: ['suite', 'second'], status: 'running' }),
      expect.objectContaining({ titlePath: ['suite', 'second'], status: 'passed' }),
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);

it('delivers split worker progress without waiting for reporter stdout', async () => {
  const updates: unknown[] = [];
  const reporter = await createVitestProgressReporter(event => updates.push(event));
  const event = { filePath: '/tests/live.ts', titlePath: ['first'], status: 'passed' };
  try {
    const encoded = JSON.stringify(event);
    await appendFile(reporter.eventsPath, encoded.slice(0, 20));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(updates).toEqual([]);
    await appendFile(reporter.eventsPath, encoded.slice(20) + '\n');
    await vi.waitFor(() => expect(updates).toEqual([event]));
  } finally { await reporter.dispose(); }
});
