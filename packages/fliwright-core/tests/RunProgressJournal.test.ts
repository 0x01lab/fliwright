import { describe, expect, it, vi } from 'vitest';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunArtifactStore, RunSession, TimelineRecorder, RunProgressJournal, recoverRunProgress } from '../src/index.js';

const identity = { runId: 'r', testId: 't', attemptId: 'a' };

describe('RunProgressJournal', () => {
  it('drops aborted queued progress without consuming a sequence or overwriting final facts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-journal-abort-'));
    try {
      const store = new RunArtifactStore({ runsRoot: root, runId: 'r' });
      const journal = new RunProgressJournal(store, 't', 'a');
      const session = new RunSession({ ...identity, testName: 'aborted progress' });
      const controller = new AbortController();
      const late = journal.append(session.snapshot(), undefined, false, { signal: controller.signal });
      controller.abort(new Error('finalization deadline'));
      await expect(late).rejects.toThrow('finalization deadline');
      await journal.append(await session.finish({ status: 'failed', evidenceStatus: 'partial' }), undefined, true);
      const log = await store.readEvents(store.eventsPath('t', 'a'));
      expect(log.events).toHaveLength(1);
      expect(log.events[0]).toMatchObject({ sequence: 1, finalized: true, result: { status: 'failed' } });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('serializes concurrent writes and retries a failed append without losing its delta', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-progress-write-failure-'));
    try {
      const store = new RunArtifactStore({ runsRoot: root, runId: 'r' });
      const journal = new RunProgressJournal(store, 't', 'a');
      const session = new RunSession({ ...identity, testName: 'writes' });
      const failed = vi.spyOn(store, 'appendEvent').mockRejectedValueOnce(new Error('disk full'));
      await expect(journal.append(session.snapshot())).rejects.toThrow('disk full');
      await Promise.all(Array.from({ length: 12 }, () => journal.append(session.snapshot())));
      const log = await store.readEvents(store.eventsPath('t', 'a'));
      expect(log.events).toHaveLength(12);
      expect((log.events[0] as { sequence: number }).sequence).toBe(1);
      expect(recoverRunProgress(log, identity).issues).toEqual([]);
      failed.mockRestore();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('reconstructs operations, timeline and evidence from deltas without repeating the whole history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-progress-journal-'));
    try {
      const store = new RunArtifactStore({ runsRoot: root, runId: identity.runId });
      const journal = new RunProgressJournal(store, identity.testId, identity.attemptId);
      const recorder = new TimelineRecorder({ runId: identity.runId, testName: 'progress' });
      const session = new RunSession({ ...identity, testName: 'progress', recorder, recordingMode: 'standard',
        captureEvidence: async () => ({ status: 'captured', artifactPaths: ['artifacts/frame.png'] }),
      });
      session.configureProgressPersistence((result) => journal.append(result, recorder.toJSON()));
      await session.perform({ kind: 'action', title: 'first' }, async () => {});
      await session.perform({ kind: 'action', title: 'second' }, async () => {});
      const expected = session.snapshot();
      const log = await store.readEvents(store.eventsPath('t', 'a'));
      const recovered = recoverRunProgress(log, identity);
      expect(recovered.issues).toEqual([]);
      expect(recovered.result).toEqual(expected);
      expect(recovered.timeline).toEqual(recorder.toJSON());
      const events = log.events as Array<{ sequence: number; operations: unknown[]; evidence: unknown[] }>;
      expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
      expect(events.reduce((count, event) => count + event.operations.length, 0)).toBe(4);
      expect(events.reduce((count, event) => count + event.evidence.length, 0)).toBe(2);
      expect(events.at(-1)!.operations).toHaveLength(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('retains valid facts around sequence gaps, corrupt complete lines and an unfinished tail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-progress-damaged-'));
    try {
      const store = new RunArtifactStore({ runsRoot: root, runId: 'r' });
      const journal = new RunProgressJournal(store, 't', 'a');
      const session = new RunSession({ ...identity, testName: 'damaged' });
      await journal.append(session.snapshot());
      await session.perform({ kind: 'action', title: 'first' }, async () => {});
      await journal.append(session.snapshot());
      const path = store.eventsPath('t', 'a');
      const events = (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      events[1].sequence = 3;
      await import('node:fs/promises').then(({ writeFile }) => writeFile(path,
        JSON.stringify(events[0]) + '\n{damaged}\n' + JSON.stringify(events[1]) + '\n{"sequence":4'));
      const log = await store.readEvents(path);
      expect(log.corruptLines).toEqual([2]);
      const recovered = recoverRunProgress(log, identity);
      expect(recovered.result?.operations[0]).toMatchObject({ title: 'first', outcome: 'passed' });
      expect(recovered.issues.join(' ')).toMatch(/sequence.*2/i);
      expect(recovered.issues.join(' ')).toContain('line 2');
      expect(recovered.issues.join(' ')).toMatch(/trailing/i);
      await appendFile(path, '\n');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('rejects events from another attempt and out-of-order records without overwriting known facts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-progress-identity-'));
    try {
      const store = new RunArtifactStore({ runsRoot: root, runId: 'r' });
      const journal = new RunProgressJournal(store, 't', 'a');
      const session = new RunSession({ ...identity, testName: 'identity' });
      await journal.append(session.snapshot());
      const log = await store.readEvents(store.eventsPath('t', 'a'));
      const event = log.events[0] as Record<string, unknown>;
      log.events.push({ ...event, testId: 'other' }, event);
      const recovered = recoverRunProgress(log, identity);
      expect(recovered.result?.testId).toBe('t');
      expect(recovered.issues.join(' ')).toMatch(/identity/i);
      expect(recovered.issues.join(' ')).toMatch(/sequence/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
