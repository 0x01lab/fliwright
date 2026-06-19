import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  FliwrightAgentError,
  FlowRuntime,
  TimelineArtifactStore,
  TimelineRecorder,
  type AgentSnapshotResult,
  type Page,
} from '../../src/index.js';

function createFlow(page?: Page) {
  const recorder = new TimelineRecorder({ runId: 'run-1', testName: 'flow test', mode: 'script' });
  const store = new TimelineArtifactStore({ cwd: join(tmpdir(), `fliwright-flow-${Date.now()}`), runId: 'run-1' });
  return { recorder, store, flow: new FlowRuntime({ recorder, artifactStore: store, page }) };
}

describe('FlowRuntime', () => {
  it('wraps successful steps and pages', async () => {
    const { recorder, flow } = createFlow();

    const value = await flow.page('Register', { route: '/register' }, async () => {
      return flow.step('Generate data', () => ({ email: 'ada@example.com' }));
    });

    expect(value.email).toBe('ada@example.com');
    const data = recorder.complete('passed');
    expect(data.nodes.map((node) => [node.kind, node.title, node.status])).toEqual([
      ['page', 'Register', 'passed'],
      ['step', 'Generate data', 'passed'],
    ]);
  });

  it('skips optional steps when when is false', async () => {
    const { recorder, flow } = createFlow();

    const value = await flow.optional('Submit', { when: false }, () => 'submitted');

    expect(value).toBeUndefined();
    expect(recorder.toJSON().nodes[0]).toMatchObject({ kind: 'optional', status: 'skipped' });
  });

  it('wraps failed steps in FliwrightAgentError', async () => {
    const { recorder, flow } = createFlow();

    await expect(flow.step('Tap submit', () => {
      throw new Error('Target is obscured');
    })).rejects.toBeInstanceOf(FliwrightAgentError);

    const data = recorder.toJSON();
    expect(data.nodes[0]).toMatchObject({
      status: 'failed',
      error: { code: 'step_failed', title: 'Tap submit' },
    });
  });

  it('captures frame artifacts through legacy screenshot and snapshot fallback', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-flow-frame-'));
    const page = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from('png')),
      snapshot: vi.fn().mockResolvedValue({
        snapshot: '- button "Next" [ref=e1]',
        groupId: 'snap-1',
        refs: [],
        count: 1,
      } satisfies AgentSnapshotResult),
    } as unknown as Page;
    const recorder = new TimelineRecorder({ runId: 'run-frame', testName: 'frame test' });
    const store = new TimelineArtifactStore({ cwd, runId: 'run-frame' });
    const flow = new FlowRuntime({ recorder, artifactStore: store, page });

    const artifacts = await flow.frame('Register form visible', { screenshot: true, snapshot: true });

    expect(artifacts.map((artifact) => artifact.kind)).toEqual(['screenshot', 'snapshot']);
    expect(await readFile(join(store.runDir, artifacts[0].path), 'utf8')).toBe('png');
    expect(page.screenshot).toHaveBeenCalled();
    expect(page.snapshot).toHaveBeenCalled();
  });

  it('keeps frame artifacts best-effort when screenshot capture fails', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-flow-frame-'));
    const page = {
      screenshot: vi.fn().mockRejectedValue(new Error('screenshot failed')),
      snapshot: vi.fn().mockResolvedValue({
        snapshot: '- text "Register" [ref=e1]',
        groupId: 'snap-1',
        refs: [],
        count: 1,
      } satisfies AgentSnapshotResult),
    } as unknown as Page;
    const recorder = new TimelineRecorder({ runId: 'run-frame', testName: 'frame test' });
    const store = new TimelineArtifactStore({ cwd, runId: 'run-frame' });
    const flow = new FlowRuntime({ recorder, artifactStore: store, page });

    const artifacts = await flow.frame('Register form filled', { screenshot: true, snapshot: true });

    expect(artifacts.map((artifact) => artifact.kind)).toEqual(['snapshot']);
    expect(page.screenshot).toHaveBeenCalled();
    expect(page.snapshot).toHaveBeenCalled();
  });
});
