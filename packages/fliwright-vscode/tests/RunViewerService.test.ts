import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as vscode from 'vscode';
import { RunViewerService } from '../src/runviewer/RunViewerService.js';

it('uses the configured project run directory without selecting an old default', async () => {
  const project = mkdtempSync(join(tmpdir(), 'fliwright-viewer-storage-'));
  try {
    mkdirSync(join(project, 'history'));
    mkdirSync(join(project, '.fliwright/runs'), { recursive: true });
    writeFileSync(join(project, 'fliwright.config.ts'), "export default { runsRoot: 'history' };");
    const service = new RunViewerService();
    expect((await service.getRunsDir(vscode.Uri.file(project)))?.fsPath).toBe(join(project, 'history'));
    rmSync(join(project, 'history'), { recursive: true });
    expect(await service.getRunsDir(vscode.Uri.file(project))).toBeUndefined();
  } finally { rmSync(project, { recursive: true, force: true }); }
});

describe('RunViewerService.findLatestRunForTest', () => {
  let runsDir: string;
  let runsDirUri: vscode.Uri;

  beforeAll(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'fliwright-rv-'));
    runsDirUri = vscode.Uri.file(runsDir);
    // run-1 does NOT contain our node; run-2 DOES.
    // startedAt on run-2 is later so newest-first ordering picks it once the
    // node matches.
    mkdirSync(join(runsDir, 'run-1'), { recursive: true });
    writeFileSync(
      join(runsDir, 'run-1', 'result.json'),
      JSON.stringify({ results: [{ name: 'other > x' }] }),
    );
    writeFileSync(
      join(runsDir, 'run-1', 'timeline.json'),
      JSON.stringify({
        version: 2,
        runId: 'run-1',
        testName: 'x',
        mode: 'test',
        status: 'passed',
        startedAt: '2026-01-01T00:00:00Z',
        nodes: [],
      }),
    );

    mkdirSync(join(runsDir, 'run-2'), { recursive: true });
    writeFileSync(
      join(runsDir, 'run-2', 'result.json'),
      JSON.stringify({ results: [{ name: 'suite > wanted' }] }),
    );
    writeFileSync(
      join(runsDir, 'run-2', 'timeline.json'),
      JSON.stringify({
        version: 2,
        runId: 'run-2',
        testName: 'wanted',
        mode: 'test',
        status: 'passed',
        startedAt: '2026-06-21T00:00:00Z',
        nodes: [],
      }),
    );
  });
  afterAll(() => rmSync(runsDir, { recursive: true, force: true }));

  it('finds the latest run whose result.json contains the test node id', async () => {
    const svc = new RunViewerService();
    const run = await svc.findLatestRunForTest(runsDirUri, 'tests/a.test.ts::suite/wanted');
    expect(run?.timeline.runId).toBe('run-2');
  });

  it('loads trace data stored inside the run directory', async () => {
    mkdirSync(join(runsDir, 'run-2', 'trace'), { recursive: true });
    writeFileSync(
      join(runsDir, 'run-2', 'trace', 'trace.json'),
      JSON.stringify({
        meta: {
          testName: 'wanted',
          runId: 'run-2',
          startedAt: '2026-06-21T00:00:00Z',
          status: 'passed',
          totalSteps: 1,
          traceVersion: 1,
        },
        steps: [
          {
            index: 0,
            action: 'tap',
            selector: 'text=Submit',
            status: 'pass',
            durationMs: 5,
            timestamp: '2026-06-21T00:00:00Z',
          },
        ],
      }),
    );

    const svc = new RunViewerService();
    const loaded = await svc.loadRun(vscode.Uri.file(join(runsDir, 'run-2')));
    expect(loaded?.trace?.steps[0]?.selector).toBe('text=Submit');
  });

  it('finds a run by timeline testName when result.json has no entry', async () => {
    mkdirSync(join(runsDir, 'run-3'), { recursive: true });
    writeFileSync(
      join(runsDir, 'run-3', 'timeline.json'),
      JSON.stringify({
        version: 2,
        runId: 'run-3',
        testName: 'timeline only',
        mode: 'test',
        status: 'passed',
        startedAt: '2026-06-22T00:00:00Z',
        nodes: [],
      }),
    );

    const svc = new RunViewerService();
    const run = await svc.findLatestRunForTest(runsDirUri, 'tests/a.test.ts::timeline only');
    expect(run?.timeline.runId).toBe('run-3');
  });

  it('returns undefined when no run matches', async () => {
    const svc = new RunViewerService();
    const run = await svc.findLatestRunForTest(runsDirUri, 'tests/a.test.ts::none/here');
    expect(run).toBeUndefined();
  });
});

