import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TimelineArtifactStore, TimelineRecorder } from '../../src/index.js';

describe('TimelineArtifactStore', () => {
  it('writes timeline and deterministic artifact refs', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-timeline-'));
    const store = new TimelineArtifactStore({ cwd, runId: 'run-1' });
    const recorder = new TimelineRecorder({ runId: 'run-1', testName: 'artifact test' });
    const frame = recorder.startNode('frame', 'Visible form');

    const screenshot = await store.writeScreenshot(frame.id, Buffer.from('png'));
    const snapshot = await store.writeSnapshot(frame.id, { snapshot: '- text "Hello"' });
    const diagnostics = await store.writeDiagnostics(frame.id, { focused: null });
    recorder.addArtifacts(frame.id, [screenshot, snapshot, diagnostics]);
    recorder.passNode(frame.id);
    const timelinePath = await store.writeTimeline(recorder.complete('passed'));

    expect(timelinePath).toBe(join(cwd, '.fliwright', 'runs', 'run-1', 'timeline.json'));
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
