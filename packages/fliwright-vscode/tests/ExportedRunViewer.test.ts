import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { artifactsExportCommand } from '@fliwright/cli/run';
import { RunViewerService } from '../src/runviewer/RunViewerService.js';

it('opens an exported canonical attempt and resolves its evidence after the source run is removed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-view-export-'));
  try {
    const source = join(root, 'runs', 'run-native');
    const attempt = 'tests/test-one/attempts/attempt-0';
    const attemptDir = join(source, attempt);
    await mkdir(join(attemptDir, 'trace'), { recursive: true });
    await writeFile(join(source, 'run.json'), JSON.stringify({ schemaVersion: 1,
      runId: 'run-native', status: 'passed', evidenceStatus: 'complete',
      tests: [{ testId: 'test-one', attempts: [{ attemptId: 'attempt-0', resultPath: attempt + '/result.json' }] }],
    }));
    await writeFile(join(source, 'report.json'), JSON.stringify({ artifacts: { outputDir: source,
      timelines: [join(attemptDir, 'timeline.json')], screenshots: [join(attemptDir, 'frame.png')] } }));
    await writeFile(join(attemptDir, 'result.json'), JSON.stringify({ evidenceStatus: 'complete', evidence: [
      { result: { status: 'captured', artifactPaths: ['frame.png'] } },
    ] }));
    await writeFile(join(attemptDir, 'timeline.json'), JSON.stringify({ version: 2, runId: 'run-native',
      testName: 'exported test', mode: 'test', status: 'passed', startedAt: '2026-10-17T00:00:00Z',
      nodes: [{ id: 'save', kind: 'action', title: 'Save', status: 'passed', startedAt: '2026-10-17T00:00:00Z',
        artifacts: [{ kind: 'screenshot', path: 'frame.png' }] }],
    }));
    await writeFile(join(attemptDir, 'trace/trace.json'), JSON.stringify({ meta: { traceVersion: 1, runId: 'run-native',
      testName: 'exported test', startedAt: '2026-10-17T00:00:00Z', status: 'passed', totalSteps: 1 },
      steps: [{ index: 0, action: 'tap', selector: 'key=save', status: 'pass', durationMs: 1,
        timestamp: '2026-10-17T00:00:00Z', screenshotFile: '../frame.png' }],
    }));
    await writeFile(join(attemptDir, 'frame.png'), 'frame');
    const moved = join(root, 'portable', 'renamed-export');
    await artifactsExportCommand({ runsRoot: join(root, 'runs'), runId: 'run-native', output: moved });
    await rm(join(root, 'runs'), { recursive: true });
    const viewer = new RunViewerService();
    const summaries = await viewer.listRuns(vscode.Uri.file(dirname(moved)));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ runId: 'run-native', testId: 'test-one', attemptId: 'attempt-0' });
    const loaded = await viewer.loadRun(vscode.Uri.file(moved), summaries[0]);
    expect(loaded?.timeline.testName).toBe('exported test');
    const screenshot = loaded!.timeline.nodes[0].artifacts![0].path;
    expect(await readFile(join(loaded!.runDir.fsPath, screenshot), 'utf8')).toBe('frame');
    expect(await readFile(join(loaded!.runDir.fsPath, 'trace', loaded!.trace!.steps[0].screenshotFile!), 'utf8')).toBe('frame');
  } finally { await rm(root, { recursive: true, force: true }); }
});
