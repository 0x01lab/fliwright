import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TestStatusStore } from '../src/testing/TestStatusStore.js';
import type { RunResult } from '../src/types.js';

const fakeRoot = (fsPath: string) => ({ fsPath, scheme: 'file' } as any);

describe('TestStatusStore', () => {
  let runsDir: string;
  beforeAll(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'fliwright-runs-'));
  });
  afterAll(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  const result: RunResult = {
    passed: false,
    totalTests: 2,
    passedTests: 1,
    failedTests: 1,
    duration: 10,
    results: [
      { name: 'suite > case A', passed: true, duration: 3 },
      { name: 'suite > case B', passed: false, duration: 4, error: 'boom' },
    ],
  };

  it('writes result.json and index.json keyed by node id', async () => {
    const store = new TestStatusStore(runsDir);
    await store.recordRun('run-1', 1000, fakeRoot('/repo'), result, 'tests/a.test.ts');

    const idx = JSON.parse(readFileSync(join(runsDir, 'index.json'), 'utf8'));
    expect(idx['tests/a.test.ts::suite/case A']).toMatchObject({ status: 'passed', runId: 'run-1-suite-case-A', resultRunId: 'run-1' });
    expect(idx['tests/a.test.ts::suite/case B']).toMatchObject({ status: 'failed', runId: 'run-1-suite-case-B', resultRunId: 'run-1' });
    expect(existsSync(join(runsDir, 'run-1', 'result.json'))).toBe(true);
  });

  it('uses per-test file paths when a workspace run reports multiple files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fliwright-runs-workspace-'));
    const store = new TestStatusStore(dir);
    await store.recordRun('run-2', 1000, fakeRoot('/repo'), {
      passed: true,
      totalTests: 2,
      passedTests: 2,
      failedTests: 0,
      duration: 10,
      results: [
        { filePath: '/repo/tests/a.test.ts', name: 'suite > case A', passed: true, duration: 3 },
        { filePath: 'tests/b.test.ts', name: 'case B', passed: true, duration: 4 },
      ],
    }, 'tests');

    const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
    expect(idx['tests/a.test.ts::suite/case A']).toMatchObject({ status: 'passed' });
    expect(idx['tests/b.test.ts::case B']).toMatchObject({ status: 'passed' });
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the known file relPath when vitest reports only a basename', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fliwright-runs-basename-'));
    const store = new TestStatusStore(dir);
    await store.recordRun('run-3', 1000, fakeRoot('/repo'), {
      passed: true,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      duration: 10,
      results: [
        { filePath: 'a.test.ts', name: 'case A', passed: true, duration: 3 },
      ],
    }, 'tests/a.test.ts');

    const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
    expect(idx['tests/a.test.ts::case A']).toMatchObject({ status: 'passed' });
    rmSync(dir, { recursive: true, force: true });
  });



  it('loads assertion statuses from the latest per-test timeline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fliwright-runs-assertions-'));
    const store = new TestStatusStore(dir);
    await store.recordRun('run-assertions', 1000, fakeRoot('/repo'), {
      passed: false,
      totalTests: 1,
      passedTests: 0,
      failedTests: 1,
      duration: 10,
      results: [
        { name: 'suite > case A', passed: false, duration: 10, error: 'boom' },
      ],
    }, 'tests/a.test.ts');
    mkdirSync(join(dir, 'run-assertions-suite-case-A'), { recursive: true });
    writeFileSync(join(dir, 'run-assertions-suite-case-A', 'timeline.json'), JSON.stringify({
      version: 1,
      runId: 'run-assertions-suite-case-A',
      testName: 'suite > case A',
      mode: 'test',
      status: 'failed',
      startedAt: '2026-06-28T00:00:00.000Z',
      nodes: [
        {
          id: 'a1',
          kind: 'assertion',
          title: '首页头像按钮可见',
          status: 'passed',
          startedAt: '2026-06-28T00:00:00.000Z',
          endedAt: '2026-06-28T00:00:00.012Z',
        },
        {
          id: 'a2',
          kind: 'assertion',
          title: '年度审核提醒操作按钮可见',
          status: 'failed',
          startedAt: '2026-06-28T00:00:00.020Z',
          endedAt: '2026-06-28T00:00:00.030Z',
          error: { message: 'not visible' },
        },
      ],
    }));

    const assertions = await store.loadAssertions('tests/a.test.ts::suite/case A');

    expect(assertions).toEqual([
      expect.objectContaining({ label: '首页头像按钮可见', status: 'passed', durationMs: 12 }),
      expect.objectContaining({ label: '年度审核提醒操作按钮可见', status: 'failed', durationMs: 10, error: 'not visible' }),
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('loadIndex returns the map', async () => {
    const store = new TestStatusStore(runsDir);
    const map = await store.loadIndex();
    expect(map.get('tests/a.test.ts::suite/case A')?.status).toBe('passed');
  });

  it('pruneDangling removes index entries whose runId is not kept', async () => {
    const store = new TestStatusStore(runsDir);
    await store.pruneDangling(new Set(['run-other']));
    const map = await store.loadIndex();
    expect(map.has('tests/a.test.ts::suite/case A')).toBe(false);
  });

  it('corrupt index.json yields an empty map (no throw)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fliwright-runs-bad-'));
    writeFileSync(join(dir, 'index.json'), '{not json');
    const store = new TestStatusStore(dir);
    const map = await store.loadIndex();
    expect(map.size).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
