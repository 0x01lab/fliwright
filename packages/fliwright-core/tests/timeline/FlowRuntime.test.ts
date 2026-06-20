import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
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

  it('records manual checkpoints as timeline nodes', async () => {
    const { recorder, flow } = createFlow();
    const confirm = vi.fn().mockResolvedValue(undefined);

    await flow.manual('Complete captcha', {
      message: 'Please complete the captcha',
      timeoutMs: 1000,
      metadata: { reason: 'captcha' },
      confirm,
    });

    expect(confirm).toHaveBeenCalledWith('Please complete the captcha', {
      signal: expect.any(AbortSignal),
    });
    expect(recorder.toJSON().nodes[0]).toMatchObject({
      kind: 'manual',
      title: 'Complete captcha',
      status: 'passed',
      metadata: {
        message: 'Please complete the captcha',
        timeoutMs: 1000,
        reason: 'captcha',
      },
    });
  });

  it('fails manual checkpoints when confirmation times out', async () => {
    vi.useFakeTimers();
    try {
      const { recorder, flow } = createFlow();
      const confirm = vi.fn((_prompt: string, options: { signal: AbortSignal }) => new Promise<void>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('manual confirmation aborted')));
      }));

      const wait = expect(flow.manual('Complete external approval', {
        timeoutMs: 100,
        confirm,
      })).rejects.toBeInstanceOf(FliwrightAgentError);
      await vi.advanceTimersByTimeAsync(100);

      await wait;
      expect(recorder.toJSON().nodes[0]).toMatchObject({
        kind: 'manual',
        title: 'Complete external approval',
        status: 'failed',
        metadata: {
          message: 'Complete external approval',
          timeoutMs: 100,
          manual: true,
        },
        error: {
          code: 'step_failed',
          title: 'Complete external approval',
          message: 'manual confirmation aborted',
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes manual checkpoints when the app condition becomes true', async () => {
    vi.useFakeTimers();
    try {
      const { recorder, flow } = createFlow();
      let completed = false;

      const wait = flow.manual('Complete captcha in app', {
        message: 'Complete the captcha in the running app.',
        timeoutMs: 1_000,
        pollIntervalMs: 50,
        resumeWhen: () => completed,
      });

      await vi.advanceTimersByTimeAsync(100);
      completed = true;
      await vi.advanceTimersByTimeAsync(50);
      await wait;

      expect(recorder.toJSON().nodes[0]).toMatchObject({
        kind: 'manual',
        title: 'Complete captcha in app',
        status: 'passed',
        metadata: {
          message: 'Complete the captcha in the running app.',
          timeoutMs: 1_000,
          pollIntervalMs: 50,
          completion: 'resumeWhen',
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for a manual continue file when no confirm callback is provided', async () => {
    const manualDir = await mkdtemp(join(tmpdir(), 'fliwright-manual-'));
    const previousManualDir = process.env.FLIWRIGHT_MANUAL_DIR;
    process.env.FLIWRIGHT_MANUAL_DIR = manualDir;
    try {
      const { recorder, flow } = createFlow();
      const wait = flow.manual('Complete captcha', {
        message: 'Please complete the captcha',
        timeoutMs: 2_000,
      });

      let requestFile: string | undefined;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        requestFile = (await readdir(manualDir)).find((entry) => entry.endsWith('.json') && !entry.includes('.continue.'));
        if (requestFile) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(requestFile).toBeDefined();
      const request = JSON.parse(await readFile(join(manualDir, requestFile!), 'utf8'));
      expect(request).toMatchObject({
        status: 'waiting',
        message: 'Please complete the captcha',
      });

      await writeFile(request.continueFile, '{}');
      await wait;

      expect(recorder.toJSON().nodes[0]).toMatchObject({
        kind: 'manual',
        title: 'Complete captcha',
        status: 'passed',
      });
    } finally {
      if (previousManualDir === undefined) {
        delete process.env.FLIWRIGHT_MANUAL_DIR;
      } else {
        process.env.FLIWRIGHT_MANUAL_DIR = previousManualDir;
      }
    }
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
