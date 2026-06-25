import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileTddLoopStatusSource, DEFAULT_TDD_STATUS_RELATIVE_PATH, normalizeSnapshot } from '../src/tddloop/TddLoopStatusSource.js';

describe('FileTddLoopStatusSource', () => {
  let workspaceRoot: string;
  let statusFile: string;

  beforeAll(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'fliwright-tdd-src-'));
    mkdirSync(join(workspaceRoot, '.fliwright'), { recursive: true });
    statusFile = join(workspaceRoot, DEFAULT_TDD_STATUS_RELATIVE_PATH);
  });

  afterAll(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('returns undefined when the status file does not exist', async () => {
    const source = new FileTddLoopStatusSource(workspaceRoot, 'missing-status.json');
    expect(await source.read()).toBeUndefined();
  });

  it('returns undefined when no workspace root is configured', async () => {
    const source = new FileTddLoopStatusSource(undefined);
    expect(await source.read()).toBeUndefined();
  });

  it('reads and parses a well-formed snapshot', async () => {
    writeFileSync(
      statusFile,
      JSON.stringify({
        connected: true,
        daemonStatus: 'running',
        appId: 'com.example',
        supportsRestart: true,
        launchMode: 'start',
        restartCapable: true,
        driverConnections: 1,
        fixtureDriverSharing: 'vm-service-url',
        focusedTest: { file: 'a.test.ts', testName: 'works' },
        lastResult: {
          status: 'green',
          file: 'a.test.ts',
          durationMs: 10,
          lastSync: 'reload',
          baselineVersion: 2,
        },
        baselineVersion: 2,
        updatedAtMs: 123,
      }),
    );
    const source = new FileTddLoopStatusSource(workspaceRoot);
    const snapshot = await source.read();
    expect(snapshot?.connected).toBe(true);
    expect(snapshot?.daemonStatus).toBe('running');
    expect(snapshot?.focusedTest?.testName).toBe('works');
    expect(snapshot?.lastResult?.status).toBe('green');
    expect(snapshot?.updatedAtMs).toBe(123);
  });

  it('returns undefined for a malformed JSON file (never throws)', async () => {
    writeFileSync(statusFile, '{ not json');
    const source = new FileTddLoopStatusSource(workspaceRoot);
    expect(await source.read()).toBeUndefined();
  });
});

describe('normalizeSnapshot', () => {
  it('returns undefined for non-object input', () => {
    expect(normalizeSnapshot(null)).toBeUndefined();
    expect(normalizeSnapshot('hello')).toBeUndefined();
    expect(normalizeSnapshot(42)).toBeUndefined();
  });

  it('returns undefined when the required connected flag is missing', () => {
    expect(normalizeSnapshot({ daemonStatus: 'running' })).toBeUndefined();
  });

  it('coerces unknown enum values to safe defaults', () => {
    const out = normalizeSnapshot({
      connected: true,
      daemonStatus: 'bogus',
      launchMode: 'bogus',
      fixtureDriverSharing: 'bogus',
      driverConnections: 'nope',
      baselineVersion: 'nope',
    });
    expect(out).toBeDefined();
    expect(out?.daemonStatus).toBe('unknown');
    expect(out?.launchMode).toBe('attach');
    expect(out?.fixtureDriverSharing).toBe('vm-service-url');
    expect(out?.driverConnections).toBe(0);
    expect(out?.baselineVersion).toBe(0);
  });

  it('filters non-string notes and unsupportedState entries', () => {
    const out = normalizeSnapshot({
      connected: true,
      notes: ['ok', 5, { x: 1 }, 'also ok'],
      unsupportedState: ['webview', null, 3],
    });
    expect(out?.notes).toEqual(['ok', 'also ok']);
    expect(out?.unsupportedState).toEqual(['webview']);
  });

  it('drops a lastResult whose status is neither red nor green', () => {
    const out = normalizeSnapshot({
      connected: true,
      lastResult: { status: 'yellow', file: 'a.test.ts' },
    });
    expect(out?.lastResult).toBeUndefined();
  });

  it('keeps a focusedTest with only a file', () => {
    const out = normalizeSnapshot({
      connected: true,
      focusedTest: { file: 'a.test.ts' },
    });
    expect(out?.focusedTest).toEqual({ file: 'a.test.ts', testName: undefined });
  });

  it('drops a focusedTest with no file', () => {
    const out = normalizeSnapshot({
      connected: true,
      focusedTest: { testName: 'x' },
    });
    expect(out?.focusedTest).toBeUndefined();
  });
});