describe('RunViewerService.findLatestRunForScript', () => {
  let runsDir: string;
  let runsDirUri: vscode.Uri;

  beforeAll(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'fliwright-rv-script-'));
    runsDirUri = vscode.Uri.file(runsDir);

    // test-mode run first (older); script-mode run second (newer).
    mkdirSync(join(runsDir, 'r-test'), { recursive: true });
    writeFileSync(
      join(runsDir, 'r-test', 'timeline.json'),
      JSON.stringify({
        version: 2,
        runId: 'r-test',
        testName: 't',
        mode: 'test',
        status: 'passed',
        startedAt: '2026-01-01T00:00:00Z',
        nodes: [],
      }),
    );

    mkdirSync(join(runsDir, 'r-script'), { recursive: true });
    writeFileSync(
      join(runsDir, 'r-script', 'timeline.json'),
      JSON.stringify({
        version: 2,
        runId: 'r-script',
        testName: 'login.dart',
        mode: 'script',
        status: 'passed',
        startedAt: '2026-06-21T00:00:00Z',
        nodes: [],
      }),
    );
  });
  afterAll(() => rmSync(runsDir, { recursive: true, force: true }));

  it('does not attribute an unrelated script run to a source file', async () => {
    const svc = new RunViewerService();
    const run = await svc.findLatestRunForScript(runsDirUri, 'scripts/login.dart');
    expect(run).toBeUndefined();
  });

  it('selects the exact script file and attempt in a canonical multi-script run', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fliwright-script-identity-'));
    try {
      const runDir = join(root, 'run');
      const tests = [
        { testId: 'task-a', attempts: [
          { attemptId: 'retry-0', resultPath: 'tests/a/attempts/retry-0/result.json' },
          { attemptId: 'retry-1', resultPath: 'tests/a/attempts/retry-1/result.json' },
        ] },
        { testId: 'task-b', attempts: [
          { attemptId: 'retry-0', resultPath: 'tests/b/attempts/retry-0/result.json' },
        ] },
      ];
      for (const [testIndex, test] of tests.entries()) {
        for (const [attemptIndex, attempt] of test.attempts.entries()) {
          const dir = join(runDir, attempt.resultPath, '..');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'result.json'), JSON.stringify({
            testFile: `tasks/${testIndex === 0 ? 'a' : 'b'}/proof.script.ts`,
          }));
          writeFileSync(join(dir, 'timeline.json'), JSON.stringify({
            version: 2, runId: 'run', testName: 'same title', mode: 'script', status: 'passed',
            startedAt: `2026-10-17T00:00:0${testIndex * 2 + attemptIndex}Z`, nodes: [],
          }));
        }
      }
      writeFileSync(join(runDir, 'run.json'), JSON.stringify({
        schemaVersion: 1, runId: 'run', status: 'passed', evidenceStatus: 'complete', tests,
      }));
      const svc = new RunViewerService();
      expect((await svc.findLatestRunForScript(vscode.Uri.file(root), 'tasks/a/proof.script.ts'))?.runDir.fsPath)
        .toBe(join(runDir, 'tests/a/attempts/retry-1'));
      expect(await svc.findLatestRunForScript(vscode.Uri.file(root), 'tasks/c/proof.script.ts')).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('RunViewerService canonical manifest attempts', () => {
  it('resolves editor source identity to an opaque runner task ID', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fliwright-task-source-'));
    try {
      const runDir = join(root, 'run');
      const testId = '-1234_0';
      const attempts = [{ attemptId: 'attempt-0', resultPath: 'tests/task/attempts/attempt-0/result.json' }];
      const attemptDir = join(runDir, attempts[0].resultPath, '..');
      mkdirSync(attemptDir, { recursive: true });
      writeFileSync(join(runDir, 'run.json'), JSON.stringify({
        schemaVersion: 1, runId: 'run', status: 'passed', evidenceStatus: 'complete', tests: [{ testId, attempts }],
      }));
      writeFileSync(join(attemptDir, 'result.json'), JSON.stringify({
        testId, testFile: 'checks/counter.test.ts', testPath: ['suite', 'counter'],
      }));
      writeFileSync(join(attemptDir, 'timeline.json'), JSON.stringify({
        version: 2, runId: 'run', testName: 'counter', mode: 'test', status: 'passed',
        startedAt: '2026-10-17T00:00:00Z', nodes: [],
      }));
      const service = new RunViewerService();
      const nodeId = 'checks/counter.test.ts::suite/counter';
      expect((await service.findLatestRunForTest(vscode.Uri.file(root), nodeId))?.runDir.fsPath).toBe(attemptDir);
      expect((await service.findLatestRunForTestIndexed(vscode.Uri.file(root), nodeId,
        new Map([[nodeId, { runId: 'run' }]])))?.runDir.fsPath).toBe(attemptDir);
      expect(await service.findLatestRunForTest(vscode.Uri.file(root), 'other/counter.test.ts::suite/counter')).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('uses the manifest test identity before same-title legacy evidence', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'fliwright-rv-identity-'));
    try {
      const runDir = join(runsDir, 'run-same-title');
      const first = join(runDir, 'tests/file-a%3A%3Asame/attempts/attempt-0');
      const second = join(runDir, 'tests/file-b%3A%3Asame/attempts/attempt-0');
      mkdirSync(first, { recursive: true });
      mkdirSync(second, { recursive: true });
      writeFileSync(join(runDir, 'run.json'), JSON.stringify({
        schemaVersion: 1,
        runId: 'run-same-title',
        status: 'passed',
        evidenceStatus: 'complete',
        tests: [
          { testId: 'tests/file-a.ts::same', attempts: [{ attemptId: 'attempt-0', resultPath: 'tests/file-a%3A%3Asame/attempts/attempt-0/result.json' }] },
          { testId: 'tests/file-b.ts::same', attempts: [{ attemptId: 'attempt-0', resultPath: 'tests/file-b%3A%3Asame/attempts/attempt-0/result.json' }] },
        ],
      }));
      for (const [dir, marker] of [[first, 'A'], [second, 'B']] as const) {
        writeFileSync(join(dir, 'result.json'), '{}');
        writeFileSync(join(dir, 'timeline.json'), JSON.stringify({
          version: 2, runId: 'run-same-title', testName: 'same', mode: 'test', status: 'passed',
          startedAt: '2026-10-17T00:00:00Z', nodes: [{ id: marker, kind: 'action', title: marker, status: 'passed' }],
        }));
      }

      const service = new RunViewerService();
      const loaded = await service.findLatestRunForTest(vscode.Uri.file(runsDir), 'tests/file-b.ts::same');
      expect(loaded?.timeline.nodes[0]?.id).toBe('B');
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });

  it('loads the selected attempt from the manifest without scanning sibling directories', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'fliwright-rv-canonical-'));
    try {
      const runDir = join(runsDir, 'run-canonical');
      const first = join(runDir, 'tests/test-1/attempts/attempt-0');
      const second = join(runDir, 'tests/test-1/attempts/attempt-1');
      mkdirSync(first, { recursive: true });
      mkdirSync(second, { recursive: true });
      writeFileSync(join(runDir, 'run.json'), JSON.stringify({
        schemaVersion: 1,
        runId: 'run-canonical',
        status: 'passed',
        evidenceStatus: 'complete',
        tests: [{ testId: 'test-1', attempts: [
          { attemptId: 'attempt-0', resultPath: 'tests/test-1/attempts/attempt-0/result.json' },
          { attemptId: 'attempt-1', resultPath: 'tests/test-1/attempts/attempt-1/result.json' },
        ] }],
      }));
      writeFileSync(join(first, 'result.json'), '{}');
      writeFileSync(join(second, 'result.json'), '{}');
      for (const [dir, name, time] of [[first, 'first attempt', '2026-06-01T00:00:00Z'], [second, 'second attempt', '2026-06-02T00:00:00Z']] as const) {
        writeFileSync(join(dir, 'timeline.json'), JSON.stringify({
          version: 2, runId: 'run-canonical', testName: name, mode: 'test', status: 'passed', startedAt: time, nodes: [],
        }));
      }
      mkdirSync(join(runsDir, 'run-canonical-first-attempt'), { recursive: true });
      writeFileSync(join(runsDir, 'run-canonical-first-attempt', 'timeline.json'), JSON.stringify({
        version: 2, runId: 'guessed', testName: 'wrong', mode: 'test', status: 'passed', startedAt: '2026-06-03T00:00:00Z', nodes: [],
      }));

      const service = new RunViewerService();
      const summaries = await service.listRuns(vscode.Uri.file(runsDir));
      expect(summaries.filter((summary) => summary.runId === 'run-canonical').map((summary) => summary.attemptId))
        .toEqual(['attempt-1', 'attempt-0']);
      const selected = await service.loadRun(vscode.Uri.file(runDir), { testId: 'test-1', attemptId: 'attempt-0' });
      expect(selected?.timeline.testName).toBe('first attempt');
      await expect(service.loadRun(vscode.Uri.file(runDir))).resolves.toBeUndefined();
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });
});

