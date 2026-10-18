import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { parseVitestJson, buildVitestArgs, buildRunEnv, resolveVitestCli, VitestRunner } from '../src/runner/VitestRunner.js';
import type { RunParams } from '../src/runner/TestRunner.js';

describe('VitestRunner', () => {
  it.skipIf(process.platform === 'win32').each([false, true])('cancels fork workers and their connected descendants (ignores SIGTERM: %s)', async (ignoreTermination) => {
    const root = await mkdtemp(path.join(tmpdir(), 'fliwright-editor-cancel-'));
    const controller = new AbortController();
    const peers = new Set<Socket>();
    let connected!: () => void;
    const ready = new Promise<void>(resolve => { connected = resolve; });
    const server = createServer(socket => { peers.add(socket); socket.on('close', () => peers.delete(socket)); connected(); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    let running: ReturnType<VitestRunner['run']> | undefined;
    let descendantPid: number | undefined;
    try {
      await symlink(path.resolve('../../e2e/node_modules'), path.join(root, 'node_modules'), 'dir');
      await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
      await writeFile(path.join(root, 'fliwright.config.ts'), "export default { recording: { mode: 'off' } };");
      await writeFile(path.join(root, 'vitest.config.mjs'), `import { fliwrightPreset } from '@fliwright/vitest/preset';
        export default fliwrightPreset({ recording: { mode: 'off' }, test: { include: ['cancel.test.mjs'], pool: 'forks', maxWorkers: 1, testTimeout: 60000 } });`);
      await writeFile(path.join(root, 'descendant.mjs'), `import { connect } from 'node:net';
        import { writeFileSync } from 'node:fs';
        ${ignoreTermination ? "process.on('SIGTERM', () => {});" : ''}
        writeFileSync('descendant.pid', String(process.pid));
        connect(${address.port}, '127.0.0.1');`);
      await writeFile(path.join(root, 'cancel.test.mjs'), `import { test } from 'vitest';
        import { spawn } from 'node:child_process';
        test('pending connected worker', async () => {
          spawn(process.execPath, ['descendant.mjs'], { stdio: 'ignore' });
          await new Promise(() => {});
        });`);
      running = new VitestRunner().run({ workspaceRoot: { fsPath: root } as any,
        failureContextDir: { fsPath: path.join(root, 'failures') } as any,
        runsRoot: path.join(root, 'runs'), runId: 'cancel-proof', signal: controller.signal });
      await bounded(ready, 10000);
      descendantPid = Number(await readFile(path.join(root, 'descendant.pid'), 'utf8'));
      controller.abort();
      const result = await bounded(running, 6000);
      expect(result).toMatchObject({ passed: false, status: 'interrupted' });
      await expect.poll(() => peers.size, { timeout: 2000 }).toBe(0);
      await expect.poll(() => isProcessAlive(descendantPid!), { timeout: 2000 }).toBe(false);
      const manifest = JSON.parse(await readFile(path.join(root, 'runs/cancel-proof/run.json'), 'utf8'));
      expect(manifest).toMatchObject({ status: 'interrupted' });
    } finally {
      controller.abort();
      if (!descendantPid) descendantPid = Number(await readFile(path.join(root, 'descendant.pid'), 'utf8').catch(() => ''));
      if (descendantPid && isProcessAlive(descendantPid)) process.kill(descendantPid, 'SIGKILL');
      for (const peer of peers) peer.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (running) await bounded(running.catch(() => {}), 6000).catch(() => {});
      await rm(root, { force: true, recursive: true });
    }
  }, 25000);

  it('finalizes one canonical manifest and report after a direct Vitest subprocess', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'fliwright-editor-direct-'));
    try {
      await symlink(path.resolve('../../e2e/node_modules'), path.join(root, 'node_modules'), 'dir');
      await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
      await writeFile(path.join(root, 'fliwright.config.ts'), "export default { recording: { mode: 'off' } };");
      await writeFile(path.join(root, 'vitest.config.mjs'), `import { fliwrightPreset } from '@fliwright/vitest/preset';
        export default fliwrightPreset({ recording: { mode: 'off' }, test: { include: ['proof.test.mjs'], maxWorkers: 1 } });`);
      await writeFile(path.join(root, 'proof.test.mjs'), "import { test, expect } from 'vitest'; test('proof', () => expect(2 + 2).toBe(4));");
      const runsRoot = path.join(root, 'runs');
      const result = await new VitestRunner().run({ workspaceRoot: { fsPath: root } as any,
        failureContextDir: { fsPath: path.join(root, 'failures') } as any, runsRoot, runId: 'direct-proof' });
      expect(result).toMatchObject({ passed: true, totalTests: 1, passedTests: 1 });
      const vitestReport = JSON.parse(await readFile(path.join(runsRoot, 'direct-proof/vitest.json'), 'utf8'));
      expect(vitestReport).toMatchObject({ success: true, numPassedTests: 1 });
      const manifest = JSON.parse(await readFile(path.join(runsRoot, 'direct-proof/run.json'), 'utf8'));
      expect(manifest).toMatchObject({ runId: 'direct-proof', status: 'passed', evidenceStatus: 'disabled' });
      expect(manifest.tests).toHaveLength(1);
      const report = JSON.parse(await readFile(path.join(runsRoot, 'direct-proof/report.json'), 'utf8'));
      expect(report).toMatchObject({ passed: true, totalTests: 1, artifacts: { runId: 'direct-proof' } });
    } finally { await rm(root, { force: true, recursive: true }); }
  }, 20000);

  it('recovers terminal projections when its JSON reporter overrides the preset reporters', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'fliwright-editor-recovery-'));
    try {
      await symlink(path.resolve('../../e2e/node_modules'), path.join(root, 'node_modules'), 'dir');
      await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
      await writeFile(path.join(root, 'fliwright.config.ts'), "export default { recording: { mode: 'standard' } };");
      await writeFile(path.join(root, 'vitest.config.mjs'), `import { fliwrightPreset } from '@fliwright/vitest/preset';
        export default fliwrightPreset({ recording: { mode: 'standard', requireAssertions: false,
          testFinalizationBudgetMs: 150 }, test: { include: ['proof.test.mjs'], maxWorkers: 1 } });`);
      await writeFile(path.join(root, 'proof.test.mjs'), `import { createFliwrightTest } from '@fliwright/vitest';
        const test = createFliwrightTest({ vmServiceUrl: '', requireAssertions: false, log: { format: 'silent' } });
        test('terminal recovery', async ({ timeline }) => {
          const write = timeline.artifactStore.writeTimeline.bind(timeline.artifactStore);
          timeline.artifactStore.writeTimeline = (data, options) => data.status === 'running'
            ? write(data, options) : new Promise(() => {});
          await timeline.artifactStore.writeTimeline(timeline.recorder.toJSON());
          throw new Error('original editor error');
        });`);
      const runsRoot = path.join(root, 'runs');
      const result = await new VitestRunner().run({ workspaceRoot: { fsPath: root } as any,
        failureContextDir: { fsPath: path.join(root, 'failures') } as any, runsRoot, runId: 'recovery-proof' });
      expect(result).toMatchObject({ passed: false, failedTests: 1 });
      const manifest = JSON.parse(await readFile(path.join(runsRoot, 'recovery-proof/run.json'), 'utf8'));
      const dir = path.dirname(path.join(runsRoot, 'recovery-proof', manifest.tests[0].attempts[0].resultPath));
      expect(JSON.parse(await readFile(path.join(dir, 'timeline.json'), 'utf8')).status).toBe('failed');
      expect(JSON.parse(await readFile(path.join(dir, 'trace/trace.json'), 'utf8')).meta.status).toBe('failed');
      expect(JSON.parse(await readFile(path.join(dir, 'result.json'), 'utf8'))).toMatchObject({
        finalized: true, testOutcome: 'failed', evidenceStatus: 'partial',
        runnerErrors: [expect.objectContaining({ message: 'original editor error' })],
      });
    } finally { await rm(root, { force: true, recursive: true }); }
  }, 20000);

  it('does not count skipped test bodies as failures', () => {
    expect(parseVitestJson(JSON.stringify({ numTotalTests: 1, numPassedTests: 0, numFailedTests: 0, success: true,
      testResults: [{ assertionResults: [{ title: 'later', status: 'pending' }] }],
    }))).toMatchObject({ failedTests: 0 });
  });

  it('reports collection failures even when no test body ran', () => {
    const result = parseVitestJson(JSON.stringify({
      numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, numFailedTestSuites: 1, success: false,
      testResults: [{ name: '/repo/form.test.ts', status: 'failed',
        message: "Test scenario 'fixture-home' was requested, but defineConfig({ scenarios }) is missing.", assertionResults: [] }],
    }), '', 1);
    expect(result).toMatchObject({ passed: false, failedTests: 1 });
    expect(result.results[0]).toMatchObject({ passed: false, filePath: '/repo/form.test.ts',
      error: expect.stringContaining("scenario 'fixture-home'") });
  });

  it('rejects a successful process exit without a Vitest report', () => {
    expect(parseVitestJson('unexpected launcher output', '', 0)).toMatchObject({ passed: false, failedTests: 1 });
  });

  it('preserves Vitest run failure when all reported test bodies passed', () => {
    const result = parseVitestJson(JSON.stringify({ numTotalTests: 1, numPassedTests: 1, numFailedTests: 0,
      success: false, testResults: [{ name: '/repo/a.test.ts', assertionResults: [{ title: 'body', status: 'passed' }] }],
    }), 'worker terminated', 0);
    expect(result.passed).toBe(false);
    expect(result.failedTests).toBeGreaterThan(0);
    expect(result.results.some(test => test.error?.includes('worker terminated'))).toBe(true);
  });

  it('parses vitest json reporter output', () => {
    const result = parseVitestJson(JSON.stringify({
      numTotalTests: 2,
      numPassedTests: 1,
      numFailedTests: 1,
      testResults: [
        {
          name: '/repo/tests/sample.test.ts',
          assertionResults: [
            { ancestorTitles: ['suite'], title: 'passes', status: 'passed', duration: 3 },
            { ancestorTitles: ['suite'], title: 'fails', status: 'failed', duration: 4, failureMessages: ['boom'] },
          ],
        },
      ],
    }), '', 1);

    expect(result.passed).toBe(false);
    expect(result.totalTests).toBe(2);
    expect(result.failedTests).toBe(1);
    expect(result.results[0]).toMatchObject({ name: 'suite > passes', filePath: '/repo/tests/sample.test.ts' });
    expect(result.results[1]).toMatchObject({ name: 'suite > fails', filePath: '/repo/tests/sample.test.ts', error: 'boom' });
  });

  it('reports a stopped run when the Vitest process exits from cancellation', () => {
    const result = parseVitestJson('', 'Fliwright test run stopped by user.', 130);

    expect(result.passed).toBe(false);
    expect(result.failedTests).toBe(1);
    expect(result.results[0]).toMatchObject({
      name: 'Vitest run',
      passed: false,
      error: 'Fliwright test run stopped by user.',
    });
  });
});

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Operation exceeded ${timeoutMs}ms`)), timeoutMs);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

const baseParams: RunParams = {
  workspaceRoot: { fsPath: '/repo', scheme: 'file' } as any,
  failureContextDir: { fsPath: '/repo/.fliwright/failures', scheme: 'file' } as any,
};

describe('buildVitestArgs', () => {
  it('adds -t "<pattern>" after the relative test file when testNamePattern is set', () => {
    const args = buildVitestArgs({
      ...baseParams,
      testFile: { fsPath: '/repo/tests/a.test.ts', scheme: 'file' } as any,
      testNamePattern: 'case A',
    });

    expect(args).toEqual([
      'run',
      path.relative('/repo', '/repo/tests/a.test.ts'),
      '-t', 'case A',
      '--reporter=json',
    ]);
    expect(args).toContain('-t');
    expect(args[args.indexOf('-t') + 1]).toBe('case A');
  });

  it('does not add -t when testNamePattern is unset', () => {
    const args = buildVitestArgs({
      ...baseParams,
      testFile: { fsPath: '/repo/tests/a.test.ts', scheme: 'file' } as any,
    });

    expect(args).not.toContain('-t');
    expect(args).toEqual([
      'run',
      path.relative('/repo', '/repo/tests/a.test.ts'),
      '--reporter=json',
    ]);
  });
});

describe('buildRunEnv', () => {
  it('sets FLIWRIGHT_RUNS_ROOT when runsRoot is provided', () => {
    const env = buildRunEnv({
      ...baseParams,
      runsRoot: '/home/.fliwright/projects/abc/runs',
    });

    expect(env.FLIWRIGHT_RUNS_ROOT).toBe('/home/.fliwright/projects/abc/runs');
  });

  it('sets FLIWRIGHT_RUN_ID when runId is provided', () => {
    const env = buildRunEnv({
      ...baseParams,
      runId: '2026-06-22T10-00-00',
    });

    expect(env.FLIWRIGHT_RUN_ID).toBe('2026-06-22T10-00-00');
  });

  it('does not create independent Trace environment switches', () => {
    const env = buildRunEnv({
      ...baseParams,
      ...({ traceMode: 'full', traceDir: { fsPath: '/unused/traces' } } as any),
    });

    expect(env.FLIWRIGHT_TRACE).toBeUndefined();
    expect(env.FLIWRIGHT_TRACE_DIR).toBeUndefined();
    expect(env.FLIWRIGHT_TRACE_LAYOUT).toBeUndefined();
  });

  it('does not set FLIWRIGHT_RUNS_ROOT when runsRoot is unset', () => {
    const env = buildRunEnv({ ...baseParams });
    expect(env.FLIWRIGHT_RUNS_ROOT).toBeUndefined();
  });
});

describe('resolveVitestCli', () => {
  it('resolves the workspace-installed vitest cli', () => {
    const cli = resolveVitestCli(path.resolve(__dirname, '..', '..', '..'));

    expect(cli).toMatch(/vitest[\\/]vitest\.mjs$/);
  });
});
