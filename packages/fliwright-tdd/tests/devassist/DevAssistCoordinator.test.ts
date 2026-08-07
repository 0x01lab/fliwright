import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { buildChangeSetSnapshot } from '@fliwright/core';
import { describe, expect, it, vi } from 'vitest';
import { DevAssistCoordinator } from '../../src/index.js';

describe('DevAssistCoordinator', () => {
  it('creates, runs, and traces an eligible generated candidate', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-devassist-coordinator-'));
    const runtime = {
      focus: vi.fn(async () => {}),
      cycle: vi.fn(async () => ({
        status: 'red' as const,
        testName: 'opens Markets',
        file: join(cwd, '.fliwright/generated/session-1.test.ts'),
        durationMs: 4,
        lastSync: 'reload' as const,
        baselineVersion: 1,
        failure: { message: 'Markets was not visible' },
        failureContext: {
          kind: 'missing-element' as const,
          artifacts: {
            timelinePath: '/tmp/runs/run-1/timeline.json',
            timelineNodeId: 'assertion-1',
          },
        },
      })),
    };
    const infer = vi.fn(async () => ({
      testName: 'opens Markets',
      provider: 'mock',
      model: 'mock-v1',
      spec: marketsSpec,
    }));
    const coordinator = new DevAssistCoordinator({
      cwd,
      runtime,
      infer,
      createSessionId: () => 'session-1',
      now: () => new Date('2026-08-07T00:00:00.000Z'),
      changeSetProvider: async () => buildChangeSetSnapshot({
        baseRevision: 'abc123',
        files: [{ path: 'lib/home.dart', status: 'modified', content: 'markets button' }],
      }),
      diagnose: async () => ({ summary: 'missing route', rootCause: 'handler', suggestedActions: ['wire Markets'], confidence: 0.9 }),
    });

    const result = await coordinator.cycle({ request: 'Open Markets and verify it is visible.' });

    const candidatePath = join(cwd, '.fliwright/generated/session-1.test.ts');
    expect(result).toMatchObject({
      status: 'red',
      devAssistSessionId: 'session-1',
      candidateTestPath: candidatePath,
      timelinePath: '/tmp/runs/run-1/timeline.json',
      timelineNodeId: 'assertion-1',
      sync: { decision: 'reload' },
      diagnosis: { rootCause: 'handler' },
      nextCall: { action: 'continue', devAssistSessionId: 'session-1' },
    });
    expect(infer).toHaveBeenCalledWith(expect.objectContaining({ request: 'Open Markets and verify it is visible.' }));
    expect(runtime.focus).toHaveBeenCalledWith(candidatePath, 'opens Markets');
    expect(runtime.cycle).toHaveBeenCalledWith('opens Markets', expect.objectContaining({
      sync: 'auto',
      changes: ['lib/home.dart'],
      autoEscalate: true,
    }));
    expect(await readFile(candidatePath, 'utf8')).toContain('test("opens Markets"');
  });

  it('continues the saved candidate without inferring a new test intent', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-devassist-continue-'));
    const candidatePath = join(cwd, '.fliwright/generated/session-2.test.ts');
    const runtime = {
      focus: vi.fn(async () => {}),
      cycle: vi.fn()
        .mockResolvedValueOnce({
          status: 'red', testName: 'opens Markets', file: candidatePath, durationMs: 1,
          lastSync: 'reload', baselineVersion: 1, failure: { message: 'missing Markets' },
        })
        .mockResolvedValueOnce({
          status: 'green', testName: 'opens Markets', file: candidatePath, durationMs: 1,
          lastSync: 'reload', baselineVersion: 2, timelinePath: '/tmp/runs/run-2/timeline.json',
        }),
    };
    const infer = vi.fn(async () => ({ testName: 'opens Markets', provider: 'mock', spec: marketsSpec }));
    let snapshot = 0;
    const coordinator = new DevAssistCoordinator({
      cwd,
      runtime,
      infer,
      createSessionId: () => 'session-2',
      changeSetProvider: async () => buildChangeSetSnapshot({
        files: [{ path: 'lib/home.dart', status: 'modified', content: `revision-${++snapshot}` }],
      }),
    });

    await coordinator.cycle({ request: 'Open Markets.' });
    const result = await coordinator.cycle({ devAssistSessionId: 'session-2' });

    expect(result).toMatchObject({
      status: 'green',
      devAssistSessionId: 'session-2',
      candidateTestPath: candidatePath,
      sync: { decision: 'reload' },
      timelinePath: '/tmp/runs/run-2/timeline.json',
    });
    expect(infer).toHaveBeenCalledTimes(1);
    expect(runtime.focus).toHaveBeenLastCalledWith(candidatePath, 'opens Markets');
    expect(runtime.cycle).toHaveBeenLastCalledWith('opens Markets', expect.objectContaining({
      changes: ['lib/home.dart'],
    }));
  });

  it('requires explicit regeneration when the saved candidate no longer matches its hash', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-devassist-stale-'));
    const candidatePath = join(cwd, '.fliwright/generated/session-3.test.ts');
    const runtime = {
      focus: vi.fn(async () => {}),
      cycle: vi.fn(async () => ({
        status: 'red' as const, testName: 'opens Markets', file: candidatePath, durationMs: 1,
        lastSync: 'reload' as const, baselineVersion: 1,
      })),
    };
    const coordinator = new DevAssistCoordinator({
      cwd,
      runtime,
      infer: async () => ({ testName: 'opens Markets', provider: 'mock', spec: marketsSpec }),
      createSessionId: () => 'session-3',
      changeSetProvider: async () => buildChangeSetSnapshot({
        files: [{ path: 'lib/home.dart', status: 'modified', content: 'changed' }],
      }),
    });

    await coordinator.cycle({ request: 'Open Markets.' });
    await writeFile(candidatePath, '// changed outside the session', 'utf8');
    const result = await coordinator.cycle({ devAssistSessionId: 'session-3', action: 'continue' });

    expect(result).toMatchObject({
      status: 'needs_regeneration',
      devAssistSessionId: 'session-3',
      nextCall: { action: 'regenerate', devAssistSessionId: 'session-3' },
    });
    expect(runtime.cycle).toHaveBeenCalledTimes(1);
  });

  it('does not run a candidate without a supported assertion', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-devassist-assertion-'));
    const runtime = { focus: vi.fn(async () => {}), cycle: vi.fn() };
    const coordinator = new DevAssistCoordinator({
      cwd,
      runtime,
      infer: async () => ({
        testName: 'opens Markets',
        provider: 'mock',
        spec: {
          elements: [{ id: 'markets', role: 'button', name: 'Markets', text: 'Markets' }],
          flows: [{ id: 'open-markets', name: 'opens Markets', steps: [{ action: 'tap', target: 'markets' }] }],
        },
      }),
      createSessionId: () => 'session-4',
      changeSetProvider: async () => buildChangeSetSnapshot({ files: [] }),
    });

    await expect(coordinator.cycle({ request: 'Open Markets.' })).resolves.toMatchObject({
      status: 'needs_review',
      reason: 'The inferred candidate has no supported assertion.',
    });
    expect(runtime.cycle).not.toHaveBeenCalled();
  });
});

const marketsSpec = {
  elements: [
    { id: 'markets', role: 'button' as const, name: 'Markets', text: 'Markets' },
    { id: 'markets-title', role: 'text' as const, name: 'Markets', text: 'Markets' },
  ],
  flows: [{
    id: 'open-markets',
    name: 'opens Markets',
    steps: [{ action: 'tap' as const, target: 'markets' }],
    expectedOutcome: [{ kind: 'visible' as const, target: 'markets-title' }],
  }],
};
