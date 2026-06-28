import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projectRunsRoot, TimelineArtifactStore, TimelineRecorder } from '../../src/index.js';

describe('TimelineArtifactStore', () => {
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

    expect(timelinePath).toBe(join(runsRoot, 'run-1', 'timeline.json'));
    expect(await readFile(join(store.runDir, screenshot.path), 'utf8')).toBe('png');
    expect(JSON.parse(await readFile(join(store.runDir, snapshot.path), 'utf8'))).toEqual({
      snapshot: '- text "Hello"',
    });
    const timeline = JSON.parse(await readFile(timelinePath, 'utf8')) as { nodes: Array<{ artifacts?: Array<{ path: string }> }> };
    expect(timeline.nodes[0].artifacts?.map((artifact) => artifact.path)).toEqual([
      'artifacts/screenshots/frame-1.png',
      'artifacts/snapshots/frame-1.json',
      'artifacts/diagnostics/frame-1.json',
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
    await store.writeTimeline({ version: 1, runId: 'r3', testName: 't', mode: 'test', status: 'passed', startedAt: '', nodes: [] });
    const written = await readFile(store.timelinePath, 'utf8');
    expect(JSON.parse(written).runId).toBe('r3');
  });
});

async function makeSandbox(): Promise<string> {
  const dir = join(tmpdir(), `fliwright-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
