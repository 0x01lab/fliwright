import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServerState } from '../src/state.js';
import { handleTimelineGet } from '../src/tools/timeline.js';

describe('handleTimelineGet', () => {
  it('returns a friendly error when no timeline is available', async () => {
    const state = createServerState();

    await expect(handleTimelineGet({}, state)).resolves.toEqual({
      error: 'No timeline is available. Run fliwright_run first or pass path.',
    });
  });

  it('reads the latest run timeline and strips artifacts by default', async () => {
    const path = await writeTimeline();
    const state = createServerState();
    state.setLastRunResult({
      passed: true,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      duration: 1,
      results: [],
      artifacts: {
        runId: 'run-1',
        outputDir: '/tmp/run-1',
        screenshots: [],
        timelines: [path],
      },
    });

    const result = await handleTimelineGet({}, state) as { timeline: { nodes: Array<{ artifacts?: unknown[] }> } };

    expect(result.timeline.nodes[0].artifacts).toBeUndefined();
  });

  it('returns a selected node with surrounding context', async () => {
    const path = await writeTimeline();
    const state = createServerState();

    const result = await handleTimelineGet({ path, nodeId: 'step-2', includeArtifacts: true }, state) as {
      node: { id: string; artifacts?: unknown[] };
      parent: { id: string };
      previous: { id: string };
      next: { id: string };
    };

    expect(result.node.id).toBe('step-2');
    expect(result.node.artifacts).toHaveLength(1);
    expect(result.parent.id).toBe('page-1');
    expect(result.previous.id).toBe('page-1');
    expect(result.next.id).toBe('step-3');
  });
});

async function writeTimeline(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fliwright-mcp-timeline-'));
  const path = join(dir, 'timeline.json');
  await writeFile(path, JSON.stringify({
    version: 1,
    runId: 'run-1',
    testName: 'timeline test',
    mode: 'test',
    status: 'passed',
    startedAt: '2026-06-18T00:00:00.000Z',
    nodes: [
      { id: 'page-1', kind: 'page', title: 'Register', status: 'passed', startedAt: 'x', endedAt: 'x' },
      {
        id: 'step-2',
        parentId: 'page-1',
        kind: 'step',
        title: 'Fill',
        status: 'passed',
        startedAt: 'x',
        endedAt: 'x',
        artifacts: [{ kind: 'screenshot', path: 'artifacts/screenshots/step-2.png' }],
      },
      { id: 'step-3', parentId: 'page-1', kind: 'step', title: 'Submit', status: 'passed', startedAt: 'x', endedAt: 'x' },
    ],
  }), 'utf8');
  return path;
}
