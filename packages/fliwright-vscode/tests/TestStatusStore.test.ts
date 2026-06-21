import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
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
    expect(idx['tests/a.test.ts::suite/case A']).toMatchObject({ status: 'passed', runId: 'run-1' });
    expect(idx['tests/a.test.ts::suite/case B']).toMatchObject({ status: 'failed', runId: 'run-1' });
    expect(existsSync(join(runsDir, 'run-1', 'result.json'))).toBe(true);
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
