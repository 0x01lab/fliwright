import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { RunManifest, RunSessionResult, TimelineData, TraceData } from '@fliwright/core';
import { EndpointLeaseManager } from '@fliwright/core';
import { runCommand } from '../src/commands/run.js';
import { artifactsExportCommand } from '../src/commands/artifacts.js';

async function readAttempt(runDir: string) {
  const manifest = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8')) as RunManifest;
  expect(manifest.tests).toHaveLength(1);
  const path = join(runDir, manifest.tests[0].attempts[0].resultPath);
  const result = JSON.parse(await readFile(path, 'utf8')) as RunSessionResult;
  const timeline = JSON.parse(await readFile(join(dirname(path), 'timeline.json'), 'utf8')) as TimelineData;
  const trace = JSON.parse(await readFile(join(dirname(path), 'trace/trace.json'), 'utf8')) as TraceData;
  return { manifest, dir: dirname(path), result, timeline, trace };
}

describe('CLI combined fault recovery', () => {
  it('keeps an App preparation failure local to its test in reports and portable exports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-preparation-failure-'));
    const runsRoot = join(root, 'runs');
    const endpoint = `ws://preparation-${root.split('/').at(-1)}/ws`;
    try {
      await mkdir(join(root, '.fliwright/tests'), { recursive: true });
      await writeFile(join(root, 'runner.mjs'), `
        import { FliwrightRunner } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest/runner'))};
        export default class FailedPreparationRunner extends FliwrightRunner {
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
      await writeFile(join(root, 'vitest.config.mjs'), `export default { test: {
        maxWorkers: 1, runner: './runner.mjs',
      } };`);
      await writeFile(join(root, '.fliwright/tests/preparation.test.mjs'), `
        import { createFliwrightTest } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest'))};
        import { expect } from 'vitest';
        const test = createFliwrightTest({ vmServiceUrl: ${JSON.stringify(endpoint)},
          recording: { mode: 'standard' }, requireAssertions: false, log: { format: 'silent' },
        });
        test('preparation fails', () => { throw new Error('failed preparation must not execute the body'); });
        test('after preparation failure', () => { expect(true).toBe(true); });
      `);
      const run = await runCommand({ cwd: root, runsRoot, print: false, testPattern: '.fliwright/tests/*.test.mjs' },
        { resolveVmUrl: async () => endpoint });
      expect(run).toMatchObject({ status: 'failed', passed: false, totalTests: 2, failedTests: 1, passedTests: 1 });
      expect(run.results).toContainEqual(expect.objectContaining({ name: 'preparation fails', error: expect.stringContaining('original App preparation error') }));
      expect(run.runnerErrors?.some(({ phase }) => phase === 'suite')).not.toBe(true);
      const verify = async (runDir: string) => {
        const manifest = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8')) as RunManifest;
        expect(manifest).toMatchObject({ status: 'failed', evidenceStatus: 'partial' });
        expect(manifest.tests).toHaveLength(2);
        const attempts = await Promise.all(manifest.tests.flatMap((test) => test.attempts).map(async (attempt) => {
          const path = join(runDir, attempt.resultPath);
          return { dir: dirname(path), result: JSON.parse(await readFile(path, 'utf8')) as RunSessionResult };
        }));
        expect(attempts.find(({ result }) => result.testName === 'after preparation failure')?.result).toMatchObject({
          finalized: true, testOutcome: 'passed',
        });
        const failed = attempts.find(({ result }) => result.testName === 'preparation fails')!;
        expect(failed.result).toMatchObject({ finalized: true, attemptOutcome: 'failed', testOutcome: 'failed', evidenceStatus: 'partial' });
        expect(failed.result.runnerErrors).toContainEqual(expect.objectContaining({ message: 'original App preparation error' }));
        expect(JSON.parse(await readFile(join(failed.dir, 'timeline.json'), 'utf8')).status).toBe('failed');
        expect(JSON.parse(await readFile(join(failed.dir, 'trace/trace.json'), 'utf8')).meta.status).toBe('failed');
        expect(JSON.parse(await readFile(join(runDir, 'report.json'), 'utf8'))).toMatchObject({ status: 'failed', failedTests: 1, passedTests: 1 });
      };
      await verify(run.artifacts!.outputDir);
      const output = join(root, 'portable');
      await expect(artifactsExportCommand({ runsRoot, runId: run.artifacts!.runId, output })).rejects.toThrow(/incomplete/);
      await artifactsExportCommand({ runsRoot, runId: run.artifacts!.runId, output, allowPartial: true });
      await rm(run.artifacts!.outputDir, { recursive: true });
      await verify(output);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 10_000);

  it('keeps cancellation during endpoint preparation interrupted in canonical and portable reports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-preparation-cancel-'));
    const runsRoot = join(root, 'runs');
    const endpoint = `ws://cancel-${root.split('/').at(-1)}/ws`;
    const owner = await new EndpointLeaseManager().acquire(endpoint);
    // This only unblocks a broken implementation so the assertion can explain the failure.
    const fallback = setTimeout(() => { void owner.release(); }, 2000);
    try {
      await mkdir(join(root, '.fliwright/tests'), { recursive: true });
      await writeFile(join(root, 'runner.mjs'), `
        import { FliwrightRunner } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest/runner'))};
        export default class CanceledPreparationRunner extends FliwrightRunner {
          async onBeforeRunTask(task) {
            const key = Symbol.for('@fliwright/vitest/prepare-task');
            const prepare = task.meta[key];
            task.meta[key] = async (registered, signal) => {
              setTimeout(() => this.cancel('keyboard-input'), 25);
              return prepare(registered, signal);
            };
            await super.onBeforeRunTask(task);
          }
        }
      `);
      await writeFile(join(root, 'vitest.config.mjs'), `export default { test: {
        maxWorkers: 1, runner: './runner.mjs',
      } };`);
      await writeFile(join(root, '.fliwright/tests/cancel.test.mjs'), `
        import { createFliwrightTest } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest'))};
        import { writeFile } from 'node:fs/promises';
        const test = createFliwrightTest({ vmServiceUrl: ${JSON.stringify(endpoint)},
          recording: { mode: 'standard' }, requireAssertions: false, log: { format: 'silent' },
        });
        test('canceled before acquiring the App', async () => {
          await writeFile(${JSON.stringify(join(root, 'body-ran'))}, 'ran');
        });
      `);
      const run = await runCommand({ cwd: root, runsRoot, print: false, testPattern: '.fliwright/tests/*.test.mjs' },
        { resolveVmUrl: async () => endpoint });
      expect(run).toMatchObject({ status: 'interrupted', passed: false });
      expect(await readFile(join(root, 'body-ran')).then(() => true, () => false)).toBe(false);
      const attempt = await readAttempt(run.artifacts!.outputDir);
      expect(attempt.manifest).toMatchObject({ status: 'interrupted', evidenceStatus: 'partial' });
      expect(attempt.result).toMatchObject({ finalized: true, testOutcome: 'interrupted', evidenceStatus: 'partial' });
      expect(attempt.result.runnerErrors).toContainEqual(expect.objectContaining({ message: expect.stringContaining('keyboard-input') }));
      expect(attempt.timeline.status).toBe('interrupted');
      expect(attempt.trace.meta.status).toBe('interrupted');
      const output = join(root, 'portable');
      await expect(artifactsExportCommand({ runsRoot, runId: run.artifacts!.runId, output })).rejects.toThrow(/incomplete/);
      await artifactsExportCommand({ runsRoot, runId: run.artifacts!.runId, output, allowPartial: true });
      await rm(run.artifacts!.outputDir, { recursive: true });
      const portable = await readAttempt(output);
      expect(portable.manifest.status).toBe('interrupted');
      expect(portable.result.testOutcome).toBe('interrupted');
      expect(portable.timeline.status).toBe('interrupted');
      expect(portable.trace.meta.status).toBe('interrupted');
      expect(JSON.parse(await readFile(join(output, 'report.json'), 'utf8'))).toMatchObject({ status: 'interrupted', passed: false });
    } finally { clearTimeout(fallback); await owner.release(); await rm(root, { recursive: true, force: true }); }
  }, 10_000);

  it('preserves transport, capture, cleanup and collection faults through portable partial export', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-combined-failure-'));
    const runsRoot = join(root, 'runs');
    try {
      await writeFile(join(root, 'vitest.config.mjs'), 'export default { test: { maxWorkers: 1 } };');
      await writeFile(join(root, 'collection.test.mjs'), "throw new Error('collection rejected alongside failed attempt');");
      await writeFile(join(root, 'disconnect.test.mjs'), `
        import { createFliwrightTest } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest'))};
        let clicks = 0;
        let disconnected = false;
        const test = createFliwrightTest({ vmServiceUrl: 'ws://combined-fault', requireAssertions: false,
          recording: { mode: 'standard', failureCaptureBudgetMs: 90, testFinalizationBudgetMs: 600 },
          log: { format: 'silent' },
        }, { driverProvider: async () => ({
          sendRequest: async (method) => {
            if (method === 'ext.fliwright.screenshot') return disconnected ? new Promise(() => {})
              : { success: true, screenshot: Buffer.from('saved before disconnect').toString('base64') };
            if (method === 'ext.fliwright.click' && ++clicks === 2) disconnected = true;
            if (disconnected) throw new Error('original VM connection closed');
            return { success: true };
          },
          getDiagnostics: () => [], healing: { getReports: () => [] }, mock: {},
          dispose: async () => { throw new Error('cleanup also failed'); },
        }) });
        test('disconnect after saved action', async ({ page }) => {
          await page.clickAt(1, 2);
          await page.clickAt(3, 4);
        });
      `);
      const run = await runCommand({ cwd: root, runsRoot, print: false, testPattern: '*.test.mjs' },
        { resolveVmUrl: async () => 'ws://combined-fault' });
      expect(run).toMatchObject({ status: 'failed', passed: false });
      expect(run.results[0].error).toContain('original VM connection closed');
      expect(run.runnerErrors).toContainEqual(expect.objectContaining({ message: 'collection rejected alongside failed attempt' }));
      const attempt = await readAttempt(run.artifacts!.outputDir);
      expect(attempt.manifest).toMatchObject({ status: 'failed', evidenceStatus: 'partial', runnerErrors: run.runnerErrors });
      expect(attempt.result).toMatchObject({ finalized: true, testOutcome: 'failed', evidenceStatus: 'partial' });
      expect(attempt.result.runnerErrors).toEqual([expect.objectContaining({ message: 'original VM connection closed' })]);
      expect(attempt.result.evidenceIssues).toContain('cleanup also failed');
      expect(attempt.result.evidence).toContainEqual(expect.objectContaining({ kind: 'screenshot', reason: 'failure',
        result: expect.objectContaining({ status: 'timeout' }) }));
      expect(attempt.result.evidence).toContainEqual(expect.objectContaining({ kind: 'snapshot', reason: 'failure',
        result: expect.objectContaining({ status: 'unavailable' }) }));
      expect(attempt.timeline.status).toBe('failed');
      expect(attempt.trace.meta.status).toBe('failed');
      expect(attempt.trace.steps.map(({ status }) => status)).toEqual(['pass', 'fail']);
      const saved = attempt.result.evidence.find(({ kind, reason, operationId }) => kind === 'screenshot' && reason === 'finish' && operationId)!;
      expect(saved.result.status).toBe('captured');
      const first = attempt.result.evidence.find(({ kind, reason }) => kind === 'screenshot' && reason === 'start')!;
      await rm(join(attempt.dir, first.result.artifactPaths![0]));
      await expect(artifactsExportCommand({ runsRoot, runId: run.artifacts!.runId, output: join(root, 'rejected') })).rejects.toThrow(/incomplete/);
      const output = join(root, 'portable');
      const exported = await artifactsExportCommand({ runsRoot, runId: run.artifacts!.runId, output, allowPartial: true });
      expect(exported.partial).toBe(true);
      expect(exported.missing.join(' ')).toContain(first.result.artifactPaths![0]);
      await rm(run.artifacts!.outputDir, { recursive: true });
      const portable = await readAttempt(output);
      expect(portable.manifest).toMatchObject({ status: 'failed', evidenceStatus: 'partial', runnerErrors: run.runnerErrors });
      expect(portable.result.runnerErrors).toEqual(attempt.result.runnerErrors);
      expect(portable.timeline.status).toBe('failed');
      expect(portable.trace.meta.status).toBe('failed');
      await expect(readFile(join(portable.dir, saved.result.artifactPaths![0]), 'utf8')).resolves.toBe('saved before disconnect');
      const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
      expect(report.runnerErrors).toEqual(run.runnerErrors);
      expect(report.results[0].error).toContain('original VM connection closed');
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 15_000);

  it.each(['worker kill', 'cancellation'] as const)('recovers %s with damaged snapshots, corrupt journal and missing export evidence', async (fault) => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-combined-interruption-'));
    const runsRoot = join(root, 'runs');
    const ready = join(root, 'ready');
    const controller = new AbortController();
    try {
      await writeFile(join(root, 'vitest.config.mjs'), 'export default { test: { maxWorkers: 1, testTimeout: 15000 } };');
      await writeFile(join(root, 'interrupt.test.mjs'), `
        import { createFliwrightTest } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest'))};
        import { appendFile, writeFile } from 'node:fs/promises';
        import { join } from 'node:path';
        const test = createFliwrightTest({ vmServiceUrl: 'ws://interruption-fault', requireAssertions: false,
          recording: { mode: 'standard' }, log: { format: 'silent' },
        }, { driverProvider: async () => ({
          sendRequest: async (method) => method === 'ext.fliwright.screenshot'
            ? { success: true, screenshot: Buffer.from('saved before interruption').toString('base64') }
            : { success: true },
          getDiagnostics: () => [], healing: { getReports: () => [] }, mock: {}, dispose: async () => {},
        }) });
        test('saved action before process interruption', async ({ page, flow, timeline }) => {
          await page.clickAt(1, 2);
          await flow.step('Unfinished business step', async () => {
            const dir = timeline.artifactStore.runDir;
            await writeFile(join(dir, 'result.json'), '{broken snapshot');
            await writeFile(join(dir, 'timeline.json'), '{broken snapshot');
            await appendFile(join(dir, 'events.jsonl'), 'corrupt complete line\\n{"trailing":');
            await writeFile(${JSON.stringify(ready)}, String(process.pid));
            ${fault === 'worker kill' ? "process.kill(process.pid, 'SIGKILL');" : ''}
            await new Promise(() => {});
          });
        });
      `);
      const running = runCommand({ cwd: root, runsRoot, print: false, signal: controller.signal, testPattern: 'interrupt.test.mjs' },
        { resolveVmUrl: async () => 'ws://interruption-fault' });
      let workerPid = 0;
      try {
        await vi.waitFor(async () => {
          workerPid = Number(await readFile(ready, 'utf8'));
          expect(workerPid).toBeGreaterThan(0);
        }, { timeout: 10_000 });
      } finally {
        if (fault === 'cancellation' || !workerPid) controller.abort();
      }
      const run = await running;
      expect(run).toMatchObject({ status: 'interrupted', passed: false });
      expect(run.runnerErrors).toContainEqual(expect.objectContaining({ phase: 'process' }));
      if (fault === 'worker kill') expect(run.runnerErrors).toContainEqual(expect.objectContaining({ phase: 'unhandled' }));
      await vi.waitFor(() => { expect(() => process.kill(workerPid, 0)).toThrow(); }, { timeout: 5000 });
      const attempt = await readAttempt(run.artifacts!.outputDir);
      expect(attempt.manifest).toMatchObject({ status: 'interrupted', evidenceStatus: 'partial', runnerErrors: run.runnerErrors });
      expect(attempt.result).toMatchObject({ status: 'interrupted', testOutcome: 'interrupted', evidenceStatus: 'partial' });
      expect(attempt.result.runnerErrors).toEqual(expect.arrayContaining(run.runnerErrors!.map((error) => expect.objectContaining({ phase: error.phase, message: error.message }))));
      expect(attempt.result.evidenceIssues?.join(' ')).toMatch(/corrupt/i);
      expect(attempt.result.evidenceIssues?.join(' ')).toMatch(/trailing line/i);
      expect(attempt.result.operations).toContainEqual(expect.objectContaining({ kind: 'action', outcome: 'passed' }));
      expect(attempt.timeline).toMatchObject({ status: 'interrupted' });
      expect(attempt.timeline.nodes).toContainEqual(expect.objectContaining({ title: 'Unfinished business step', status: 'interrupted' }));
      expect(attempt.trace.meta.status).toBe('interrupted');
      expect(attempt.trace.steps.map(({ status }) => status)).toEqual(['pass']);
      const saved = attempt.result.evidence.find(({ kind, reason }) => kind === 'screenshot' && reason === 'finish')!;
      const first = attempt.result.evidence.find(({ kind, reason }) => kind === 'screenshot' && reason === 'start')!;
      await rm(join(attempt.dir, first.result.artifactPaths![0]));
      const output = join(root, 'portable');
      await expect(artifactsExportCommand({ runsRoot, runId: run.artifacts!.runId, output })).rejects.toThrow(/incomplete/);
      const exported = await artifactsExportCommand({ runsRoot, runId: run.artifacts!.runId, output, allowPartial: true });
      expect(exported.partial).toBe(true);
      expect(exported.missing.join(' ')).toContain(first.result.artifactPaths![0]);
      await rm(run.artifacts!.outputDir, { recursive: true });
      const portable = await readAttempt(output);
      expect(portable.result).toMatchObject({ testOutcome: 'interrupted', evidenceStatus: 'partial' });
      expect(portable.timeline.status).toBe('interrupted');
      expect(portable.trace.meta.status).toBe('interrupted');
      await expect(readFile(join(portable.dir, saved.result.artifactPaths![0]), 'utf8')).resolves.toBe('saved before interruption');
      const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
      expect(report).toMatchObject({ status: 'interrupted', runnerErrors: run.runnerErrors });
    } finally { controller.abort(); await rm(root, { recursive: true, force: true }); }
  }, 25_000);
});
