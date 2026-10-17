import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

interface ProbeEvent {
  source: string;
  name: string;
  taskName?: string;
  state?: string;
  retry?: number;
  repeats?: number;
  errors?: number;
}

const thisDirectory = dirname(fileURLToPath(import.meta.url));
const runnerPath = resolve(thisDirectory, 'fixtures/runner-lifecycle-probe-runner.mjs');
const vitestCliPath = resolve(thisDirectory, '../../../node_modules/vitest/vitest.mjs');

describe('Vitest runner lifecycle contract', () => {
  it('reports task, attempt, setup, body, teardown, retry, skip and expected-failure order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-runner-lifecycle-'));
    const eventsPath = join(root, 'events.jsonl');
    const configPath = join(root, 'vitest.config.mjs');
    const testPath = join(root, 'runner-lifecycle.test.mjs');

    await writeFile(configPath, `
      export default {
        root: ${JSON.stringify(root)},
        test: {
          include: ['runner-lifecycle.test.mjs'],
          reporters: ['dot'],
          runner: ${JSON.stringify(runnerPath)},
          retry: 0,
          testTimeout: 200,
          maxWorkers: 1,
          minWorkers: 1,
        },
      };
    `);
    await writeFile(testPath, `
      import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
      import { appendFileSync } from 'node:fs';
      const emit = (name) => appendFileSync(process.env.FLIWRIGHT_RUNNER_PROBE_LOG, JSON.stringify({ source: 'test', name }) + '\\n');

      beforeEach((context) => {
        const name = context.task.name;
        emit('beforeEach:' + name);
        if (name === 'setup failure') throw new Error('setup failure');
      });
      afterEach((context) => {
        const name = context.task.name;
        emit('afterEach:start:' + name);
        if (name === 'teardown failure') throw new Error('teardown failure');
        emit('afterEach:end:' + name);
      });

      test('body failure', () => {
        emit('body:body failure');
        throw new Error('body failure');
      });
      test('setup failure', () => emit('body:setup failure'));
      test('teardown failure', () => emit('body:teardown failure'));
      test('retry succeeds', { retry: 1 }, () => {
        emit('body:retry succeeds');
        const attempts = Number(process.env.FLIWRIGHT_RUNNER_PROBE_ATTEMPTS ?? '0');
        process.env.FLIWRIGHT_RUNNER_PROBE_ATTEMPTS = String(attempts + 1);
        if (attempts === 0) throw new Error('first attempt');
        expect(attempts).toBe(1);
      });
      test('timeout', { timeout: 35 }, async () => {
        emit('body:timeout');
        await new Promise((resolve) => setTimeout(resolve, 500));
      });
      test.skip('skipped task', () => emit('body:skipped task'));
      test.fails('expected failure', () => {
        emit('body:expected failure');
        throw new Error('expected failure');
      });
      describe('beforeAll failure suite', () => {
        beforeAll(() => {
          emit('beforeAll:beforeAll failure suite');
          throw new Error('beforeAll failure');
        });
        afterAll(() => emit('afterAll:beforeAll failure suite'));
        test('blocked by beforeAll', () => emit('body:blocked by beforeAll'));
      });
    `);

    try {
      const result = await runVitest(configPath, eventsPath);
      expect(result.code).toBe(1);

      const events = (await readFile(eventsPath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as ProbeEvent);

      assertOrder(events, [
        'runner:onBeforeRunTask:body failure',
        'runner:onBeforeTryTask:body failure:0',
        'test:beforeEach:body failure',
        'test:body:body failure',
        'runner:onTaskFinished:body failure:fail',
        'test:afterEach:start:body failure',
        'test:afterEach:end:body failure',
        'runner:onAfterRetryTask:body failure:fail:0',
        'runner:onAfterRunTask:body failure:fail',
      ]);

      expect(names(events)).toContain('runner:onTaskFinished:setup failure:fail');
      expect(names(events)).not.toContain('test:body:setup failure');
      assertOrder(events, [
        'runner:onTaskFinished:setup failure:fail',
        'test:afterEach:start:setup failure',
        'test:afterEach:end:setup failure',
      ]);

      assertOrder(events, [
        'runner:onTaskFinished:teardown failure:pass',
        'test:afterEach:start:teardown failure',
        'runner:onAfterRetryTask:teardown failure:fail:0',
        'runner:onAfterRunTask:teardown failure:fail',
      ]);

      expect(events.filter((event) => event.name === 'onTaskFinished' && event.source === 'runner'))
        .toHaveLength(7);
      expect(names(events)).toContain('runner:onAfterRetryTask:retry succeeds:pass:1');
      expect(names(events)).toContain('runner:onAfterRunTask:retry succeeds:pass');
      expect(names(events)).toContain('runner:onTaskFinished:timeout:fail');
      expect(names(events)).toContain('runner:onAfterRetryTask:timeout:fail:0');
      expect(names(events)).toContain('runner:onAfterRunTask:timeout:fail');
      expect(names(events)).toContain('runner:onBeforeRunTask:skipped task');
      expect(names(events)).not.toContain('runner:onAfterRunTask:skipped task:skip');
      expect(names(events)).toContain('runner:onAfterRunTask:expected failure:pass');
      expect(names(events)).not.toContain('runner:onTaskFinished:skipped task:skip');
      expect(names(events)).toContain('runner:onAfterRunSuite:beforeAll failure suite:fail');
      expect(names(events)).not.toContain('runner:onBeforeRunTask:blocked by beforeAll');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('surfaces a worker process crash without a fabricated task completion hook', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-worker-crash-'));
    const eventsPath = join(root, 'events.jsonl');
    const configPath = join(root, 'vitest.config.mjs');
    const testPath = join(root, 'worker-crash.test.mjs');

    await writeFile(configPath, `
      export default {
        root: ${JSON.stringify(root)},
        test: {
          include: ['worker-crash.test.mjs'],
          reporters: ['dot'],
          runner: ${JSON.stringify(runnerPath)},
          pool: 'forks',
          maxWorkers: 1,
          minWorkers: 1,
          retry: 0,
        },
      };
    `);
    await writeFile(testPath, `
      import { test } from 'vitest';
      test('crashes worker', () => process.exit(73));
    `);

    try {
      const result = await runVitest(configPath, eventsPath, 15_000);
      expect(result.code).not.toBe(0);
      expect(result.output).toMatch(/worker|process|exited|exit/i);

      const events = await readProbeEvents(eventsPath);
      expect(names(events)).toContain('runner:onBeforeRunTask:crashes worker');
      expect(names(events)).not.toContain('runner:onTaskFinished:crashes worker:pass');
      expect(names(events)).not.toContain('runner:onAfterRunTask:crashes worker:pass');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

function names(events: ProbeEvent[]): string[] {
  return events.map((event) => {
    if (event.source === 'test') return `test:${event.name}`;
    if (event.name === 'onBeforeTryTask') {
      return `runner:${event.name}:${event.taskName}:${event.retry}`;
    }
    if (event.name === 'onAfterRetryTask') {
      return `runner:${event.name}:${event.taskName}:${event.state}:${event.retry}`;
    }
    return `runner:${event.name}:${event.taskName}${event.state ? `:${event.state}` : ''}`;
  });
}

function assertOrder(events: ProbeEvent[], expected: string[]): void {
  const actual = names(events);
  let cursor = -1;
  for (const item of expected) {
    const next = actual.indexOf(item, cursor + 1);
    expect(next, `Expected lifecycle event "${item}" after index ${cursor}; observed: ${actual.join(', ')}`)
      .toBeGreaterThan(cursor);
    cursor = next;
  }
}

function runVitest(
  configPath: string,
  eventsPath: string,
  timeoutMs = 30_000,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [vitestCliPath, 'run', '--config', configPath], {
      cwd: dirname(configPath),
      env: {
        ...process.env,
        FLIWRIGHT_RUNNER_PROBE_LOG: eventsPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolveResult({ code, output });
    });
  });
}

async function readProbeEvents(path: string): Promise<ProbeEvent[]> {
  try {
    const content = await readFile(path, 'utf8');
    return content.trim().split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as ProbeEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