describe('RunViewerService.findLatestRunForTestIndexed', () => {
  // Reuse the findLatestRunForTest fixture layout: run-1 (no match), run-2 (match).
  let runsDir: string;
  let runsDirUri: vscode.Uri;

  beforeAll(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'fliwright-rv-idx-'));
    runsDirUri = vscode.Uri.file(runsDir);
    mkdirSync(join(runsDir, 'run-1'), { recursive: true });
    writeFileSync(
      join(runsDir, 'run-1', 'result.json'),
      JSON.stringify({ results: [{ name: 'other > x' }] }),
    );
    writeFileSync(
      join(runsDir, 'run-1', 'timeline.json'),
      JSON.stringify({
        version: 2,
        runId: 'run-1',
        testName: 'x',
        mode: 'test',
        status: 'passed',
        startedAt: '2026-01-01T00:00:00Z',
        nodes: [],
      }),
    );
    mkdirSync(join(runsDir, 'run-2'), { recursive: true });
    writeFileSync(
      join(runsDir, 'run-2', 'result.json'),
      JSON.stringify({ results: [{ name: 'suite > wanted' }] }),
    );
    writeFileSync(
      join(runsDir, 'run-2', 'timeline.json'),
      JSON.stringify({
        version: 2,
        runId: 'run-2',
        testName: 'wanted',
        mode: 'test',
        status: 'passed',
        startedAt: '2026-06-21T00:00:00Z',
        nodes: [],
      }),
    );
  });
  afterAll(() => rmSync(runsDir, { recursive: true, force: true }));

  const nodeId = 'tests/a.test.ts::suite/wanted';

  it('uses the index entry directly when the run dir exists', async () => {
    const svc = new RunViewerService();
    const index = new Map<string, { runId: string }>([
      [nodeId, { runId: 'run-2' }],
    ]);
    const run = await svc.findLatestRunForTestIndexed(runsDirUri, nodeId, index);
    expect(run?.timeline.runId).toBe('run-2');
  });

  it('selects the indexed test from a canonical multi-test run', async () => {
    const runDir = join(runsDir, 'run-multi');
    const first = join(runDir, 'tests/test-a/attempts/attempt-0');
    const second = join(runDir, 'tests/test-b/attempts/attempt-0');
    mkdirSync(first, { recursive: true });
    mkdirSync(second, { recursive: true });
    writeFileSync(join(runDir, 'run.json'), JSON.stringify({
      schemaVersion: 1,
      runId: 'run-multi',
      status: 'passed',
      evidenceStatus: 'complete',
      tests: [
        { testId: 'tests/a.test.ts::same', attempts: [{ attemptId: 'attempt-0', resultPath: 'tests/test-a/attempts/attempt-0/result.json' }] },
        { testId: 'tests/b.test.ts::same', attempts: [{ attemptId: 'attempt-0', resultPath: 'tests/test-b/attempts/attempt-0/result.json' }] },
      ],
    }));
    for (const [dir, marker] of [[first, 'A'], [second, 'B']] as const) {
      writeFileSync(join(dir, 'result.json'), '{}');
      writeFileSync(join(dir, 'timeline.json'), JSON.stringify({
        version: 2,
        runId: 'run-multi',
        testName: 'same',
        mode: 'test',
        status: 'passed',
        startedAt: '2026-06-23T00:00:00Z',
        nodes: [{ id: marker, kind: 'action', title: marker, status: 'passed' }],
      }));
    }

    const svc = new RunViewerService();
    const index = new Map<string, { runId: string }>([
      ['tests/b.test.ts::same', { runId: 'run-multi' }],
    ]);
    const run = await svc.findLatestRunForTestIndexed(runsDirUri, 'tests/b.test.ts::same', index);
    expect(run?.runDir.fsPath).toBe(second);
    expect(run?.timeline.nodes[0]?.id).toBe('B');
  });

  it('derives the timeline run id from resultRunId for current VS Code records', async () => {
    const svc = new RunViewerService();
    const baseRunId = '2026-06-22T10-00-00';
    const indexedNodeId = 'tests/a.test.ts::suite/indexed wanted';
    const timelineRunId = `${baseRunId}-suite-indexed-wanted`;
    mkdirSync(join(runsDir, timelineRunId), { recursive: true });
    writeFileSync(
      join(runsDir, timelineRunId, 'timeline.json'),
      JSON.stringify({
        version: 2,
        runId: timelineRunId,
        testName: 'suite > indexed wanted',
        mode: 'test',
        status: 'passed',
        startedAt: '2026-06-22T10:00:00Z',
        nodes: [],
      }),
    );
    const index = new Map<string, { runId: string; resultRunId: string }>([
      [indexedNodeId, { runId: 'stale-result-dir', resultRunId: baseRunId }],
    ]);

    const run = await svc.findLatestRunForTestIndexed(runsDirUri, indexedNodeId, index);
    expect(run?.timeline.runId).toBe(timelineRunId);
  });

  it('derives the leaf timeline run id for nested suites', async () => {
    const svc = new RunViewerService();
    const baseRunId = '2026-06-22T10-00-01';
    const nestedNodeId = 'tests/a.test.ts::suite/nested leaf';
    const timelineRunId = `${baseRunId}-nested-leaf`;
    mkdirSync(join(runsDir, timelineRunId), { recursive: true });
    writeFileSync(
      join(runsDir, timelineRunId, 'timeline.json'),
      JSON.stringify({
        version: 2,
        runId: timelineRunId,
        testName: 'nested leaf',
        mode: 'test',
        status: 'passed',
        startedAt: '2026-06-22T10:00:01Z',
        nodes: [],
      }),
    );
    const index = new Map<string, { runId: string; resultRunId: string }>([
      [nestedNodeId, { runId: 'stale-result-dir', resultRunId: baseRunId }],
    ]);

    const run = await svc.findLatestRunForTestIndexed(runsDirUri, nestedNodeId, index);
    expect(run?.timeline.runId).toBe(timelineRunId);
  });

  it('falls back to the scan when the indexed run dir is pruned', async () => {
    const svc = new RunViewerService();
    // Index points at a runId whose directory does not exist; scan should still
    // find run-2 via result.json matching.
    const index = new Map<string, { runId: string }>([
      [nodeId, { runId: 'pruned-gone' }],
    ]);
    const run = await svc.findLatestRunForTestIndexed(runsDirUri, nodeId, index);
    expect(run?.timeline.runId).toBe('run-2');
  });

  it('falls back to the scan when there is no index entry', async () => {
    const svc = new RunViewerService();
    const run = await svc.findLatestRunForTestIndexed(runsDirUri, nodeId, new Map());
    expect(run?.timeline.runId).toBe('run-2');
  });

  it('returns undefined when neither index nor scan matches', async () => {
    const svc = new RunViewerService();
    const run = await svc.findLatestRunForTestIndexed(
      runsDirUri,
      'tests/a.test.ts::nope',
      new Map(),
    );
    expect(run).toBeUndefined();
  });
});
