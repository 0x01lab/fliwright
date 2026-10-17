import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunArtifactStore, RunSession, restoreRunAttempts } from '../src/index.js';

describe('terminal attempt recovery', () => {
  it('keeps disabled recording disabled and ignores unfinalized or unrelated attempts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-recovery-policy-'));
    try {
      const session = new RunSession({ runId: 'recovery', testId: 'test', attemptId: 'attempt-0', testName: 'off' });
      const result = await session.finish({ status: 'passed', evidenceStatus: 'disabled' });
      result.finalized = true;
      const entries = [
        { result: { ...result, finalized: false, testId: 'unfinished' } },
        { result: { ...result, runId: 'unrelated', testId: 'unrelated' } },
        { result },
      ];
      await restoreRunAttempts(entries, 'recovery', root);
      const store = new RunArtifactStore({ runsRoot: root, runId: 'recovery' });
      expect(await readdir(join(store.runDir, 'tests'))).toEqual(['test']);
      const dir = store.attemptDir('test', 'attempt-0');
      expect(await readdir(dir)).toEqual(['result.json']);
      expect(JSON.parse(await readFile(join(dir, 'result.json'), 'utf8'))).toMatchObject({
        finalized: true, testOutcome: 'passed', evidenceStatus: 'disabled',
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('surfaces parent write errors while retaining the original runner failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-recovery-error-'));
    try {
      const session = new RunSession({ runId: 'recovery', testId: 'test', attemptId: 'attempt-0', testName: 'failure' });
      const result = await session.finish({ status: 'failed', evidenceStatus: 'partial' });
      result.finalized = true;
      result.runnerErrors = [{ message: 'original business failure', phase: 'setup-or-body' }];
      await mkdir(new RunArtifactStore({ runsRoot: root, runId: 'recovery' }).attemptDir('test', 'attempt-0'), { recursive: true });
      await mkdir(join(root, 'recovery/tests/test/attempts/attempt-0/result.json'));
      await expect(restoreRunAttempts([{ result }], 'recovery', root)).rejects.toThrow();
      expect(result.runnerErrors).toEqual([{ message: 'original business failure', phase: 'setup-or-body' }]);
      expect(result.evidenceStatus).toBe('partial');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
