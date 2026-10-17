import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleRecord } from '../src/tools/record.js';
import { createServerState } from '../src/state.js';
import type { RecordingResult } from '@fliwright/core';
import { generateRecordingAutomation, parseRecordingManifest, fingerprintScenario, ScenarioResolver } from '@fliwright/core';
import { verifyRecordingReplay } from '@fliwright/cli/run';

vi.mock('@fliwright/cli/run', async (original) => ({ ...await original<typeof import('@fliwright/cli/run')>(),
  verifyRecordingReplay: vi.fn(async () => ({ passed: true, verifiedRunId: 'mcp-replay', replayRunId: 'mcp-replay', issues: [] })),
}));

function capture(overrides: Partial<RecordingResult> = {}) {
  return {
    recorder: {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue({
        status: 'captured', code: "import { script } from '@fliwright/vitest';",
        operations: [{ kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000 }],
        frames: [], issues: [], receivedSequences: [], missingSequences: [], ...overrides,
      }),
      getSelectors: () => new Map(),
      getArtifactDirectory: () => undefined as string | undefined,
    },
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

describe('handleRecord', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('persists ordinary captures under project recordings with portable binary and raw references', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-mcp-evidence-'));
    try {
      const source = join(cwd, 'capture');
      await mkdir(join(source, 'screenshots'), { recursive: true });
      await writeFile(join(source, 'screenshots/frame.png'), 'png');
      await writeFile(join(source, 'events.jsonl'), '{"sequence":1}\n');
      const connection = capture({ rawEventsFile: 'events.jsonl', frames: [{
        id: 'frame', index: 0, kind: 'tap', status: 'ready', timestamp: 1, position: { x: 1, y: 2 },
        screenshot: { path: 'screenshots/frame.png', byteLength: 3, format: 'png' },
      }] });
      connection.recorder.getArtifactDirectory = () => source;
      const result = await handleRecord({ cwd, vmServiceUrl: 'ws://vm', duration: 0 }, createServerState(), async () => connection);
      await rm(source, { recursive: true });
      expect(result.recordingPath).toContain(join(cwd, '.fliwright/recordings'));
      const saved = parseRecordingManifest(await readFile(join(result.recordingPath, 'recording.json'), 'utf8'));
      expect(JSON.stringify(result)).not.toContain('base64');
      expect(JSON.stringify(saved)).not.toContain(source);
      expect(await readFile(join(result.recordingPath, saved.recording!.rawEventsFile!), 'utf8')).toContain('sequence');
      expect(await readFile(join(result.recordingPath, saved.frames[0].screenshot.path), 'utf8')).toBe('png');
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  it('uses the same environment scenario as CLI and accepts the project endpoint', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-mcp-shared-'));
    try {
      await writeFile(join(cwd, 'fliwright.config.ts'), `export default {
        vmServiceUrl: 'ws://project/ws', scenarios: { ready: { name: 'ready', layers: [] } },
      };`);
      vi.stubEnv('FLIWRIGHT_VM_URL', '');
      vi.stubEnv('FLIWRIGHT_VM_SERVICE_URL', '');
      const scenarios = { ready: { name: 'ready', layers: [{ kind: 'storage' as const, seed: { source: 'env' } }] } };
      vi.stubEnv('FLIWRIGHT_CONFIG', JSON.stringify({ scenarios, paths: { recordings: 'captures' } }));
      const factory = vi.fn(async () => capture({ operations: [] }));
      const result = await handleRecord({ cwd, duration: 0, scenario: 'ready' }, createServerState(), factory);
      expect(factory).toHaveBeenCalledWith('ws://project/ws');
      expect(result.readiness.scenarioFingerprint).toBe(fingerprintScenario(new ScenarioResolver(scenarios).resolve('ready')));
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  it('uses the shared CLI replay capability and returns its run identity', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-mcp-replay-'));
    try {
      await writeFile(join(cwd, 'fliwright.config.ts'), `export default { scenarios: { saved: { name: 'saved', layers: [] } } };`);
      const result = await handleRecord({ vmServiceUrl: 'ws://vm', duration: 0, cwd,
        mode: 'test', scenario: 'saved', verify: true,
        assertions: [{ id: 'saved', query: { match: { key: 'result' } }, matcher: 'toHaveText',
          expected: 'Saved', source: 'snapshot', confirmed: true }],
      }, createServerState(), async () => capture({ operations: [] }));
      expect(verifyRecordingReplay).toHaveBeenCalledWith(expect.objectContaining({
        code: result.testCode, scenario: 'saved', scenarioFingerprint: result.readiness.scenarioFingerprint, cwd,
      }));
      expect(result.readiness).toMatchObject({ readiness: 'verified', verifiedRunId: 'mcp-replay', replayRunId: 'mcp-replay' });
      const saved = parseRecordingManifest(await readFile(join(result.recordingPath, 'recording.json'), 'utf8'));
      expect(generateRecordingAutomation({ recording: saved.recording!,
        selectors: new Map(saved.recordedSelectors), stopReason: 'requested' }, saved.generationOptions!).recording.code).toBe(result.testCode);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  it('throws when no VM Service URL is provided', async () => {
    const original = process.env.FLIWRIGHT_VM_URL;
    delete process.env.FLIWRIGHT_VM_URL;
    try {
      await expect(handleRecord({ duration: 0 }, createServerState())).rejects.toThrow('No VM Service URL');
    } finally {
      if (original !== undefined) process.env.FLIWRIGHT_VM_URL = original;
    }
  });

  it('returns one structured capture and disposes its connection', async () => {
    const connection = capture();
    const state = createServerState();
    const factory = vi.fn(async () => connection);
    const result = await handleRecord({ vmServiceUrl: 'ws://param-url', duration: 0, testName: 'my test' }, state, factory);
    expect(factory).toHaveBeenCalledWith('ws://param-url');
    expect(state.getVmServiceUrl()).toBe('ws://param-url');
    expect(result.testCode).toContain('@fliwright/vitest');
    expect(result.operationCount).toBe(1);
    expect(result.recording?.status).toBe('captured');
    expect(connection.recorder.stop).toHaveBeenCalledWith(expect.objectContaining({ mode: 'script' }));
    expect(connection.recorder.stop).toHaveBeenCalledOnce();
    expect(connection.dispose).toHaveBeenCalledOnce();
  });

  it('returns the same sensitive input parameter contract as CLI generation', async () => {
    const connection = capture({
      operations: [{ kind: 'type', text: '<masked>', sensitive: true,
        action: 'replace', position: { x: 0, y: 0 }, timestamp: 1 }],
    });
    connection.recorder.getSelectors = () => new Map([[0, {
      query: { match: { key: 'password' } }, ambiguous: false, matchCount: 1,
    }]]);
    const result = await handleRecord({ vmServiceUrl: 'ws://vm', duration: 0 }, createServerState(), async () => connection);
    expect(result.readiness.requiredInputParameters).toEqual(['FLIWRIGHT_INPUT_1']);
    expect(result.testCode).toContain("process.env['FLIWRIGHT_INPUT_1']");
    expect(result.testCode).toContain('sensitive: true');
    expect(result.testCode).not.toContain('<masked>');
  });

  it('binds test recordings to the configured scenario fingerprint', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-mcp-scenario-'));
    try {
      await writeFile(join(cwd, 'fliwright.config.ts'), `export default { scenarios: {
        saved: { name: 'saved', layers: [{ kind: 'storage', seed: { ready: true } }] },
      } };`);
      const result = await handleRecord({ vmServiceUrl: 'ws://vm', duration: 0, mode: 'test', scenario: 'saved', cwd },
        createServerState(), async () => capture());
      expect(result.readiness.scenarioFingerprint).toBe(fingerprintScenario(new ScenarioResolver({
        saved: { name: 'saved', layers: [{ kind: 'storage', seed: { ready: true } }] },
      }).resolve('saved')));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('flushes on request cancellation and returns a draft', async () => {
    const connection = capture();
    const abort = new AbortController();
    connection.recorder.start.mockImplementation(async () => abort.abort());
    const result = await handleRecord({ vmServiceUrl: 'ws://vm', duration: 60 }, createServerState(), async () => connection, abort.signal);
    expect(result.recording?.status).toBe('partial');
    expect(result.readiness.readiness).toBe('draft');
    expect(result.blockers.join(' ')).toMatch(/cancelled/i);
    expect(connection.dispose).toHaveBeenCalledOnce();
  });

  it('uses the shared Dart entrypoint and finder capability gate', async () => {
    const connection = capture();
    connection.recorder.getSelectors = () => new Map([[0, {
      query: { match: { key: 'save' } }, ambiguous: false, matchCount: 1,
    }]]);
    const result = await handleRecord({ vmServiceUrl: 'ws://vm', duration: 0, lang: 'dart',
      dartAppEntrypoint: 'package:form_demo/recording_replay_main.dart',
    }, createServerState(), async () => connection);
    expect(result.readiness.readiness).toBe('generated');
    expect(result.testCode).toContain('await Future<void>.sync(app.main);');
    expect(connection.recorder.stop).toHaveBeenCalledWith(expect.objectContaining({
      dartAppEntrypoint: 'package:form_demo/recording_replay_main.dart', resetToHomeBeforeEach: false,
    }));
    const draft = await handleRecord({ vmServiceUrl: 'ws://vm', duration: 0, lang: 'dart' },
      createServerState(), async () => connection);
    expect(draft.readiness.readiness).toBe('draft');
    expect(draft.blockers.join(' ')).toMatch(/app entrypoint/i);
  });

  it('accepts only matching Dart compile/run evidence', async () => {
    const base = { vmServiceUrl: 'ws://vm', duration: 0, lang: 'dart' as const,
      dartAppEntrypoint: 'package:form_demo/recording_replay_main.dart' };
    const dartCapture = () => {
      const connection = capture();
      connection.recorder.getSelectors = () => new Map([[0, {
        query: { match: { key: 'save' } }, ambiguous: false, matchCount: 1,
      }]]);
      return connection;
    };
    const generated = await handleRecord(base, createServerState(), async () => dartCapture());
    const verified = await handleRecord({ ...base, dartVerification: {
      status: 'passed' as const, runId: 'mcp-dart-run', contentFingerprint: generated.readiness.contentFingerprint!,
      appEntrypoint: base.dartAppEntrypoint, platform: 'macos',
    } }, createServerState(), async () => dartCapture());
    expect(verified.readiness).toMatchObject({ readiness: 'verified', verifiedRunId: 'mcp-dart-run' });

    const failed = await handleRecord({ ...base, dartVerification: {
      status: 'failed' as const, runId: 'mcp-failed', contentFingerprint: generated.readiness.contentFingerprint!,
      appEntrypoint: base.dartAppEntrypoint, platform: 'macos', issues: [],
    } }, createServerState(), async () => dartCapture());
    expect(failed.readiness.readiness).toBe('draft');
    expect(failed.readiness.verifiedRunId).toBeUndefined();
    expect(failed.blockers.join(' ')).toMatch(/compilation or replay failed/i);

    const rejected = await handleRecord({ ...base, dartVerification: {
      status: 'passed' as const, runId: 'mcp-stale-run', contentFingerprint: 'stale-content',
      appEntrypoint: base.dartAppEntrypoint, platform: 'macos',
    } }, createServerState(), async () => dartCapture());
    expect(rejected.readiness.readiness).toBe('draft');
    expect(rejected.readiness.verifiedRunId).toBeUndefined();
    expect(rejected.blockers.join(' ')).toMatch(/content fingerprint/i);
  });

  it('releases the connection when start fails', async () => {
    const connection = capture();
    const original = new Error('bridge unavailable');
    connection.recorder.start.mockRejectedValue(original);
    await expect(handleRecord({ vmServiceUrl: 'ws://vm', duration: 0 }, createServerState(), async () => connection)).rejects.toBe(original);
    expect(connection.dispose).toHaveBeenCalledOnce();
  });

  it('rejects invalid durations before opening a driver', async () => {
    const factory = vi.fn(async () => capture());
    await expect(handleRecord({ vmServiceUrl: 'ws://vm', duration: -1 }, createServerState(), factory)).rejects.toThrow();
    expect(factory).not.toHaveBeenCalled();
  });

  it('generates an executable confirmed checkpoint using the shared core model', async () => {
    const connection = capture();
    const result = await handleRecord({ vmServiceUrl: 'ws://vm', duration: 0, mode: 'test', scenario: 'saved-form',
      assertions: [{ id: 'saved', query: { match: { key: 'result' } }, matcher: 'toHaveText',
        expected: 'Saved', source: 'snapshot', confirmed: true }],
    }, createServerState(), async () => connection);
    expect(result.testCode).toContain('.toHaveText("Saved")');
  });
});
