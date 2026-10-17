import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunSessionResult, TimelineData, TraceData } from '@fliwright/core';

const directory = dirname(fileURLToPath(import.meta.url));
const cli = resolve(directory, '../../../node_modules/vitest/vitest.mjs');
const runner = resolve(directory, '../src/runner.ts');
const integration = resolve(directory, '../src/index.ts');

describe('recording modes through real Vitest fixtures', () => {
  it.each(['standard', 'full', 'off'].flatMap((mode) => [false, true].map((grouped) => ({ mode, grouped }))))(
    'honors $mode capture and explicit frame policy (business group: $grouped)', async ({ mode, grouped }) => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-recording-modes-'));
    const runs = join(root, 'runs');
    const requestsPath = join(root, 'requests.jsonl');
    try {
      await mkdir(join(root, '.fliwright/tests'), { recursive: true });
      await writeFile(join(root, 'vitest.config.mjs'), `export default { root: ${JSON.stringify(root)}, test: {
        include: ['.fliwright/tests/*.test.mjs'], runner: ${JSON.stringify(runner)},
        maxWorkers: 1, minWorkers: 1, reporters: ['dot'], testTimeout: 2000,
      } };`);
      await writeFile(join(root, '.fliwright/tests/modes.test.mjs'), `
        import { appendFile } from 'node:fs/promises';
        import { createFliwrightTest, expect } from ${JSON.stringify(integration)};
        import { expect as check } from 'vitest';
        const mode = ${JSON.stringify(mode)};
        const test = createFliwrightTest({ vmServiceUrl: 'ws://mode-policy', runsRoot: ${JSON.stringify(runs)},
          recording: { mode, failureCaptureBudgetMs: 150 }, log: { format: 'silent' },
        }, { driverProvider: async () => {
          let state = 0;
          return {
            sendRequest: async (method, params) => {
              await appendFile(${JSON.stringify(requestsPath)}, JSON.stringify({ method, state }) + '\\n');
              if (method === 'ext.fliwright.action') { state++; return { success: true }; }
              if (method === 'ext.fliwright.resolve') return { matches: JSON.parse(params.selector).match.key === 'saved' && state === 2 ? [{ id: 'saved' }] : [] };
              if (method === 'ext.fliwright.screenshot') return { success: true, screenshot: Buffer.from(String(state)).toString('base64') };
              if (method === 'ext.fliwright.snap') return { snapshot: { state }, refs: [], raw: String(state) };
              if (method === 'ext.fliwright.captureFrame') return { screenshot: { base64: Buffer.from(String(state)).toString('base64') }, snap: { state }, diagnostics: { state } };
              throw new Error('Unexpected request: ' + method);
            },
            getDiagnostics: () => [], healing: { getReports: () => [] }, mock: {}, dispose: async () => {},
          };
        } });
        test('two actions and an assertion', async ({ page, flow }) => {
          const save = async () => {
            await page.getByKey('edit').click();
            await page.getByKey('save').click();
            await expect(page.getByKey('saved')).toBeVisible();
          };
          ${grouped ? "await flow.step('Save changes', save);" : 'await save();'}
          const artifacts = await flow.frame('User requested evidence', { screenshot: true, snapshot: true, diagnostics: true });
          check(artifacts.map((artifact) => artifact.kind)).toEqual(['screenshot', 'snapshot', 'diagnostics']);
        });
        if (mode === 'off') {
          test('failed locator assertion', async ({ page }) => {
            await expect(page.getByKey('missing')).toBeVisible({ timeout: 0 });
          });
          test('failed business step', async ({ flow }) => {
            await flow.step('Rejected', async () => { throw new Error('business rejection'); });
          });
        }
      `);
      // The explicit fixture policy must override the runner's initial default.
      const child = spawn(process.execPath, [cli, 'run', '--config', join(root, 'vitest.config.mjs')], {
        cwd: root, env: { ...process.env, FLIWRIGHT_RUN_ID: 'run-modes', FLIWRIGHT_RUNS_ROOT: runs,
          FLIWRIGHT_RECORDING_MODE: 'standard' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const code = await new Promise<number | null>((resolveCode, reject) => {
        child.once('error', reject); child.once('close', resolveCode);
      });
      expect(code, output).toBe(mode === 'off' ? 1 : 0);
      const attempts = await Promise.all((await readdir(join(runs, 'run-modes/tests'))).map(async (id) => {
        const dir = join(runs, 'run-modes/tests', id, 'attempts/attempt-0');
        return { dir, result: JSON.parse(await readFile(join(dir, 'result.json'), 'utf8')) as RunSessionResult };
      }));
      const attempt = attempts.find(({ result }) => result.testName === 'two actions and an assertion')!;
      expect(attempt.result).toMatchObject({ finalized: true, testOutcome: 'passed', evidenceStatus: mode === 'off' ? 'disabled' : 'complete' });
      const requests = (await readFile(requestsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { method: string; state: number });
      expect(requests.filter(({ method }) => method === 'ext.fliwright.action')).toHaveLength(2);
      expect(requests.filter(({ method }) => method === 'ext.fliwright.screenshot').map(({ state }) => state))
        .toEqual(mode === 'standard' ? [0, 1, 2, 2, 2] : mode === 'full' ? [0, 0, 1, 1, 2, 2, 2] : [2]);
      expect(requests.filter(({ method }) => method === 'ext.fliwright.snap').map(({ state }) => state))
        .toEqual(mode === 'full' ? [0, 1, 2] : [2]);
      expect(requests.filter(({ method }) => method === 'ext.fliwright.captureFrame')).toHaveLength(1);
      const explicit = attempt.result.evidence.filter(({ reason }) => reason === 'explicit');
      expect(explicit.map(({ kind }) => kind)).toEqual(['screenshot', 'snapshot', 'diagnostics']);
      for (const entry of explicit) {
        expect(entry.result.status).toBe('captured');
        const content = await readFile(join(attempt.dir, entry.result.artifactPaths![0]), 'utf8');
        expect(content).toContain('2');
      }
      if (mode === 'off') {
        for (const { dir, result } of attempts) {
          expect(result.operations).toEqual([]);
          expect(result.evidence.every(({ reason }) => reason === 'explicit')).toBe(true);
          expect(result.evidenceStatus).toBe('disabled');
          for (const path of ['timeline.json', 'trace/trace.json', 'events.jsonl']) {
            await expect(readFile(join(dir, path))).rejects.toMatchObject({ code: 'ENOENT' });
          }
        }
        expect(attempts.filter(({ result }) => result.testOutcome === 'failed')).toHaveLength(2);
      } else {
        expect(attempt.result.operations).toHaveLength(2);
        const timeline = JSON.parse(await readFile(join(attempt.dir, 'timeline.json'), 'utf8')) as TimelineData;
        const trace = JSON.parse(await readFile(join(attempt.dir, 'trace/trace.json'), 'utf8')) as TraceData;
        expect(timeline.nodes.filter(({ kind }) => kind === 'action')).toHaveLength(2);
        expect(timeline.nodes.filter(({ kind }) => kind === 'assertion')).toHaveLength(1);
        expect(timeline.nodes.find(({ kind }) => kind === 'frame')?.metadata).toMatchObject({ requestedBy: 'user' });
        if (grouped) {
          const group = timeline.nodes.find(({ title }) => title === 'Save changes')!;
          expect(timeline.nodes.filter(({ kind }) => kind === 'action').map(({ parentId }) => parentId)).toEqual([group.id, group.id]);
        }
        expect(attempt.result.evidence.filter(({ operationId }) => !operationId).map(({ reason }) => reason)).toEqual(['start', 'finish']);
        for (let index = 0; index < 2; index++) {
          const operation = attempt.result.operations[index];
          const evidence = attempt.result.evidence.filter(({ operationId }) => operationId === operation.operationId);
          expect(evidence.map(({ kind, reason }) => [kind, reason])).toEqual(mode === 'full'
            ? [['screenshot', 'start'], ['snapshot', 'start'], ['screenshot', 'finish']]
            : [['screenshot', 'finish']]);
          expect(await readFile(resolve(attempt.dir, 'trace', trace.steps[index].screenshotFile!), 'utf8')).toBe(String(index + 1));
        }
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 15_000);
});
