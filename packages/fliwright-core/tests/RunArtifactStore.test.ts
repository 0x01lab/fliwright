import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunArtifactStore } from '../src/index.js';

describe('RunArtifactStore', () => {
  it('does not publish a running result after its finalization stage was aborted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-result-abort-'));
    try {
      const store = new RunArtifactStore({ runsRoot: root, runId: 'r' });
      const dir = await store.writeAttemptResult('t', 'a', { status: 'failed', finalized: true });
      const controller = new AbortController();
      const late = store.writeAttemptResult('t', 'a', { status: 'running' }, { signal: controller.signal });
      controller.abort(new Error('finalization deadline'));
      await expect(late).rejects.toThrow('finalization deadline');
      expect(JSON.parse(await readFile(join(dir, 'result.json'), 'utf8'))).toEqual({ status: 'failed', finalized: true });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('preserves distinct task identities and contains punctuation-only ids within the run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-run-identities-'));
    const store = new RunArtifactStore({ runsRoot: root, runId: 'r' });
    const ids = ['-123', '123', 'suite/test', 'suite-test', '.', '..', 'unknown'];
    const paths = ids.map((id) => store.attemptDir(id, 'attempt-0'));
    expect(new Set(paths).size).toBe(ids.length);
    for (const path of paths) expect(path.startsWith(join(store.runDir, 'tests') + '/')).toBe(true);
    expect(paths[4]).not.toBe(join(store.runDir, 'tests', 'attempts', 'attempt-0'));
    expect(() => store.attemptDir('', 'attempt-0')).toThrow('identity');
    await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true }));
  });
  it('writes one run manifest and isolated test attempt artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-run-store-'));
    const store = new RunArtifactStore({ runsRoot: root, runId: 'run-1' });
    await store.writeManifest({
      schemaVersion: 1,
      runId: 'run-1',
      status: 'running',
      evidenceStatus: 'complete',
      tests: [],
    });
    const attemptDir = await store.writeAttemptResult('test-1', 'attempt-1', { status: 'passed' });
    expect(attemptDir).toContain('/tests/test-1/attempts/attempt-1');
    expect(await readFile(join(store.runDir, 'run.json'), 'utf8')).toContain('"runId": "run-1"');
    expect(await readFile(join(attemptDir, 'result.json'), 'utf8')).toContain('passed');
  });

  it('serially appends JSONL events and reports an incomplete trailing line', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-run-store-'));
    const store = new RunArtifactStore({ runsRoot: root, runId: 'run-2' });
    await store.appendEvent('test-1', 'attempt-1', { sequence: 1, kind: 'start' });
    await store.appendEvent('test-1', 'attempt-1', { sequence: 2, kind: 'finish' });
    const eventsPath = store.eventsPath('test-1', 'attempt-1');
    const events = await store.readEvents(eventsPath);
    expect(events.events).toEqual([
      { sequence: 1, kind: 'start' },
      { sequence: 2, kind: 'finish' },
    ]);
    await import('node:fs/promises').then(({ appendFile }) => appendFile(eventsPath, '{"sequence":3'));
    await expect(store.readEvents(eventsPath)).resolves.toMatchObject({
      events: events.events,
      incompleteTrailingLine: true,
    });
  });
});
