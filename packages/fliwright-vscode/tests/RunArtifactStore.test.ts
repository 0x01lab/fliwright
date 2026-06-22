import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
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

  it('creates a separate traces directory alongside runs', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fliwright-home-'));
    const root = vscode.Uri.file('/repos/app');
    const store = new RunArtifactStore({ homeDir: home });

    await store.ensureRunsDir(root);

    expect(existsSync(store.runsDir(root))).toBe(true);
    expect(existsSync(store.traceDir(root))).toBe(true);
    expect(store.traceDir(root)).toBe(join(home, '.fliwright', 'projects', 'repos-app', 'traces'));
  });
});
