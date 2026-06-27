import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as vscode from 'vscode';
import { RunArtifactStore } from '../src/testing/RunArtifactStore.js';
import type { RunResult } from '../src/types.js';

describe('RunArtifactStore', () => {
  it('records result.json and indexes the matching timeline run id', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fliwright-home-'));
    const root = vscode.Uri.file('/repos/app');
    const store = new RunArtifactStore({ homeDir: home });
    const result: RunResult = {
      passed: true,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      duration: 12,
      results: [{ name: 'suite > case A', passed: true, duration: 12 }],
    };

    await store.recordTestRun(root, result, 'tests/a.test.ts', {
      baseRunId: '2026-06-22T10-00-00',
      ranAt: 1000,
    });

    const runsDir = store.runsDir(root);
    expect(existsSync(join(runsDir, '2026-06-22T10-00-00', 'result.json'))).toBe(true);
    const index = JSON.parse(readFileSync(join(runsDir, 'index.json'), 'utf8'));
    expect(index['tests/a.test.ts::suite/case A']).toMatchObject({
      runId: '2026-06-22T10-00-00-suite-case-A',
      resultRunId: '2026-06-22T10-00-00',
      status: 'passed',
    });
  });

  it('indexes workspace run results by each vitest file path', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fliwright-home-'));
    const root = vscode.Uri.file('/repos/app');
    const store = new RunArtifactStore({ homeDir: home });
    const result: RunResult = {
      passed: true,
      totalTests: 2,
      passedTests: 2,
      failedTests: 0,
      duration: 20,
      results: [
        { filePath: '/repos/app/tests/a.test.ts', name: 'suite > case A', passed: true, duration: 8 },
        { filePath: 'tests/b.test.ts', name: 'case B', passed: true, duration: 12 },
      ],
    };

    await store.recordTestRun(root, result, 'tests', {
      baseRunId: '2026-06-22T10-00-01',
      ranAt: 1000,
    });

    const index = JSON.parse(readFileSync(join(store.runsDir(root), 'index.json'), 'utf8'));
    expect(index['tests/a.test.ts::suite/case A']).toMatchObject({ status: 'passed' });
    expect(index['tests/b.test.ts::case B']).toMatchObject({ status: 'passed' });
  });

  it('keeps the known file relPath when vitest reports only a basename', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fliwright-home-'));
    const root = vscode.Uri.file('/repos/app');
    const store = new RunArtifactStore({ homeDir: home });
    const result: RunResult = {
      passed: true,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      duration: 10,
      results: [
        { filePath: 'a.test.ts', name: 'case A', passed: true, duration: 8 },
      ],
    };

    await store.recordTestRun(root, result, 'tests/a.test.ts', {
      baseRunId: '2026-06-22T10-00-02',
      ranAt: 1000,
    });

    const index = JSON.parse(readFileSync(join(store.runsDir(root), 'index.json'), 'utf8'));
    expect(index['tests/a.test.ts::case A']).toMatchObject({ status: 'passed' });
  });

  it('prunes older test run directories once a newer result is indexed', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fliwright-home-'));
    const root = vscode.Uri.file('/repos/app');
    const store = new RunArtifactStore({ homeDir: home });
    const result: RunResult = {
      passed: true,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      duration: 10,
      results: [{ name: 'case A', passed: true, duration: 8 }],
    };

    await store.recordTestRun(root, result, 'tests/a.test.ts', {
      baseRunId: '2026-06-22T10-00-03',
      ranAt: 1000,
    });
    const oldRunDir = join(store.runsDir(root), '2026-06-22T10-00-03-case-A');
    mkdirSync(oldRunDir, { recursive: true });
    writeFileSync(join(oldRunDir, 'timeline.json'), JSON.stringify({
      runId: '2026-06-22T10-00-03-case-A',
      testName: 'case A',
      mode: 'test',
      status: 'passed',
      startedAt: '2026-06-22T10:00:03Z',
      nodes: [],
    }));

    await store.recordTestRun(root, result, 'tests/a.test.ts', {
      baseRunId: '2026-06-22T10-00-04',
      ranAt: 2000,
    });

    expect(existsSync(join(store.runsDir(root), '2026-06-22T10-00-03'))).toBe(false);
    expect(existsSync(oldRunDir)).toBe(false);
    expect(existsSync(join(store.runsDir(root), '2026-06-22T10-00-04'))).toBe(true);
  });

  it('does not prune script run directories', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fliwright-home-'));
    const root = vscode.Uri.file('/repos/app');
    const store = new RunArtifactStore({ homeDir: home });
    const scriptRunDir = join(store.runsDir(root), 'script-run');
    mkdirSync(scriptRunDir, { recursive: true });
    writeFileSync(join(scriptRunDir, 'timeline.json'), JSON.stringify({
      runId: 'script-run',
      testName: 'my.script.ts',
      mode: 'script',
      status: 'passed',
      startedAt: '2026-06-22T10:00:00Z',
      nodes: [],
    }));

    const result: RunResult = {
      passed: true,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      duration: 10,
      results: [{ name: 'case A', passed: true, duration: 8 }],
    };
    await store.recordTestRun(root, result, 'tests/a.test.ts', {
      baseRunId: '2026-06-22T10-00-05',
      ranAt: 1000,
    });

    expect(existsSync(scriptRunDir)).toBe(true);
  });

  it('does not create a separate traces directory for new runs', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fliwright-home-'));
    const root = vscode.Uri.file('/repos/app');
    const store = new RunArtifactStore({ homeDir: home });

    await store.ensureRunsDir(root);

    expect(existsSync(store.runsDir(root))).toBe(true);
    expect(existsSync(store.traceDir(root))).toBe(false);
  });
});
