import { describe, it, expect, vi } from 'vitest';
import { getEventListeners } from 'node:events';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { runCommand, parseVitestOutput, writeRunManifest, type RunOptions } from '../src/commands/run.js';
import { artifactsExportCommand } from '../src/commands/artifacts.js';
import { RunArtifactStore, RunProgressJournal, RunSession, TimelineRecorder } from '@fliwright/core';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

function isolatedEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
  };
}

async function withIsolatedHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), 'fliwright-cli-home-'));
  const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  Object.assign(process.env, isolatedEnv(home));
  try {
    return await fn(home);
  } finally {
    if (prevEnv.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = prevEnv.HOME;
    if (prevEnv.USERPROFILE === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevEnv.USERPROFILE;
    await rm(home, { recursive: true, force: true });
  }
}

describe('runCommand', () => {
  it.each(['canonical manifest', 'report mirror', 'worker recovery'])('retains the original runner failure when %s cannot be written', async (fault) => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-parent-write-failure-'));
    const runsRoot = join(root, 'runs');
    const mirror = join(root, 'mirror.json');
    try {
      if (fault === 'report mirror') await mkdir(mirror);
      await writeFile(join(root, 'parent-write.test.mjs'), `
        import { createFliwrightTest } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest'))};
        import { mkdir, rm } from 'node:fs/promises';
        import { resolve, join } from 'node:path';
        const test = createFliwrightTest({ vmServiceUrl: 'ws://unused', requireAssertions: false,
          recording: { mode: ${JSON.stringify(fault === 'worker recovery' ? 'standard' : 'off')},
            testFinalizationBudgetMs: 150 }, log: { format: 'silent' } });
        test('business failure before parent write', async ({ timeline, task }) => {
          ${fault === 'canonical manifest' ? "await mkdir(join(resolve(timeline.artifactStore.runDir, '../../../..'), 'run.json'));" : ''}
          ${fault === 'worker recovery' ? `const attempt = task[Symbol.for('@fliwright/vitest/active-attempt')];
          timeline.recorder.flushProgress = () => new Promise(() => {});
          attempt.runStore.writeAttemptResult = () => new Promise(() => {});
          attempt.artifactStore.writeTimeline = () => new Promise(() => {});
          const timelinePath = join(timeline.artifactStore.runDir, 'timeline.json');
          await rm(timelinePath, { force: true });
          await mkdir(timelinePath);` : ''}
          throw new Error('original business failure before parent write');
        });
      `);
      let caught: unknown;
      try { await runCommand({ cwd: root, runsRoot, testPattern: 'parent-write.test.mjs', print: false,
        ...(fault === 'report mirror' ? { output: mirror } : {}),
      }, { resolveVmUrl: async () => 'ws://unused' }); } catch (error) { caught = error; }
      expect(caught).toMatchObject({ name: 'RunFinalizationError',
        runnerResult: { passed: false, status: 'failed', failedTests: 1,
          results: [expect.objectContaining({ error: expect.stringContaining('original business failure before parent write') })] },
        runId: expect.any(String), outputDir: expect.stringContaining(runsRoot), cause: expect.any(Error),
      });
      expect((caught as Error).message).toContain('original business failure before parent write');
      expect((caught as Error).message).toMatch(/artifacts.*finaliz/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 15000);

  it('exports explicit user frames in recording off mode without requiring automatic process artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-off-explicit-export-'));
    const runsRoot = join(root, 'runs');
    try {
      await writeFile(join(root, 'explicit.test.mjs'), `
        import { createFliwrightTest } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest'))};
        import { expect } from 'vitest';
        const test = createFliwrightTest({ vmServiceUrl: 'ws://unused', recording: { mode: 'off' },
          log: { format: 'silent' } }, { driverProvider: async () => ({
          sendRequest: async (method) => {
            if (method === 'ext.fliwright.screenshot') return { success: true, screenshot: Buffer.from('explicit page').toString('base64') };
            if (method === 'ext.fliwright.snap') return { snapshot: { page: 'explicit' }, refs: [], raw: 'explicit' };
            return { success: true };
          },
          getDiagnostics: () => [], healing: { getReports: () => [] }, mock: {}, dispose: async () => {},
        }) });
        test('user frame with automatic recording disabled', async ({ page, flow }) => {
          await page.clickAt(1, 2);
          const artifacts = await flow.frame('User frame', { screenshot: true, snapshot: true });
          expect(artifacts).toHaveLength(2);
        });
      `);
      const run = await runCommand({ cwd: root, runsRoot, print: false, testPattern: 'explicit.test.mjs' },
        { resolveVmUrl: async () => 'ws://unused' });
      expect(run).toMatchObject({ passed: true, status: 'passed' });
      const output = join(root, 'portable');
      const exported = await artifactsExportCommand({ runsRoot, runId: run.artifacts!.runId, output });
      expect(exported).toMatchObject({ partial: false, missing: [] });
      await rm(run.artifacts!.outputDir, { recursive: true });
      const manifest = JSON.parse(await readFile(join(output, 'run.json'), 'utf8'));
      expect(manifest).toMatchObject({ status: 'passed', evidenceStatus: 'disabled' });
      const resultPath = join(output, manifest.tests[0].attempts[0].resultPath);
      const result = JSON.parse(await readFile(resultPath, 'utf8'));
      expect(result).toMatchObject({ operations: [], evidenceStatus: 'disabled' });
      expect(result.evidence.map((entry: { reason: string }) => entry.reason)).toEqual(['explicit', 'explicit']);
      for (const entry of result.evidence) {
        await expect(readFile(join(dirname(resultPath), entry.result.artifactPaths[0]), 'utf8')).resolves.toContain('explicit');
      }
      for (const file of ['timeline.json', 'events.jsonl', 'trace/trace.json']) {
        await expect(readFile(join(dirname(resultPath), file))).rejects.toMatchObject({ code: 'ENOENT' });
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 15_000);

  it.each([false, true])('recovers terminal worker facts through the reporter when all worker persistence hangs (body passes: %s)', async (passes) => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-worker-storage-hang-'));
    try {
      await writeFile(join(root, 'blocked.test.mjs'), `
        import { createFliwrightTest } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest'))};
        const test = createFliwrightTest({ vmServiceUrl: 'ws://unused', requireAssertions: false,
          recording: { mode: 'standard', testFinalizationBudgetMs: 150 }, log: { format: 'silent' } });
        test('failed body with blocked storage', async ({ task, timeline }) => {
          await timeline.runSession.perform({ kind: 'raw', title: 'sensitive operation',
            sensitiveValues: ['private-recovery-value'] }, async () => {});
          const attempt = task[Symbol.for('@fliwright/vitest/active-attempt')];
          timeline.recorder.flushProgress = () => new Promise(() => {});
          attempt.runStore.writeAttemptResult = () => new Promise(() => {});
          attempt.artifactStore.writeTimeline = () => new Promise(() => {});
          ${passes ? '' : "throw new Error('original failure before storage outage: private-recovery-value');"}
        });
      `);
      const run = await runCommand({ cwd: root, runsRoot: join(root, 'runs'), print: false, testPattern: 'blocked.test.mjs' },
        { resolveVmUrl: async () => 'ws://unused' });
      expect(run).toMatchObject({ status: passes ? 'passed' : 'failed', passed: passes, totalTests: 1 });
      if (!passes) expect(run.results[0].error).toContain('original failure before storage outage');
      const manifest = JSON.parse(await readFile(run.artifacts!.manifestPath!, 'utf8'));
      expect(manifest).toMatchObject({ status: passes ? 'passed' : 'failed', evidenceStatus: 'partial' });
      const resultPath = join(run.artifacts!.outputDir, manifest.tests[0].attempts[0].resultPath);
      const attempt = JSON.parse(await readFile(resultPath, 'utf8'));
      expect(attempt).toMatchObject({ status: passes ? 'passed' : 'failed', testOutcome: passes ? 'passed' : 'failed',
        finalized: true, evidenceStatus: 'partial' });
      expect(attempt.runnerErrors).toEqual(passes ? [] : [expect.objectContaining({ message: 'original failure before storage outage: <masked>' })]);
      expect(JSON.stringify({ run, attempt })).not.toContain('private-recovery-value');
      expect(attempt.evidenceIssues.join(' ')).toContain('finalization budget');
      const timeline = JSON.parse(await readFile(join(dirname(resultPath), 'timeline.json'), 'utf8'));
      const trace = JSON.parse(await readFile(join(dirname(resultPath), 'trace/trace.json'), 'utf8'));
      expect(timeline.status).toBe(passes ? 'passed' : 'failed');
      expect(trace.meta.status).toBe(passes ? 'passed' : 'failed');
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 15_000);

  it('exports the original failure and partial evidence after the fixture cleanup deadline expires', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-finalization-export-'));
    const runsRoot = join(root, 'runs');
    try {
      await writeFile(join(root, 'deadline.test.mjs'), `
        import { createFliwrightTest } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest'))};
        const test = createFliwrightTest({ vmServiceUrl: 'ws://unused', requireAssertions: false,
          recording: { mode: 'standard', failureCaptureBudgetMs: 90, testFinalizationBudgetMs: 300 },
          log: { format: 'silent' },
        }, { driverProvider: async () => ({
          sendRequest: async (method) => {
            if (method === 'ext.fliwright.screenshot') return { success: true, screenshot: Buffer.from('failure-page').toString('base64') };
            if (method === 'ext.fliwright.snap') return { snapshot: { page: 'failure' }, refs: [], raw: 'failure' };
            if (method === 'ext.fliwright.captureFrame') return { diagnostics: { page: 'failure' } };
            return { success: true };
          },
          getDiagnostics: () => [], healing: { getReports: () => [] }, mock: {},
          dispose: async () => new Promise(() => {}),
        }) });
        test('original failure survives cleanup timeout', async ({ page }) => {
          throw new Error('original business rejection');
        });
      `);
      const run = await runCommand({ cwd: root, runsRoot, print: false, testPattern: 'deadline.test.mjs' },
        { resolveVmUrl: async () => 'ws://unused' });
      expect(run).toMatchObject({ passed: false, status: 'failed', totalTests: 1 });
      expect(run.results[0].error).toContain('original business rejection');
      const runDir = run.artifacts!.outputDir;
      const manifest = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'));
      expect(manifest).toMatchObject({ status: 'failed', evidenceStatus: 'partial' });
      await expect(artifactsExportCommand({ runsRoot, runId: run.artifacts!.runId,
        output: join(root, 'rejected-export') })).rejects.toThrow();
      const output = join(root, 'portable');
      const exported = await artifactsExportCommand({ runsRoot, runId: run.artifacts!.runId, output, allowPartial: true });
      expect(exported.partial).toBe(true);
      await rm(runDir, { recursive: true });
      const portableManifest = JSON.parse(await readFile(join(output, 'run.json'), 'utf8'));
      expect(portableManifest).toMatchObject({ status: 'failed', evidenceStatus: 'partial' });
      const resultPath = join(output, portableManifest.tests[0].attempts[0].resultPath);
      const attempt = JSON.parse(await readFile(resultPath, 'utf8'));
      expect(attempt).toMatchObject({ finalized: true, testOutcome: 'failed', evidenceStatus: 'partial' });
      expect(attempt.evidenceIssues).toEqual(expect.arrayContaining([expect.stringContaining('Driver cleanup exceeded')]));
      expect(attempt.runnerErrors).toEqual([expect.objectContaining({ message: 'original business rejection' })]);
      const timeline = JSON.parse(await readFile(join(dirname(resultPath), 'timeline.json'), 'utf8'));
      const trace = JSON.parse(await readFile(join(dirname(resultPath), 'trace/trace.json'), 'utf8'));
      expect(timeline.status).toBe('failed');
      expect(trace.meta.status).toBe('failed');
      const failure = timeline.nodes.find((node: { kind: string }) => node.kind === 'failure');
      const screenshot = failure.artifacts.find((artifact: { kind: string }) => artifact.kind === 'screenshot');
      await expect(readFile(join(dirname(resultPath), screenshot.path), 'utf8')).resolves.toBe('failure-page');
      const portableReport = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
      expect(portableReport.results[0].error).toContain('original business rejection');
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 15_000);

  it.each([false, true])('retains final runner outcome when the journal becomes unwritable (body failure: %s)', async (bodyFailure) => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-journal-disk-failure-'));
    try {
      await writeFile(join(root, 'disk.test.mjs'), `
        import { createFliwrightTest } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest'))};
        import { mkdir, rm } from 'node:fs/promises';
        import { join } from 'node:path';
        const test = createFliwrightTest({ vmServiceUrl: 'ws://unused', requireAssertions: false, recording: { mode: 'standard' } });
        test('runner outcome survives disk error', async ({ timeline }) => {
          const log = join(timeline.artifactStore.runDir, 'events.jsonl');
          await rm(log);
          await mkdir(log);
          ${bodyFailure ? "throw new Error('original body failure');" : ''}
        });
      `);
      const result = await runCommand({ cwd: root, runsRoot: join(root, 'runs'), print: false, testPattern: 'disk.test.mjs' },
        { resolveVmUrl: async () => 'ws://unused' });
      expect(result.passed).toBe(!bodyFailure);
      expect(result.status).toBe(bodyFailure ? 'failed' : 'passed');
      if (bodyFailure) expect(result.results[0].error).toContain('original body failure');
      const manifest = JSON.parse(await readFile(result.artifacts!.manifestPath!, 'utf8'));
      expect(manifest.evidenceStatus).toBe('partial');
      const attempt = JSON.parse(await readFile(join(result.artifacts!.outputDir, manifest.tests[0].attempts[0].resultPath), 'utf8'));
      expect(attempt.testOutcome).toBe(bodyFailure ? 'failed' : 'passed');
      expect(attempt.evidenceIssues.join(' ')).toContain('journal');
      const exported = await artifactsExportCommand({ runsRoot: join(root, 'runs'), runId: result.artifacts!.runId,
        output: join(root, 'partial-export'), allowPartial: true });
      expect(exported.partial).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it.each([false, true])('recovers an expected failure from its journal only when final task outcome is committed (%s)', async (finalized) => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-final-journal-'));
    try {
      const identity = { runId: 'r', testId: '-task-id', attemptId: 'attempt-0' };
      const store = new RunArtifactStore({ runsRoot: root, runId: 'r' });
      const journal = new RunProgressJournal(store, identity.testId, identity.attemptId);
      const recorder = new TimelineRecorder({ runId: 'r', testName: 'expected' });
      const session = new RunSession({ ...identity, testName: 'expected', recorder, recordingMode: 'standard' });
      await session.perform({ kind: 'assertion', title: 'observed failure' }, async () => { throw new Error('expected'); }).catch(() => {});
      const result = await session.finish({ status: 'failed', evidenceStatus: 'complete' });
      result.expectedFailure = true;
      result.testOutcome = 'passed';
      await journal.append(result, recorder.complete('passed'), finalized);
      const manifestPath = await writeRunManifest({ runsRoot: root, runId: 'r', runDir: store.runDir });
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      expect(manifest.status).toBe(finalized ? 'passed' : 'interrupted');
      expect(manifest.tests[0].testId).toBe(identity.testId);
      const repaired = JSON.parse(await readFile(join(store.runDir, manifest.tests[0].attempts[0].resultPath), 'utf8'));
      expect(repaired.operations[0].outcome).toBe('failed');
      expect(repaired.attemptOutcome).toBe(finalized ? 'failed' : 'interrupted');
      expect(repaired.testOutcome).toBe(finalized ? 'passed' : 'interrupted');
      expect(repaired.evidenceStatus).toBe(finalized ? 'complete' : 'partial');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('flushes an active run when its CLI parent receives an OS SIGINT', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-os-sigint-'));
    const startedPath = join(root, 'started.json');
    const completedPath = join(root, 'completed.json');
    await writeFile(join(root, 'hang.test.mjs'), `
      import { test } from 'vitest';
      import { writeFile } from 'node:fs/promises';
      test('active when interrupted', async () => {
        await writeFile(${JSON.stringify(startedPath)}, JSON.stringify({ pid: process.pid }));
        await new Promise(() => {});
      });
    `);
    const entry = new URL('../dist/commands/run.js', import.meta.url).href;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', `
      import { runCommand } from ${JSON.stringify(entry)};
      import { writeFile } from 'node:fs/promises';
      const listeners = process.listenerCount('SIGINT');
      const run = await runCommand({ cwd: ${JSON.stringify(root)}, runsRoot: ${JSON.stringify(join(root, 'runs'))},
        testPattern: 'hang.test.mjs', print: false }, { resolveVmUrl: async () => 'ws://unused' });
      await writeFile(${JSON.stringify(completedPath)}, JSON.stringify({ run,
        listenersRestored: process.listenerCount('SIGINT') === listeners }));
    `], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostics = '';
    child.stdout.on('data', (chunk) => { diagnostics += String(chunk); });
    child.stderr.on('data', (chunk) => { diagnostics += String(chunk); });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    try {
      let workerPid = 0;
      await vi.waitFor(async () => {
        workerPid = JSON.parse(await readFile(startedPath, 'utf8')).pid;
        expect(workerPid).toBeGreaterThan(0);
      }, { timeout: 10_000 });
      const cancelledAt = Date.now();
      expect(child.kill('SIGINT')).toBe(true);
      const completed = await exited;
      expect(completed, diagnostics).toEqual({ code: 0, signal: null });
      expect(Date.now() - cancelledAt).toBeLessThan(8_000);
      const { run, listenersRestored } = JSON.parse(await readFile(completedPath, 'utf8'));
      expect(listenersRestored).toBe(true);
      expect(run).toMatchObject({ status: 'interrupted', passed: false });
      const manifest = JSON.parse(await readFile(run.artifacts.manifestPath, 'utf8'));
      expect(manifest).toMatchObject({ status: 'interrupted', evidenceStatus: 'partial' });
      expect(manifest.tests).toHaveLength(1);
      await vi.waitFor(() => { expect(() => process.kill(workerPid, 0)).toThrow(); }, { timeout: 5_000 });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('exports canonical evidence independently of an external --output report mirror', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-report-mirror-'));
    try {
      await writeFile(join(root, 'pass.test.mjs'), "import { test } from 'vitest'; test('passes', () => {});");
      const mirrorPath = join(root, 'external/report.json');
      const runsRoot = join(root, 'runs');
      const result = await runCommand({ cwd: root, runsRoot, output: mirrorPath,
        testPattern: 'pass.test.mjs', print: false }, { resolveVmUrl: async () => 'ws://unused' });
      expect(result.passed).toBe(true);
      const canonicalPath = join(result.artifacts!.outputDir, 'report.json');
      const canonical = JSON.parse(await readFile(canonicalPath, 'utf8'));
      expect(canonical.artifacts.reportPath).toBe(canonicalPath);
      const mirror = JSON.parse(await readFile(mirrorPath, 'utf8'));
      expect(mirror.artifacts.outputDir).toBe(result.artifacts!.outputDir);
      await rm(mirrorPath);
      const output = join(root, 'export');
      expect((await artifactsExportCommand({ runsRoot, runId: result.artifacts!.runId, output })).partial).toBe(false);
      await rm(result.artifacts!.outputDir, { recursive: true });
      const portable = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
      expect(portable.artifacts.reportPath).toBe('report.json');
      expect(portable.artifacts.outputDir).toBe('.');
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);
  it.each([false, true])('recovers flushed action and screenshot evidence after worker kill (damaged snapshots: %s)', async (damageSnapshots) => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-progress-crash-'));
    const runsRoot = join(root, 'runs');
    try {
      await writeFile(join(root, 'vitest.config.mjs'), `export default { root: ${JSON.stringify(root)}, test: { maxWorkers: 1 } };`);
      await writeFile(join(root, 'crash.test.mjs'), `
        import { createFliwrightTest } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest'))};
        import { appendFile, readdir, writeFile } from 'node:fs/promises';
        import { join } from 'node:path';
        let clicks = 0;
        const driver = { mock: {}, page: {}, healing: { getReports: () => [] }, getDiagnostics: () => [],
          sendRequest: async (method) => {
            if (method === 'ext.fliwright.click' && ++clicks === 2) {
              if (${damageSnapshots}) {
                const runDir = join(${JSON.stringify(runsRoot)}, process.env.FLIWRIGHT_RUN_ID);
                for (const file of await readdir(runDir, { recursive: true })) {
                  if (file.endsWith('result.json') || file.endsWith('timeline.json')) await writeFile(join(runDir, file), '{damaged snapshot');
                  if (file.endsWith('events.jsonl') && !file.includes('logs/')) await appendFile(join(runDir, file), '{"unfinished":');
                }
              }
              process.kill(process.pid, 'SIGKILL');
            }
            if (method === 'ext.fliwright.screenshot') return { success: true, screenshot: Buffer.from('before-crash').toString('base64') };
            if (method === 'ext.fliwright.snap') return { snapshot: {}, refs: [], raw: '' };
            return { success: true };
          },
        };
        const test = createFliwrightTest({ vmServiceUrl: 'ws://unused', runsRoot: ${JSON.stringify(runsRoot)},
          recording: { mode: 'standard' }, log: { format: 'silent' }, requireAssertions: false,
        }, { driverProvider: async () => driver });
        test('save then worker disappears', async ({ page }) => {
          await page.clickAt(1, 2);
          await page.clickAt(3, 4);
        });
      `);
      const result = await runCommand({ cwd: root, runsRoot, testPattern: 'crash.test.mjs', print: false,
      }, { resolveVmUrl: async () => 'ws://unused' });
      expect(result.status).toBe('interrupted');
      const manifest = JSON.parse(await readFile(result.artifacts!.manifestPath!, 'utf8'));
      const resultPath = join(result.artifacts!.outputDir, manifest.tests[0].attempts[0].resultPath);
      const attempt = JSON.parse(await readFile(resultPath, 'utf8'));
      const eventsPath = join(dirname(resultPath), 'events.jsonl');
      const eventLines = (await readFile(eventsPath, 'utf8')).trimEnd().split('\n');
      expect(eventLines.length).toBeGreaterThan(2);
      if (damageSnapshots) expect(attempt.evidenceIssues.join(' ')).toMatch(/trailing line/i);
      expect(attempt.operations, JSON.stringify(attempt)).toContainEqual(expect.objectContaining({ kind: 'action', outcome: 'passed' }));
      expect(attempt.operations).toContainEqual(expect.objectContaining({ title: 'Click at (3, 4)', outcome: 'interrupted' }));
      expect(attempt.operations.some((operation: any) => operation.outcome === 'running')).toBe(false);
      const evidence = attempt.evidence.find((entry: any) => entry.kind === 'screenshot' && entry.reason === 'finish');
      expect(evidence?.result.status).toBe('captured');
      expect(await readFile(join(dirname(resultPath), evidence.result.artifactPaths[0]), 'utf8')).toBe('before-crash');
      const timeline = JSON.parse(await readFile(join(dirname(resultPath), 'timeline.json'), 'utf8'));
      expect(timeline.status).toBe('interrupted');
      expect(timeline.nodes).toContainEqual(expect.objectContaining({ kind: 'action', status: 'passed' }));
      expect(timeline.nodes).toContainEqual(expect.objectContaining({ title: 'Click at (3, 4)', status: 'interrupted' }));
      const trace = JSON.parse(await readFile(join(dirname(resultPath), 'trace/trace.json'), 'utf8'));
      expect(trace.meta.status).toBe('interrupted');
      expect(trace.steps.map((step: any) => step.status)).toEqual(['pass', 'interrupted']);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it.each(['flow', 'mock', 'ai'])('recovers independent %s node boundaries after immediate worker kill', async (kind) => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-node-crash-'));
    const runsRoot = join(root, 'runs');
    try {
      await writeFile(join(root, 'vitest.config.mjs'), `export default { root: ${JSON.stringify(root)}, test: { maxWorkers: 1 } };`);
      await writeFile(join(root, 'crash.test.mjs'), `
        import { createFliwrightTest } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest'))};
        import { FlowRuntime, MockRuntime, AgentRuntime } from ${JSON.stringify(import.meta.resolve('@fliwright/core'))};
        import { readdir, writeFile } from 'node:fs/promises';
        import { join } from 'node:path';
        const test = createFliwrightTest({ vmServiceUrl: '', runsRoot: ${JSON.stringify(runsRoot)},
          log: { format: 'silent' }, requireAssertions: false });
        test('independent nodes', async ({ timeline }) => {
          const crash = async () => {
            const runDir = join(${JSON.stringify(runsRoot)}, process.env.FLIWRIGHT_RUN_ID);
            for (const file of await readdir(runDir, { recursive: true })) {
              if (file.endsWith('result.json') || file.endsWith('timeline.json')) await writeFile(join(runDir, file), '{broken');
            }
            process.kill(process.pid, 'SIGKILL');
          };
          const flow = new FlowRuntime({ recorder: timeline.recorder });
          let calls = 0;
          const mock = new MockRuntime({ clearCalls: async () => { if (++calls === 2) await crash(); } }, timeline.recorder);
          const agent = new AgentRuntime({ recorder: timeline.recorder,
            aiRuntime: { visibleWithMetadata: async () => { if (++calls === 2) await crash(); return {}; } } });
          if (${JSON.stringify(kind)} === 'flow') await flow.step('Completed independent flow', () => {});
          if (${JSON.stringify(kind)} === 'mock') await mock.clearCalls();
          if (${JSON.stringify(kind)} === 'ai') await agent.verify('Completed independent AI');
          if (${JSON.stringify(kind)} === 'flow') await flow.step('Unfinished independent flow', crash);
          if (${JSON.stringify(kind)} === 'mock') await mock.clearCalls();
          if (${JSON.stringify(kind)} === 'ai') await agent.verify('Unfinished independent AI');
        });
      `);
      const result = await runCommand({ cwd: root, runsRoot, testPattern: 'crash.test.mjs', print: false,
      }, { resolveVmUrl: async () => 'ws://unused' });
      expect(result.status).toBe('interrupted');
      const manifest = JSON.parse(await readFile(result.artifacts!.manifestPath!, 'utf8'));
      const resultPath = join(result.artifacts!.outputDir, manifest.tests[0].attempts[0].resultPath);
      const timeline = JSON.parse(await readFile(join(dirname(resultPath), 'timeline.json'), 'utf8'));
      expect(timeline.nodes).toContainEqual(expect.objectContaining({ kind: kind === 'flow' ? 'step' : kind === 'ai' ? 'ai-call' : 'mock', status: 'passed' }));
      const unfinished = kind === 'flow' ? 'Unfinished independent flow' : kind === 'ai' ? 'Unfinished independent AI' : 'Mock clear calls';
      expect(timeline.nodes).toContainEqual(expect.objectContaining({ title: unfinished, status: 'interrupted' }));
      const events = (await readFile(join(dirname(resultPath), 'events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      expect(events.flatMap((event) => event.nodes)).toContainEqual(expect.objectContaining({ title: unfinished, status: 'running' }));
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it.each([undefined, 'full'] as const)('applies shared paths and environment priority to a real run (explicit mode: %s)', async (explicitMode) => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-shared-config-'));
    try {
      vi.stubEnv('FLIWRIGHT_RECORDING_MODE', 'off');
      vi.stubEnv('FLIWRIGHT_RUNS_ROOT', join(root, 'environment-runs'));
      await mkdir(join(root, 'checks'));
      await writeFile(join(root, 'fliwright.config.ts'), `export default { paths: { tests: 'checks' },
        runsRoot: ${JSON.stringify(join(root, 'project-runs'))}, recording: {
          mode: 'standard', requireAssertions: false, testFinalScreenshots: false,
          failureCaptureBudgetMs: 1234, testFinalizationBudgetMs: 4567,
        } };`);
      await writeFile(join(root, 'vitest.config.mjs'), `
        import { fliwrightPreset } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest/preset'))};
        export default { test: { ...fliwrightPreset({ recording: { mode: 'standard', failureCaptureBudgetMs: 9999 } }).test, maxWorkers: 1 } };
      `);
      await writeFile(join(root, 'checks/config.test.ts'), `
        import { test } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest'))};
        import { strict as assert } from 'node:assert';
        test('shared fixture config', async ({ timeline }) => {
          const config = JSON.parse(process.env.FLIWRIGHT_CONFIG);
          assert.equal(config.recording.mode, ${JSON.stringify(explicitMode ?? 'off')});
          assert.equal(config.recording.requireAssertions, false);
          assert.equal(config.recording.testFinalScreenshots, false);
          assert.equal(config.recording.failureCaptureBudgetMs, 1234);
          assert.equal(config.recording.testFinalizationBudgetMs, 4567);
          assert.equal(config.paths.tests, 'checks');
          assert.equal(config.scenarioMode, 'managed-start');
        });
      `);
      const result = await runCommand({ cwd: root, recordingMode: explicitMode, scenarioMode: 'managed-start', print: false,
      }, { resolveVmUrl: async () => 'ws://unused' });
      expect(result.passed, JSON.stringify(result)).toBe(true);
      expect(result.totalTests).toBe(1);
      expect(result.artifacts!.outputDir).toContain(join(root, 'environment-runs'));
      const manifest = JSON.parse(await readFile(result.artifacts!.manifestPath!, 'utf8'));
      const attempt = JSON.parse(await readFile(join(result.artifacts!.outputDir, manifest.tests[0].attempts[0].resultPath), 'utf8'));
      expect(attempt.evidenceStatus).toBe(explicitMode ? 'complete' : 'disabled');
    } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it('repairs incomplete attempts before writing an interrupted run manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-interrupted-manifest-'));
    const runId = 'run-interrupted';
    const runDir = join(root, runId);
    const missingResultDir = join(runDir, 'tests', 'test-missing', 'attempts', 'attempt-0');
    const runningResultDir = join(runDir, 'tests', 'test-running', 'attempts', 'attempt-1');
    const malformedResultDir = join(runDir, 'tests', 'test-malformed', 'attempts', 'attempt-2');
    const corruptResultDir = join(runDir, 'tests', 'test-corrupt', 'attempts', 'attempt-3');
    await mkdir(missingResultDir, { recursive: true });
    await mkdir(runningResultDir, { recursive: true });
    await mkdir(malformedResultDir, { recursive: true });
    await mkdir(corruptResultDir, { recursive: true });
    await writeFile(join(runningResultDir, 'result.json'), JSON.stringify({
      runId,
      testId: 'test-running',
      attemptId: 'attempt-1',
      status: 'running',
      testOutcome: 'running',
      operations: [{ kind: 'action', name: 'tap' }],
    }));
    await writeFile(join(malformedResultDir, 'result.json'), JSON.stringify({ status: 'failed' }));
    await writeFile(join(corruptResultDir, 'result.json'), '{"status":');

    try {
      const manifestPath = await writeRunManifest({
        runsRoot: root,
        runId,
        runDir,
        runStatus: 'interrupted',
      });
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        status: string;
        evidenceStatus: string;
        tests: Array<{ testId: string; attempts: Array<{ attemptId: string; resultPath: string }> }>;
      };
      expect(manifest.status).toBe('interrupted');
      expect(manifest.evidenceStatus).toBe('partial');
      expect(manifest.tests.map((test) => test.testId).sort()).toEqual(['test-corrupt', 'test-malformed', 'test-missing', 'test-running']);

      for (const attempt of manifest.tests.flatMap((test) => test.attempts)) {
        const result = JSON.parse(await readFile(join(runDir, attempt.resultPath), 'utf8')) as Record<string, unknown>;
        expect(result.status).toBe('interrupted');
        expect(result.attemptOutcome).toBe('interrupted');
        expect(result.testOutcome).toBe('interrupted');
        expect(result.evidenceStatus).toBe('partial');
      }

      const runningResult = JSON.parse(await readFile(join(runningResultDir, 'result.json'), 'utf8')) as Record<string, unknown>;
      expect(runningResult.operations).toEqual([{ kind: 'action', name: 'tap' }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('derives a failed manifest from runner errors when no task result exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-run-error-manifest-'));
    try {
      const manifestPath = await writeRunManifest({
        runsRoot: root,
        runId: 'run-collection-error',
        runDir: join(root, 'run-collection-error'),
        runnerErrors: [{ phase: 'collection', message: 'module refused' }],
      });
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        status: string;
        runnerErrors: Array<{ phase: string; message: string }>;
        tests: unknown[];
      };
      expect(manifest.status).toBe('failed');
      expect(manifest.runnerErrors).toEqual([{ phase: 'collection', message: 'module refused' }]);
      expect(manifest.tests).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('throws with friendly message when VM URL cannot be resolved', async () => {
    const options: RunOptions = {
      testPattern: 'tests/example.test.ts',
      reporter: 'pretty',
    };

    await withIsolatedHome(async () => {
      await expect(runCommand(options, {
        resolveVmUrl: async () => null,
      })).rejects.toThrow('Could not find a running Flutter VM Service');
    });
  });

  it('passes vmServiceUrl through deps and runs vitest', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'fliwright-cli-run-'));
    await writeFile(join(tmpDir, 'pass.test.ts'), [
      "import { describe, expect, it } from 'vitest';",
      "describe('cli fixture', () => {",
      "  it('passes', () => { expect(1).toBe(1); });",
      "});",
    ].join('\n'));

    let capturedUrl: string | undefined;
    const result = await withIsolatedHome(async (home) => {
      const runResult = await runCommand({
        testPattern: 'pass.test.ts',
        reporter: 'json',
        cwd: tmpDir,
      }, {
        resolveVmUrl: async () => 'ws://mock-vm:8181/ws',
        onVmResolved: (url) => { capturedUrl = url; },
      });
      expect(runResult.artifacts!.outputDir).toContain(join(tmpDir, '.fliwright/runs'));
      await expect(stat(runResult.artifacts!.reportPath!)).resolves.toBeDefined();
      return runResult;
    });

    expect(capturedUrl).toBe('ws://mock-vm:8181/ws');
    expect(result.passed).toBe(true);
    expect(result.totalTests).toBe(1);
    expect(result.artifacts?.reportPath).toBeDefined();
    expect(result.artifacts!.outputDir).toContain(join(tmpDir, '.fliwright', 'runs'));

    await rm(tmpDir, { recursive: true, force: true });
  });

  it('uses runsRoot from fliwright.config.ts', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'fliwright-cli-config-runs-'));
    const configuredRunsRoot = join(tmpDir, 'configured-runs');
    await writeFile(join(tmpDir, 'fliwright.config.ts'), [
      'export default {',
      `  runsRoot: ${JSON.stringify(configuredRunsRoot)},`,
      '};',
    ].join('\n'));
    await writeFile(join(tmpDir, 'pass.test.ts'), [
      "import { describe, expect, it } from 'vitest';",
      "describe('cli fixture', () => {",
      "  it('passes', () => { expect(process.env.FLIWRIGHT_RUNS_ROOT).toBe(" + JSON.stringify(configuredRunsRoot) + "); });",
      "});",
    ].join('\n'));

    const result = await withIsolatedHome(async () => runCommand({
      testPattern: 'pass.test.ts',
      reporter: 'json',
      cwd: tmpDir,
      print: false,
    }, {
      resolveVmUrl: async () => 'ws://mock-vm:8181/ws',
    }));

    expect(result.passed).toBe(true);
    expect(result.artifacts!.outputDir).toContain(configuredRunsRoot);
    expect(result.artifacts!.outputDir).not.toContain(join(tmpDir, '.fliwright', 'runs'));

    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes a parent-merged run manifest for runner attempts', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'fliwright-cli-manifest-run-'));
    await writeFile(join(tmpDir, 'vitest.config.mjs'), `
      export default {
        root: ${JSON.stringify(tmpDir)},
        test: {
          include: ['manifest.test.mjs'],
          reporters: ['dot'],
          maxWorkers: 2,
          minWorkers: 1,
        },
      };
    `);
    await writeFile(join(tmpDir, 'manifest.test.mjs'), [
      "import { expect, test } from 'vitest';",
      "test('manifest pass', () => expect(true).toBe(true));",
      "test.fails('manifest expected failure', () => { throw new Error('expected'); });",
      "test('manifest fail', () => expect(true).toBe(false));",
    ].join('\n'));

    try {
      await withIsolatedHome(async () => {
        const result = await runCommand({
          testPattern: '*.test.mjs',
          reporter: 'json',
          cwd: tmpDir,
          print: false,
        }, { resolveVmUrl: async () => 'ws://mock-vm:8181/ws' });

        expect(result.passed).toBe(false);
        expect(result.artifacts?.manifestPath).toBeDefined();
        const manifest = JSON.parse(await readFile(result.artifacts!.manifestPath!, 'utf8')) as {
          status: string;
          tests: Array<{ testId: string; attempts: Array<{ resultPath: string }> }>;
        };
        expect(manifest.status).toBe('failed');
        expect(manifest.tests).toHaveLength(3);
        expect(manifest.tests.flatMap((entry) => entry.attempts)).toHaveLength(3);
        for (const attempt of manifest.tests.flatMap((entry) => entry.attempts)) {
          await expect(stat(join(result.artifacts!.outputDir, attempt.resultPath))).resolves.toBeDefined();
        }
        const report = JSON.parse(await readFile(result.artifacts!.reportPath!, 'utf8')) as typeof result;
        expect(report.artifacts?.manifestPath).toBe(result.artifacts!.manifestPath);
      });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('keeps same-named tests from separate multi-worker files in distinct canonical attempts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-same-name-workers-'));
    const runsRoot = join(root, 'runs');
    await writeFile(join(root, 'vitest.config.mjs'), `
      export default {
        root: ${JSON.stringify(root)},
        test: {
          include: ['*.test.mjs'],
          reporters: ['dot'],
          maxWorkers: 2,
          minWorkers: 2,
        },
      };
    `);
    await writeFile(join(root, 'first.test.mjs'), `
      import { expect, test } from 'vitest';
      test('same title', () => expect('first').toBe('first'));
    `);
    await writeFile(join(root, 'second.test.mjs'), `
      import { expect, test } from 'vitest';
      test('same title', () => expect('second').toBe('not-second'));
    `);

    try {
      const result = await withIsolatedHome(async () => runCommand({
        cwd: root,
        runsRoot,
        testPattern: '*.test.mjs',
        print: false,
      }, { resolveVmUrl: async () => 'ws://mock-vm:8181/ws' }));
      expect(result.status).toBe('failed');
      const manifest = JSON.parse(await readFile(result.artifacts!.manifestPath!, 'utf8')) as {
        status: string;
        tests: Array<{ testId: string; attempts: Array<{ attemptId: string; resultPath: string }> }>;
      };
      expect(manifest.status).toBe('failed');
      expect(manifest.tests).toHaveLength(2);
      expect(manifest.tests.map((entry) => entry.testId)).not.toEqual(['same title', 'same title']);
      const attempts = await Promise.all(manifest.tests.flatMap((entry) => entry.attempts).map(async (attempt) => ({
        ...attempt,
        result: JSON.parse(await readFile(join(result.artifacts!.outputDir, attempt.resultPath), 'utf8')) as {
          testId: string; testName: string; testOutcome: string; status: string;
        },
      })));
      expect(attempts).toHaveLength(2);
      expect(new Set(attempts.map((attempt) => attempt.result.testId)).size).toBe(2);
      expect(attempts.map((attempt) => attempt.result.testName)).toEqual(['same title', 'same title']);
      expect(attempts.map((attempt) => attempt.result.testOutcome).sort()).toEqual(['failed', 'passed']);
      for (const attempt of attempts) {
        expect(attempt.result.status).toBe(attempt.result.testOutcome);
        await expect(stat(join(result.artifacts!.outputDir, attempt.resultPath))).resolves.toBeDefined();
      }
      const report = JSON.parse(await readFile(result.artifacts!.reportPath!, 'utf8')) as {
        status: string;
        results: Array<{ name: string; passed: boolean }>;
      };
      expect(report.status).toBe('failed');
      expect(report.results.filter((entry) => entry.name === 'same title')).toHaveLength(2);
      expect(report.results.map((entry) => entry.passed).sort()).toEqual([false, true]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('repairs a worker-killed attempt into an interrupted partial result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-worker-crash-'));
    const runsRoot = join(root, 'runs');
    await writeFile(join(root, 'crash.test.mjs'), `
      import { test } from 'vitest';
      test('worker disappears', () => process.kill(process.pid, 'SIGKILL'));
    `);
    try {
      const result = await withIsolatedHome(async () => runCommand({
        cwd: root,
        runsRoot,
        testPattern: 'crash.test.mjs',
        print: false,
      }, { resolveVmUrl: async () => 'ws://mock-vm:8181/ws' }));
      const manifest = JSON.parse(await readFile(result.artifacts!.manifestPath!, 'utf8')) as {
        status: string;
        evidenceStatus: string;
        runnerErrors?: Array<{ phase: string; message: string }>;
        tests: Array<{ attempts: Array<{ resultPath: string }> }>;
      };
      expect(result.status).toBe('interrupted');
      expect(manifest.status).toBe('interrupted');
      expect(manifest.evidenceStatus).toBe('partial');
      expect(manifest.runnerErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ phase: 'unhandled', message: expect.stringContaining('Worker forks emitted error') }),
        expect.objectContaining({ phase: 'process' }),
      ]));
      const attempt = manifest.tests.flatMap((test) => test.attempts)[0];
      const repaired = JSON.parse(await readFile(join(result.artifacts!.outputDir, attempt.resultPath), 'utf8'));
      expect(repaired).toMatchObject({ status: 'interrupted', attemptOutcome: 'interrupted', testOutcome: 'interrupted', evidenceStatus: 'partial' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it.skipIf(process.platform === 'win32')('cancels runner descendants retaining active TCP connections', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-abort-connected-'));
    const controller = new AbortController();
    const marker = join(root, 'worker');
    const peers = new Set<import('node:net').Socket>();
    const server = createServer((peer) => {
      peers.add(peer);
      peer.on('close', () => peers.delete(peer));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as import('node:net').AddressInfo).port;
    let workerPid = 0;
    try {
      await writeFile(join(root, 'vitest.config.mjs'), 'export default { test: { maxWorkers: 1 } };');
      await writeFile(join(root, 'connected.test.mjs'), `
        import { test } from 'vitest';
        import { spawn } from 'node:child_process';
        test('connected descendant', async () => {
          spawn(process.execPath, ['--input-type=module', '--eval', ${JSON.stringify(`
            import { connect } from 'node:net';
            import { writeFile } from 'node:fs/promises';
            const socket = connect(${port}, '127.0.0.1');
            socket.once('connect', () => { void writeFile(${JSON.stringify(marker)}, String(process.pid)); });
          `)}], { stdio: 'ignore' });
          await new Promise(() => {});
        });
      `);
      const running = runCommand({ cwd: root, runsRoot: join(root, 'runs'), print: false,
        testPattern: 'connected.test.mjs', signal: controller.signal },
      { resolveVmUrl: async () => 'ws://unused' });
      try {
        await vi.waitFor(async () => {
          workerPid = Number(await readFile(marker, 'utf8'));
          expect(workerPid).toBeGreaterThan(0);
        }, { timeout: 10000 });
      } finally { controller.abort(); }
      expect((await running).status).toBe('interrupted');
      await vi.waitFor(() => {
        expect(() => process.kill(workerPid, 0)).toThrow();
        expect(peers.size).toBe(0);
      }, { timeout: 2000 });
    } finally {
      controller.abort();
      if (workerPid) { try { process.kill(workerPid, 'SIGKILL'); } catch {} }
      for (const peer of peers) peer.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  }, 20000);

  it.each(['AbortSignal', 'SIGINT'] as const)('cancels an active child via %s and cleans up listeners and workers', async (method) => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-abort-'));
    const runsRoot = join(root, 'runs');
    const controller = new AbortController();
    const startedPath = join(root, 'started.json');
    await writeFile(join(root, 'hang.test.mjs'), `
      import { test } from 'vitest';
      import { writeFile } from 'node:fs/promises';
      test('hangs until cancellation', async () => {
        await writeFile(${JSON.stringify(startedPath)}, JSON.stringify({ pid: process.pid }));
        await new Promise(() => {});
      });
    `);
    try {
      const sigintListeners = process.listeners('SIGINT');
      const abortListeners = getEventListeners(controller.signal, 'abort');
      let workerPid = 0;
      const result = await withIsolatedHome(async () => {
        const running = runCommand({ cwd: root, runsRoot, testPattern: 'hang.test.mjs', print: false,
          signal: controller.signal }, { resolveVmUrl: async () => 'ws://mock-vm:8181/ws' });
        try {
          await vi.waitFor(async () => {
            workerPid = JSON.parse(await readFile(startedPath, 'utf8')).pid;
            expect(workerPid).toBeGreaterThan(0);
          }, { timeout: 10_000 });
          const cancelledAt = Date.now();
          if (method === 'AbortSignal') controller.abort();
          else process.emit('SIGINT');
          const completed = await running;
          expect(Date.now() - cancelledAt).toBeLessThan(8_000);
          return completed;
        } finally {
          controller.abort();
          await running;
        }
      });
      expect(result.status).toBe('interrupted');
      expect(result.passed).toBe(false);
      expect(process.listeners('SIGINT')).toEqual(sigintListeners);
      expect(getEventListeners(controller.signal, 'abort')).toEqual(abortListeners);
      const manifest = JSON.parse(await readFile(result.artifacts!.manifestPath!, 'utf8'));
      expect(manifest.status).toBe('interrupted');
      expect(manifest.runnerErrors).toEqual(expect.arrayContaining([
        expect.objectContaining({ phase: 'process', message: 'Vitest run interrupted by cancellation.' }),
      ]));
      expect(manifest.tests).toHaveLength(1);
      const attempt = manifest.tests[0].attempts[0];
      const repaired = JSON.parse(await readFile(join(result.artifacts!.outputDir, attempt.resultPath), 'utf8'));
      expect(repaired).toMatchObject({ status: 'interrupted', attemptOutcome: 'interrupted',
        testOutcome: 'interrupted', evidenceStatus: 'partial' });
      await vi.waitFor(() => {
        expect(() => process.kill(workerPid, 0)).toThrow();
      }, { timeout: 5_000 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('keeps a suite failure failed when no task attempt can finish', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-suite-failure-'));
    const runsRoot = join(root, 'runs');
    await writeFile(join(root, 'suite.test.mjs'), `
      import { beforeAll, test } from 'vitest';
      beforeAll(() => { throw new Error('suite setup failed'); });
      test('blocked by suite setup', () => {});
    `);
    try {
      const result = await withIsolatedHome(async () => runCommand({
        cwd: root,
        runsRoot,
        testPattern: 'suite.test.mjs',
        print: false,
      }, { resolveVmUrl: async () => 'ws://mock-vm:8181/ws' }));
      expect(result.passed).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.runnerErrors).toContainEqual(expect.objectContaining({ message: 'suite setup failed' }));
      const report = JSON.parse(await readFile(result.artifacts!.reportPath!, 'utf8'));
      expect(report.runnerErrors).toEqual(result.runnerErrors);
      const manifest = JSON.parse(await readFile(result.artifacts!.manifestPath!, 'utf8')) as {
        status: string;
        runnerErrors: unknown[];
        tests: unknown[];
      };
      expect(manifest.status).toBe('failed');
      expect(manifest.runnerErrors).toEqual(result.runnerErrors);
      expect(manifest.tests).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it.each([
    { name: 'collection', code: "throw new Error('collection refused');", message: 'collection refused' },
    { name: 'nested suite', code: "import { describe, beforeAll, test } from 'vitest'; describe('nested', () => { beforeAll(() => { throw new Error('nested setup refused'); }); test('blocked', () => {}); });", message: 'nested setup refused' },
    { name: 'unhandled error with a passing test', code: `import { test } from 'vitest'; test('otherwise passes', async () => {
      queueMicrotask(() => { throw new Error('unhandled task error'); });
      await new Promise(resolve => setImmediate(() => setImmediate(resolve)));
    });`, message: 'unhandled task error' },
  ])('keeps $name diagnostics in the canonical report', async ({ code, message }) => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-run-errors-'));
    try {
      await writeFile(join(root, 'failure.test.mjs'), code);
      const result = await runCommand({ cwd: root, runsRoot: join(root, 'runs'),
        testPattern: 'failure.test.mjs', print: false }, { resolveVmUrl: async () => 'ws://unused' });
      expect(result.passed).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.runnerErrors).toContainEqual(expect.objectContaining({ message }));
      const report = JSON.parse(await readFile(result.artifacts!.reportPath!, 'utf8'));
      expect(report.runnerErrors).toEqual(result.runnerErrors);
      const manifest = JSON.parse(await readFile(result.artifacts!.manifestPath!, 'utf8'));
      expect(manifest.status).toBe('failed');
      expect(manifest.runnerErrors).toEqual(result.runnerErrors);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it('keeps run-level errors consistent across report, manifest, and portable export', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-run-error-export-'));
    const runsRoot = join(root, 'runs');
    try {
      await writeFile(join(root, 'passing.test.mjs'), `import { test } from 'vitest'; test('still runs', () => {});`);
      await writeFile(join(root, 'broken.test.mjs'), `throw new Error('module import refused');`);
      const result = await runCommand({
        cwd: root,
        runsRoot,
        testPattern: '**/*.test.mjs',
        print: false,
      }, { resolveVmUrl: async () => 'ws://unused' });

      expect(result.status).toBe('failed');
      expect(result.runnerErrors).toContainEqual(expect.objectContaining({
        phase: 'collection',
        message: 'module import refused',
      }));
      const canonicalReport = JSON.parse(await readFile(result.artifacts!.reportPath!, 'utf8')) as {
        runnerErrors?: unknown[];
      };
      const canonicalManifest = JSON.parse(await readFile(result.artifacts!.manifestPath!, 'utf8')) as {
        runnerErrors?: unknown[];
      };
      expect(canonicalReport.runnerErrors).toEqual(result.runnerErrors);
      expect(canonicalManifest.runnerErrors).toEqual(result.runnerErrors);

      const exportDir = join(root, 'portable');
      const exported = await artifactsExportCommand({
        runsRoot,
        runId: result.artifacts!.runId,
        output: exportDir,
        allowPartial: true,
      });
      expect(exported.partial).toBe(false);
      await rm(result.artifacts!.outputDir, { recursive: true, force: true });
      const portableReport = JSON.parse(await readFile(join(exportDir, 'report.json'), 'utf8')) as {
        runnerErrors?: unknown[];
      };
      const portableManifest = JSON.parse(await readFile(join(exportDir, 'run.json'), 'utf8')) as {
        runnerErrors?: unknown[];
      };
      expect(portableReport.runnerErrors).toEqual(result.runnerErrors);
      expect(portableManifest.runnerErrors).toEqual(result.runnerErrors);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('classifies a completed failing test as a business failure rather than a runner crash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-test-failure-code-'));
    try {
      await writeFile(join(root, 'business.test.mjs'), "import { test } from 'vitest'; test('business failure', () => { throw new Error('expected business failure'); });");
      const result = await runCommand({ cwd: root, testPattern: 'business.test.mjs', runsRoot: join(root, 'runs'), print: false }, { resolveVmUrl: async () => 'ws://unused' });
      expect(result).toMatchObject({ passed: false, failedTests: 1 });
      expect(result.runnerErrors).toBeUndefined();
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 15000);

  it('retains a startup error when the runner cannot produce a JSON report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-startup-error-'));
    try {
      await writeFile(join(root, 'vitest.config.mjs'), "throw new Error('configuration refused');");
      const result = await runCommand({ cwd: root, runsRoot: join(root, 'runs'),
        testPattern: 'missing.test.mjs', print: false }, { resolveVmUrl: async () => 'ws://unused' });
      expect(result.passed).toBe(false);
      expect(result.runnerErrors).toContainEqual(expect.objectContaining({ phase: 'process',
        message: expect.stringContaining('configuration refused') }));
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it('keeps a successful retry and expected failure passed in the manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-final-outcome-'));
    const runsRoot = join(root, 'runs');
    try {
      await writeFile(join(root, 'outcomes.test.mjs'), `
        import { test, expect } from 'vitest';
        test.fails('expected', () => { throw new Error('expected failure'); });
        let tries = 0;
        test('retry', { retry: 1 }, () => { if (++tries === 1) throw new Error('retry failure'); expect(true).toBe(true); });
      `);
      const result = await runCommand({ cwd: root, runsRoot, testPattern: 'outcomes.test.mjs', print: false }, {
        resolveVmUrl: async () => 'ws://unused',
      });
      expect(result.passed, JSON.stringify(result)).toBe(true);
      const manifest = JSON.parse(await readFile(result.artifacts!.manifestPath!, 'utf8'));
      expect(manifest.status).toBe('passed');
      const attempts = await Promise.all(manifest.tests.flatMap((test: { attempts: Array<{ resultPath: string }> }) => test.attempts)
        .map(async (attempt: { resultPath: string }) => JSON.parse(await readFile(join(result.artifacts!.outputDir, attempt.resultPath), 'utf8'))));
      expect(attempts).toHaveLength(3);
      expect(attempts.every((attempt) => attempt.testOutcome === 'passed')).toBe(true);
      expect(attempts.filter((attempt) => attempt.attemptOutcome === 'failed')).toHaveLength(2);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('lets RunOptions.runsRoot override config runsRoot', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'fliwright-cli-option-runs-'));
    const configuredRunsRoot = join(tmpDir, 'configured-runs');
    const explicitRunsRoot = join(tmpDir, 'explicit-runs');
    await writeFile(join(tmpDir, 'fliwright.config.ts'), [
      'export default {',
      `  runsRoot: ${JSON.stringify(configuredRunsRoot)},`,
      '};',
    ].join('\n'));
    await writeFile(join(tmpDir, 'pass.test.ts'), [
      "import { describe, expect, it } from 'vitest';",
      "describe('cli fixture', () => {",
      "  it('passes', () => { expect(process.env.FLIWRIGHT_RUNS_ROOT).toBe(" + JSON.stringify(explicitRunsRoot) + "); });",
      "});",
    ].join('\n'));

    const result = await withIsolatedHome(async () => runCommand({
      testPattern: 'pass.test.ts',
      reporter: 'json',
      cwd: tmpDir,
      print: false,
      runsRoot: explicitRunsRoot,
    }, {
      resolveVmUrl: async () => 'ws://mock-vm:8181/ws',
    }));

    expect(result.passed).toBe(true);
    expect(result.artifacts!.outputDir).toContain(explicitRunsRoot);
    expect(result.artifacts!.outputDir).not.toContain(configuredRunsRoot);

    await rm(tmpDir, { recursive: true, force: true });
  });

  it('persists structured failure context and screenshots in the AI report', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'fliwright-cli-failure-artifacts-'));
    const integrationPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../fliwright-vitest/src/index.ts');
    await writeFile(join(tmpDir, 'vitest.config.mjs'), `export default { test: { maxWorkers: 2, minWorkers: 2 } };`);
    for (const name of ['login failure', 'second failure']) {
      await writeFile(join(tmpDir, `${name.replaceAll(' ', '-')}.test.ts`), `
        import { createFliwrightTest } from ${JSON.stringify(integrationPath)};
        const driver = {
          sendRequest: async (method) => {
            if (method === 'ext.fliwright.screenshot') return { success: true, screenshot: Buffer.from('png-bytes').toString('base64') };
            if (method === 'ext.fliwright.snap') return { widgets: [{ type: 'Text' }] };
            if (method === 'ext.fliwright.captureFrame') return { diagnostics: [{ kind: 'Flutter.Error', timestamp: 1812345678901, streamId: 'Logging', data: { message: 'build failed' } }] };
            return { success: true };
          }, healing: { getReports: () => [] }, dispose: async () => {},
        };
        const test = createFliwrightTest({ vmServiceUrl: 'ws://unused', requireAssertions: false, log: { format: 'silent' } }, { driverProvider: async () => driver });
        test(${JSON.stringify(name)}, async ({ page }) => { throw new Error('original business error'); });
      `);
    }

    let report;
    const result = await withIsolatedHome(async () => {
      const runResult = await runCommand({
        testPattern: 'failure',
        reporter: 'json',
        cwd: tmpDir,
        print: false,
      }, {
        resolveVmUrl: async () => 'ws://mock-vm:8181/ws',
      });
      report = JSON.parse(await readFile(runResult.artifacts!.reportPath!, 'utf8')) as typeof runResult;
      await expect(stat(runResult.artifacts!.screenshots[0])).resolves.toBeDefined();
      return runResult;
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(2);
    expect(result.failures!.map((failure) => failure.testName).sort()).toEqual(['login failure', 'second failure']);
    expect(result.failures![0].screenshot?.path).toBeDefined();
    expect(result.failures![0].screenshot?.base64).toBeUndefined();
    expect(result.artifacts?.screenshots).toHaveLength(2);
    expect(report.failures![0].widgetTree).toEqual({ widgets: [{ type: 'Text' }] });
    expect(report.failures![0].diagnostics).toEqual([{
      kind: 'Flutter.Error',
      timestamp: 1812345678901,
      streamId: 'Logging',
      data: { message: 'build failed' },
    }]);

    await rm(tmpDir, { recursive: true, force: true });
  });

  it('attaches timeline summaries and agent-visible failures to the report', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'fliwright-cli-timeline-'));
    const integrationPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../fliwright-vitest/src/index.ts');
    await writeFile(join(tmpDir, 'timeline.test.ts'), `
      import { createFliwrightTest } from ${JSON.stringify(integrationPath)};
      const test = createFliwrightTest({ vmServiceUrl: 'ws://unused', requireAssertions: false });
      test('writes timeline facts', async ({ timeline }) => {
        const recorder = timeline.recorder;
        const page = recorder.startNode('page', 'Register');
        recorder.passNode(page.id);
        const fill = recorder.startNode('step', 'Fill');
        const screenshot = await timeline.artifactStore.writeScreenshot(fill.id, Buffer.from('png'));
        recorder.addArtifacts(fill.id, [screenshot]);
        recorder.passNode(fill.id);
        const submit = recorder.startNode('step', 'Submit');
        recorder.failNode(submit.id, { code: 'assertion_failed', title: 'Submit', message: 'button disabled',
          appState: { screenshotPath: screenshot.path }, recoveryHints: [] });
        const action = recorder.startNode('action', 'Continue');
        recorder.failNode(action.id, { code: 'actionability_failed', title: 'Continue', message: 'overlay obscures control', recoveryHints: [] });
      });
    `);

    let expectedHomeRoot = '';
    const result = await withIsolatedHome(async (home) => {
      expectedHomeRoot = join(tmpDir, '.fliwright/runs');
      const run = await runCommand({
        testPattern: 'timeline.test.ts',
        reporter: 'json',
        cwd: tmpDir,
        print: false,
      }, {
        resolveVmUrl: async () => 'ws://mock-vm:8181/ws',
      });
      const output = join(tmpDir, 'export');
      const exported = await artifactsExportCommand({ runsRoot: dirname(run.artifacts!.outputDir),
        runId: run.artifacts!.runId, output, allowPartial: true });
      expect(exported.missing.filter((path) => path.includes('screenshot'))).toEqual([]);
      const portable = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
      const screenshotPath = portable.agentVisibleFailures[0].appState.screenshotPath;
      expect(portable.timelines[0].firstFailure.appState.screenshotPath).toBe(screenshotPath);
      expect(await readFile(join(output, screenshotPath), 'utf8')).toBe('png');
      return run;
    });

    expect(result.timelines).toHaveLength(1);
    expect(result.timelines![0]).toMatchObject({
      pages: 1,
      stepsPassed: 1,
      stepsFailed: 1,
      screenshots: 1,
      firstFailure: { code: 'assertion_failed', message: 'button disabled' },
    });
    expect(result.agentVisibleFailures).toEqual([
      expect.objectContaining({ code: 'assertion_failed', title: 'Submit', message: 'button disabled', timelineNodeId: 'step-3' }),
      expect.objectContaining({ code: 'actionability_failed', title: 'Continue', message: 'overlay obscures control', timelineNodeId: 'action-4' }),
    ]);
    expect(result.artifacts?.timelines?.[0]).toContain('timeline.json');
    expect(result.artifacts?.timelines?.[0]).toContain(expectedHomeRoot);

    await rm(tmpDir, { recursive: true, force: true });
  });
});

describe('parseVitestOutput', () => {
  it('does not trust a successful test summary when the runner reported unhandled errors', () => {
    const result = parseVitestOutput(JSON.stringify({ success: true, numTotalTests: 1, numPassedTests: 1,
      runnerErrors: [{ phase: 'unhandled', message: 'worker exception', stack: 'the stack' }],
    }));
    expect(result.passed).toBe(false);
    expect(result.runnerErrors).toEqual([{ phase: 'unhandled', message: 'worker exception', stack: 'the stack' }]);
  });
  it('returns empty result for empty string', () => {
    const result = parseVitestOutput('');
    expect(result.passed).toBe(false);
    expect(result.totalTests).toBe(0);
    expect(result.results).toEqual([]);
  });

  it('returns empty result for string without braces', () => {
    const result = parseVitestOutput('no json here');
    expect(result.passed).toBe(false);
    expect(result.totalTests).toBe(0);
  });

  it('returns empty result for malformed JSON', () => {
    const result = parseVitestOutput('{not valid json}');
    expect(result.passed).toBe(false);
    expect(result.totalTests).toBe(0);
  });

  it('handles missing testResults gracefully', () => {
    const result = parseVitestOutput('{"success":true,"numTotalTests":0}');
    expect(result.passed).toBe(true);
    expect(result.totalTests).toBe(0);
    expect(result.results).toEqual([]);
  });

  it('parses a complete vitest JSON report', () => {
    const json = JSON.stringify({
      success: true,
      numTotalTests: 2,
      numPassedTests: 2,
      numFailedTests: 0,
      startTime: Date.now() - 100,
      testResults: [{
        assertionResults: [
          { fullName: 'test a', status: 'passed', duration: 10 },
          { fullName: 'test b', status: 'passed', duration: 20 },
        ],
      }],
    });
    const result = parseVitestOutput(json);
    expect(result.passed).toBe(true);
    expect(result.totalTests).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe('test a');
  });

  it('captures failure messages for failed tests', () => {
    const json = JSON.stringify({
      success: false,
      numTotalTests: 1,
      numPassedTests: 0,
      numFailedTests: 1,
      startTime: Date.now(),
      testResults: [{
        assertionResults: [{
          fullName: 'failing test',
          status: 'failed',
          duration: 50,
          failureMessages: ['expected 1 to be 2'],
        }],
      }],
    });
    const result = parseVitestOutput(json);
    expect(result.passed).toBe(false);
    expect(result.results[0].error).toBe('expected 1 to be 2');
  });
});
