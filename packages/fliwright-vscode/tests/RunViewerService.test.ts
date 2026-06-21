import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as vscode from 'vscode';
import { RunViewerService } from '../src/runviewer/RunViewerService.js';

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

  it('returns the newest script-mode run', async () => {
    const svc = new RunViewerService();
    const run = await svc.findLatestRunForScript(runsDirUri, 'scripts/login.dart');
    expect(run?.timeline.runId).toBe('r-script');
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
