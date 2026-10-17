import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  projectRunsRoot,
  TIMELINE_ARTIFACTS_DIR,
  TIMELINE_DIAGNOSTICS_DIR,
  TIMELINE_FILE_NAME,
  TIMELINE_SCREENSHOTS_DIR,
  TIMELINE_SNAPSHOTS_DIR,
  TimelineArtifactStore,
  TimelineRecorder,
} from '../../src/index.js';

describe('TimelineArtifactStore', () => {
  it('does not replace a terminal timeline with an aborted pending write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-timeline-abort-'));
    try {
      const store = new TimelineArtifactStore({ runId: 'r', attemptDir: root });
      const recorder = new TimelineRecorder({ runId: 'r', testName: 'aborted persistence' });
      const final = recorder.complete('failed');
      await store.writeTimeline(final);
      const controller = new AbortController();
      const late = store.writeTimeline({ ...final, status: 'running' }, { signal: controller.signal });
      controller.abort(new Error('finalization deadline'));
      await expect(late).rejects.toThrow('finalization deadline');
      expect(JSON.parse(await readFile(store.timelinePath, 'utf8'))).toEqual(final);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('keeps every relative artifact inside its canonical attempt directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-attempt-store-'));
    try {
      const attemptDir = join(root, 'r/tests/t/attempts/a');
      const store = new TimelineArtifactStore({ runId: 'r', attemptDir });
      const ref = await store.writeScreenshot('failure', Buffer.from('png'));
      expect(store.runDir).toBe(attemptDir);
      expect(await readFile(join(attemptDir, ref.path), 'utf8')).toBe('png');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('writes timeline and deterministic artifact refs', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-timeline-'));
    const runsRoot = join(cwd, 'runs-root');
    const store = new TimelineArtifactStore({ cwd, runsRoot, runId: 'run-1' });
    const recorder = new TimelineRecorder({ runId: 'run-1', testName: 'artifact test' });
    const frame = recorder.startNode('frame', 'Visible form');

    const screenshot = await store.writeScreenshot(frame.id, Buffer.from('png'));
    const snapshot = await store.writeSnapshot(frame.id, { snapshot: '- text "Hello"' });
    const diagnostics = await store.writeDiagnostics(frame.id, { focused: null });
    recorder.addArtifacts(frame.id, [screenshot, snapshot, diagnostics]);
    recorder.passNode(frame.id);
    const timelinePath = await store.writeTimeline(recorder.complete('passed'));

    expect(timelinePath).toBe(join(runsRoot, 'run-1', TIMELINE_FILE_NAME));
    expect(await readFile(join(store.runDir, screenshot.path), 'utf8')).toBe('png');
    expect(JSON.parse(await readFile(join(store.runDir, snapshot.path), 'utf8'))).toEqual({
      snapshot: '- text "Hello"',
    });
    const timeline = JSON.parse(await readFile(timelinePath, 'utf8')) as { nodes: Array<{ artifacts?: Array<{ path: string }> }> };
    expect(timeline.nodes[0].artifacts?.map((artifact) => artifact.path)).toEqual([
      posix.join(TIMELINE_ARTIFACTS_DIR, TIMELINE_SCREENSHOTS_DIR, 'frame-1.png'),
      posix.join(TIMELINE_ARTIFACTS_DIR, TIMELINE_SNAPSHOTS_DIR, 'frame-1.json'),
      posix.join(TIMELINE_ARTIFACTS_DIR, TIMELINE_DIAGNOSTICS_DIR, 'frame-1.json'),
    ]);
  });
});

describe('TimelineArtifactStore runsRoot', () => {
  let sandbox: string;
  beforeAll(async () => {
    sandbox = await makeSandbox();
  });
  afterAll(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('uses the per-project home runs root when no runsRoot and no env', () => {
    const store = new TimelineArtifactStore({ cwd: sandbox, runId: 'r1' });
    expect(store.runDir).toBe(join(projectRunsRoot(sandbox).runsDir, 'r1'));
  });

  it('uses options.runsRoot when provided', () => {
    const custom = join(sandbox, 'custom-runs');
    const store = new TimelineArtifactStore({ cwd: sandbox, runsRoot: custom, runId: 'r2' });
    expect(store.runDir).toBe(join(custom, 'r2'));
  });

  it('writes timeline.json under runsRoot', async () => {
    const custom = join(sandbox, 'custom-runs');
    const store = new TimelineArtifactStore({ runsRoot: custom, runId: 'r3' });
    await store.writeTimeline({ version: 2, runId: 'r3', testName: 't', mode: 'test', status: 'passed', startedAt: '', nodes: [] });
    const written = await readFile(store.timelinePath, 'utf8');
    expect(JSON.parse(written).runId).toBe('r3');
  });
});

async function makeSandbox(): Promise<string> {
  const dir = join(tmpdir(), `fliwright-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
