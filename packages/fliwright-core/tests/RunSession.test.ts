import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunSession } from '../src/index.js';
import { EndpointLeaseManager } from '../src/EndpointLease.js';

describe('RunSession', () => {
  it('preserves action results and original errors when progress persistence fails', async () => {
    const session = new RunSession({ runId: 'r', testId: 't', testName: 'disk failure', recordingMode: 'standard',
      captureEvidence: async () => ({ status: 'captured', artifactPaths: ['artifacts/saved.png'] }),
    });
    session.configureProgressPersistence(async () => { throw new Error('disk unavailable'); });
    await expect(session.perform({ kind: 'action', title: 'Saved' }, async () => 'saved')).resolves.toBe('saved');
    const original = new Error('business error');
    await expect(session.perform({ kind: 'action', title: 'Rejected' }, async () => { throw original; })).rejects.toBe(original);
    const result = await session.finish({ status: 'failed', evidenceStatus: 'complete' });
    expect(result.operations.map((operation) => operation.outcome)).toEqual(['passed', 'failed']);
    expect(result.evidenceStatus).toBe('partial');
    expect(result.evidenceIssues).toContain('Progress persistence failed: disk unavailable');
  });

  it('records successful and failed operations while preserving the original error', async () => {
    const session = new RunSession({ runId: 'run-1', testId: 'test-1', testName: 'example' });
    await expect(session.perform({ kind: 'action', title: 'Tap save' }, async () => 'ok')).resolves.toBe('ok');
    const error = new Error('business failure');
    await expect(session.perform({ kind: 'assertion', title: 'Saved' }, async () => {
      throw error;
    })).rejects.toBe(error);

    const result = await session.finish({ status: 'failed', evidenceStatus: 'partial' });
    expect(result.status).toBe('failed');
    expect(result.operations.map((operation) => operation.title)).toEqual(['Tap save', 'Saved']);
    expect(result.operations[1].outcome).toBe('failed');
    expect(JSON.parse(JSON.stringify(result)).operations[1].error).toMatchObject({
      name: 'Error', message: 'business failure',
    });
  });

  it('isolates nested async branches and keeps parent ids stable', async () => {
    const session = new RunSession({ runId: 'run-2', testId: 'test-2', testName: 'parallel' });
    await session.perform({ kind: 'step', title: 'parent' }, async () => {
      await Promise.all([
        session.perform({ kind: 'action', title: 'left' }, async () => 'left'),
        session.perform({ kind: 'action', title: 'right' }, async () => 'right'),
      ]);
    });
    const result = await session.finish({ status: 'passed', evidenceStatus: 'complete' });
    const parent = result.operations.find((operation) => operation.title === 'parent');
    expect(result.operations.filter((operation) => operation.parentId === parent?.operationId))
      .toHaveLength(2);
  });

  it('serializes checkpoint requests through the configured evidence capturer', async () => {
    const requests: string[] = [];
    const session = new RunSession({
      runId: 'run-3',
      testId: 'test-3',
      testName: 'checkpoint',
      captureEvidence: async (request) => {
        requests.push(request.kind);
        return { status: 'captured', artifactPaths: [`artifacts/${request.kind}.json`] };
      },
    });
    await expect(session.checkpoint({ kind: 'screenshot', reason: 'failure' }))
      .resolves.toMatchObject({ status: 'captured' });
    expect(requests).toEqual(['screenshot']);
  });

  it('holds the endpoint lease across the action and its evidence capture', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-session-lease-'));
    try {
      const manager = new EndpointLeaseManager({ rootDir: root, retryDelayMs: 2 });
      let releaseEvidence!: () => void;
      const evidenceStarted = new Promise<void>((resolve) => {
        releaseEvidence = resolve;
      });
      const first = new RunSession({
        runId: 'run-lease-1', testId: 'test-1', testName: 'lease', recordingMode: 'standard',
        captureEvidence: async () => {
          events.push('first-evidence');
          await evidenceStarted;
          return { status: 'captured' };
        },
      });
      const second = new RunSession({ runId: 'run-lease-2', testId: 'test-2', testName: 'lease' });
      first.configureEndpointLease(manager, 'http://localhost:123');
      second.configureEndpointLease(manager, 'ws://localhost:123/ws');
      const events: string[] = [];
      const firstRun = first.perform({ kind: 'action', title: 'first' }, async () => {
        events.push('first-action');
      });
      await new Promise((resolve) => setTimeout(resolve, 15));
      const secondRun = second.perform({ kind: 'action', title: 'second' }, async () => events.push('second-action'));
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(events).toEqual(['first-action', 'first-evidence']);
      releaseEvidence();
      await Promise.all([firstRun, secondRun]);
      expect(events).toEqual(['first-action', 'first-evidence', 'second-action']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
