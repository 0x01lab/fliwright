import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RecordingResult } from '@fliwright/core';
import { generateRecordingAutomation, parseRecordingManifest, fingerprintScenario, ScenarioResolver } from '@fliwright/core';
import { recordCommand } from '../src/commands/record.js';

function capture(overrides: Partial<RecordingResult> = {}) {
  return {
    recorder: {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue({
        status: 'captured', operations: [], frames: [], receivedSequences: [], missingSequences: [],
        code: "import { script } from '@fliwright/vitest';\nscript('my test', async ({ page }) => {});",
        issues: [], ...overrides,
      }),
      getSelectors: () => new Map(),
      getArtifactDirectory: () => undefined as string | undefined,
    },
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

const resolveVmUrl = async () => 'ws://mock:8181/ws';

describe('recordCommand', () => {
  let cwd: string;
  beforeEach(async () => { cwd = await mkdtemp(join(tmpdir(), 'fliwright-record-')); });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(cwd, { recursive: true, force: true }); });

  it('preserves screenshots and the raw archive in a portable saved recording', async () => {
    const source = join(cwd, 'capture');
    await mkdir(join(source, 'screenshots'), { recursive: true });
    await writeFile(join(source, 'screenshots/frame.png'), 'png');
    await writeFile(join(source, 'events.jsonl'), '{"sequence":1}\n');
    const connection = capture({ rawEventsFile: 'events.jsonl', frames: [{
      id: 'frame', index: 0, kind: 'tap', status: 'ready', timestamp: 1, position: { x: 1, y: 2 },
      screenshot: { path: 'screenshots/frame.png', byteLength: 3, format: 'png' },
    }] });
    connection.recorder.getArtifactDirectory = () => source;
    const result = await recordCommand({ cwd }, { resolveVmUrl,
      openCapture: async () => connection, waitForStop: async () => {},
    });
    await rm(source, { recursive: true });
    const saved = parseRecordingManifest(await readFile(join(result.recordingPath!, 'recording.json'), 'utf8'));
    expect(JSON.stringify(saved)).not.toContain('base64');
    expect(JSON.stringify(saved)).not.toContain(source);
    expect(await readFile(join(result.recordingPath!, saved.recording!.rawEventsFile!), 'utf8')).toContain('sequence');
    expect(await readFile(join(result.recordingPath!, saved.frames[0].screenshot.path), 'utf8')).toBe('png');
  });

  it('uses project endpoint and environment paths/scenarios before capture and writes relative outputs under cwd', async () => {
    await writeFile(join(cwd, 'fliwright.config.ts'), `export default {
      vmServiceUrl: 'ws://project/ws', paths: { scripts: 'project-scripts' },
      scenarios: { ready: { name: 'ready', layers: [] } },
    };`);
    const scenarios = { ready: { name: 'ready', layers: [{ kind: 'storage' as const, seed: { source: 'env' } }] } };
    vi.stubEnv('FLIWRIGHT_CONFIG', JSON.stringify({ paths: { scripts: 'tasks', recordings: 'captures' }, scenarios }));
    const resolver = vi.fn(resolveVmUrl);
    const result = await recordCommand({ cwd, scenario: 'ready', testName: 'shared' }, {
      resolveVmUrl: resolver, openCapture: async () => capture(), waitForStop: async () => {},
    });
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ configUrl: 'ws://project/ws', cwd }));
    expect(await readFile(join(cwd, 'tasks/shared.script.ts'), 'utf8')).toBe(result.code);
    expect(result.recordingPath).toContain(join(cwd, 'captures'));
    expect(result.readiness.scenarioFingerprint).toBe(fingerprintScenario(new ScenarioResolver(scenarios).resolve('ready')));
    await recordCommand({ cwd, output: 'custom/script.ts', flowOutput: 'custom/flow.json' }, {
      resolveVmUrl, openCapture: async () => capture(), waitForStop: async () => {},
    });
    expect(await readFile(join(cwd, 'custom/script.ts'), 'utf8')).toContain('@fliwright/vitest');
    expect(JSON.parse(await readFile(join(cwd, 'custom/flow.json'), 'utf8')).version).toBe(1);
  });

  it('throws with a friendly message when the VM URL cannot be resolved', async () => {
    await expect(recordCommand({ cwd }, { resolveVmUrl: async () => null }))
      .rejects.toThrow('Could not find a running Flutter VM Service');
  });

  it('uses the structured stop result and releases its driver', async () => {
    const connection = capture();
    const result = await recordCommand({ cwd, testName: 'my test' }, {
      resolveVmUrl, openCapture: async () => connection, waitForStop: async () => {},
    });
    expect(result.code).toContain('@fliwright/vitest');
    expect(result.recording?.status).toBe('captured');
    expect(result.flow).toMatchObject({ version: 1, id: 'flow-my-test', title: 'my test' });
    expect(connection.recorder.stop).toHaveBeenCalledOnce();
    expect(connection.dispose).toHaveBeenCalledOnce();
  });

  it('defaults to script generation and a discoverable script path', async () => {
    const connection = capture();
    await recordCommand({ cwd, testName: 'my test' }, {
      resolveVmUrl, openCapture: async () => connection, waitForStop: async () => {},
    });
    expect(connection.recorder.stop).toHaveBeenCalledWith(expect.objectContaining({ mode: 'script' }));
    expect(await readFile(join(cwd, '.fliwright/scripts/my-test.script.ts'), 'utf8')).toContain("script('my test'");
  });

  it('binds test recordings to the resolved scenario fingerprint', async () => {
    await writeFile(join(cwd, 'fliwright.config.ts'), `export default { scenarios: {
      saved: { name: 'saved', layers: [{ kind: 'storage', seed: { ready: true } }] },
    } };`);
    const result = await recordCommand({ cwd, mode: 'test', scenario: 'saved', testName: 'scenario-bound' }, {
      resolveVmUrl, openCapture: async () => capture(), waitForStop: async () => {},
    });
    expect(result.readiness.scenarioFingerprint).toBe(fingerprintScenario(new ScenarioResolver({
      saved: { name: 'saved', layers: [{ kind: 'storage', seed: { ready: true } }] },
    }).resolve('saved')));
  });

  it('persists required replay parameters without embedding sensitive values', async () => {
    const connection = capture({ operations: [{ kind: 'type', text: '<masked>', sensitive: true,
      action: 'replace', position: { x: 0, y: 0 }, timestamp: 1 }] });
    connection.recorder.getSelectors = () => new Map([[0, {
      query: { match: { key: 'password' } }, ambiguous: false, matchCount: 1,
    }]]);
    const result = await recordCommand({ cwd, testName: 'private-input' }, {
      resolveVmUrl, openCapture: async () => connection, waitForStop: async () => {},
    });
    expect(result.readiness.requiredInputParameters).toEqual(['FLIWRIGHT_INPUT_1']);
    const code = await readFile(join(cwd, '.fliwright/scripts/private-input.script.ts'), 'utf8');
    expect(code).toContain("process.env['FLIWRIGHT_INPUT_1']");
    expect(code).not.toContain('<masked>');
    const persisted = JSON.parse(await readFile(join(result.recordingPath!, 'recording.json'), 'utf8'));
    expect(persisted.readiness.requiredInputParameters).toEqual(['FLIWRIGHT_INPUT_1']);
  });

  it('writes an editable flow from the same stop result', async () => {
    const connection = capture({
      operations: [{ kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000 }],
      frames: [{ id: 'frame-1', index: 0, kind: 'tap', status: 'ready', timestamp: 1000,
        operationIndex: 0, position: { x: 100, y: 200 }, selector: 'text=Pay' }],
    });
    const flowOutput = join(cwd, 'checkout.flow.json');
    await recordCommand({ cwd, testName: 'checkout', flowOutput }, {
      resolveVmUrl, openCapture: async () => connection, waitForStop: async () => {},
    });
    const flow = JSON.parse(await readFile(flowOutput, 'utf8'));
    expect(flow.nodes[0].selector).toBe('text=Pay');
  });

  it('passes language and navigation options to the common lifecycle', async () => {
    const connection = capture();
    await recordCommand({ cwd, lang: 'dart', testName: 'dart test' }, {
      resolveVmUrl, openCapture: async () => connection, waitForStop: async () => {},
    });
    expect(connection.recorder.stop).toHaveBeenCalledWith(expect.objectContaining({
      lang: 'dart', testName: 'dart test', resetToHomeBeforeEach: false,
    }));
  });

  it('keeps Dart output without an explicit app entrypoint as a persisted draft', async () => {
    const result = await recordCommand({ cwd, lang: 'dart', testName: 'no-entrypoint' }, {
      resolveVmUrl, openCapture: async () => capture(), waitForStop: async () => {},
    });
    expect(result.readiness.readiness).toBe('draft');
    expect(result.blockers.join(' ')).toMatch(/app entrypoint/i);
    await expect(readFile(join(cwd, '.fliwright/scripts/no-entrypoint.dart'), 'utf8')).rejects.toThrow();
    expect(await readFile(join(result.recordingPath!, 'draft.dart'), 'utf8')).toContain('throw StateError(');
  });

  it('forwards the Dart app entrypoint and prevents a TS verifier from promoting Dart', async () => {
    const connection = capture();
    const verifyRecording = vi.fn(async () => ({ passed: true, verifiedRunId: 'ts-run' }));
    const result = await recordCommand({ cwd, lang: 'dart', testName: 'dart-verify',
      dartAppEntrypoint: 'package:form_demo/recording_replay_main.dart', scenario: 'form', verify: true,
    }, { resolveVmUrl, openCapture: async () => connection, waitForStop: async () => {}, verifyRecording });
    expect(result.code).toContain("import 'package:form_demo/recording_replay_main.dart' as app;");
    expect(connection.recorder.stop).toHaveBeenCalledWith(expect.objectContaining({
      dartAppEntrypoint: 'package:form_demo/recording_replay_main.dart',
    }));
    expect(verifyRecording).not.toHaveBeenCalled();
    expect(result.readiness.readiness).toBe('draft');
    expect(result.readiness.verifiedRunId).toBeUndefined();
    expect(result.blockers.join(' ')).toMatch(/Dart.*compil.*Flutter/i);
  });

  it('promotes Dart only with matching compile/run evidence', async () => {
    const options = { cwd, lang: 'dart' as const, testName: 'dart-evidence',
      dartAppEntrypoint: 'package:form_demo/recording_replay_main.dart' };
    const generated = await recordCommand(options, {
      resolveVmUrl, openCapture: async () => capture(), waitForStop: async () => {},
    });
    const verified = await recordCommand({ ...options, dartVerification: {
      status: 'passed', runId: 'dart-run-1', contentFingerprint: generated.readiness.contentFingerprint!,
      appEntrypoint: options.dartAppEntrypoint, platform: 'macos',
    } }, { resolveVmUrl, openCapture: async () => capture(), waitForStop: async () => {} });
    expect(verified.readiness.readiness).toBe('verified');
    expect(verified.readiness.verifiedRunId).toBe('dart-run-1');
    await writeFile(join(cwd, 'verification.json'), JSON.stringify({
      status: 'passed', runId: 'dart-file-run', contentFingerprint: generated.readiness.contentFingerprint!,
      appEntrypoint: options.dartAppEntrypoint, platform: 'macos',
    }));
    const fromFile = await recordCommand({ ...options, dartVerificationFile: 'verification.json' }, {
      resolveVmUrl, openCapture: async () => capture(), waitForStop: async () => {},
    });
    expect(fromFile.readiness).toMatchObject({ readiness: 'verified', verifiedRunId: 'dart-file-run' });

    await writeFile(join(cwd, 'verification.json'), JSON.stringify({ status: 'passed', runId: 42 }));
    const openCapture = vi.fn(async () => capture());
    await expect(recordCommand({ ...options, dartVerificationFile: 'verification.json' }, {
      resolveVmUrl, openCapture, waitForStop: async () => {},
    })).rejects.toThrow(/invalid Dart verification evidence/i);
    expect(openCapture).not.toHaveBeenCalled();

    const failed = await recordCommand({ ...options, dartVerification: {
      status: 'failed', runId: 'dart-failed', contentFingerprint: generated.readiness.contentFingerprint!,
      appEntrypoint: options.dartAppEntrypoint, platform: 'macos', issues: [],
    } }, { resolveVmUrl, openCapture: async () => capture(), waitForStop: async () => {} });
    expect(failed.readiness.readiness).toBe('draft');
    expect(failed.readiness.verifiedRunId).toBeUndefined();
    expect(failed.blockers.join(' ')).toMatch(/compilation or replay failed/i);
    const persisted = parseRecordingManifest(await readFile(join(failed.recordingPath!, 'recording.json'), 'utf8'));
    expect(persisted.readiness).toMatchObject({ readiness: 'draft', issues: failed.blockers });

    const rejected = await recordCommand({ ...options, testName: 'dart-evidence-mismatch', dartVerification: {
      status: 'passed', runId: 'dart-run-2', contentFingerprint: 'stale-content',
      appEntrypoint: options.dartAppEntrypoint, platform: 'macos',
    } }, { resolveVmUrl, openCapture: async () => capture(), waitForStop: async () => {} });
    expect(rejected.readiness.readiness).toBe('draft');
    expect(rejected.readiness.verifiedRunId).toBeUndefined();
    expect(rejected.blockers.join(' ')).toMatch(/content fingerprint/i);
  });

  it('passes the resolved scenario fingerprint to replay verification', async () => {
    await writeFile(join(cwd, 'fliwright.config.ts'), `export default { scenarios: {
      form: { name: 'form', layers: [{ kind: 'storage', seed: { ready: true } }] },
    } };`);
    const verifyRecording = vi.fn(async () => ({ passed: true, verifiedRunId: 'verified-run' }));
    const result = await recordCommand({ cwd, mode: 'script', scenario: 'form', verify: true }, {
      resolveVmUrl, openCapture: async () => capture(), waitForStop: async () => {}, verifyRecording,
    });
    expect(verifyRecording).toHaveBeenCalledWith(expect.objectContaining({
      scenario: 'form',
      scenarioFingerprint: expect.any(String),
    }));
    expect(result.readiness.verifiedRunId).toBe('verified-run');
  });

  it('keeps an unresolved test-mode recording as a draft', async () => {
    const connection = capture({ operations: [{ kind: 'tap', position: { x: 1, y: 2 }, timestamp: 1 }] });
    const output = join(cwd, 'checkout.test.ts');
    const result = await recordCommand({ cwd, mode: 'test', scenario: 'checkout', output }, {
      resolveVmUrl, openCapture: async () => connection, waitForStop: async () => {},
    });
    expect(result.readiness.readiness).toBe('draft');
    expect(result.blockers).toContain('unresolved target at operation 1');
    await expect(readFile(output, 'utf8')).rejects.toThrow();
  });

  it('retains partial capture diagnostics and does not publish an apparently complete script', async () => {
    const connection = capture({ status: 'partial', issues: ['sequence gap'] });
    const result = await recordCommand({ cwd, testName: 'partial' }, {
      resolveVmUrl, openCapture: async () => connection, waitForStop: async () => {},
    });
    expect(result.readiness.readiness).toBe('draft');
    expect(result.blockers).toContain('sequence gap');
    expect(result.recordingPath).toBeDefined();
    await expect(readFile(join(cwd, '.fliwright/scripts/partial.script.ts'), 'utf8')).rejects.toThrow();
    expect(connection.dispose).toHaveBeenCalledOnce();
  });

  it('cleans up a failed start and preserves the original error', async () => {
    const connection = capture();
    const original = new Error('start failed');
    connection.recorder.start.mockRejectedValue(original);
    await expect(recordCommand({ cwd }, {
      resolveVmUrl, openCapture: async () => connection, waitForStop: async () => {},
    })).rejects.toBe(original);
    expect(connection.dispose).toHaveBeenCalledOnce();
  });

  it('flushes and releases the driver when the caller cancels', async () => {
    const connection = capture();
    const abort = new AbortController();
    connection.recorder.start.mockImplementation(async () => abort.abort());
    const result = await recordCommand({ cwd, signal: abort.signal }, {
      resolveVmUrl, openCapture: async () => connection,
    });
    expect(result.recording?.status).toBe('partial');
    expect(result.readiness.readiness).toBe('draft');
    expect(connection.dispose).toHaveBeenCalledOnce();
  });

  it('removes the SIGINT listener after flushing instead of leaving a polling timer', async () => {
    const connection = capture();
    const listeners = process.listenerCount('SIGINT');
    const work = recordCommand({ cwd }, { resolveVmUrl, openCapture: async () => connection });
    await vi.waitFor(() => expect(process.listenerCount('SIGINT')).toBe(listeners + 1));
    process.emit('SIGINT');
    await work;
    expect(process.listenerCount('SIGINT')).toBe(listeners);
    expect(connection.dispose).toHaveBeenCalledOnce();
  });

  it('reports persistence failure after releasing the connection', async () => {
    const connection = capture();
    const blocked = join(cwd, 'a-file');
    await writeFile(blocked, 'not a directory');
    await expect(recordCommand({ cwd: blocked }, {
      resolveVmUrl, openCapture: async () => connection, waitForStop: async () => {},
    })).rejects.toThrow();
    expect(connection.dispose).toHaveBeenCalledOnce();
  });

  it('emits executable confirmed checkpoints rather than merely counting their JSON entries', async () => {
    const connection = capture();
    await writeFile(join(cwd, 'fliwright.config.ts'), `export default { scenarios: {
      'saved-form': { name: 'saved-form', layers: [] },
    } };`);
    const assertions = join(cwd, 'assertions.json');
    await writeFile(assertions, JSON.stringify([{ id: 'saved', query: { match: { key: 'result' } },
      matcher: 'toHaveText', expected: 'Saved', source: 'snapshot', confirmed: true }]));
    const result = await recordCommand({ cwd, mode: 'test', scenario: 'saved-form', assertions }, {
      resolveVmUrl, openCapture: async () => connection, waitForStop: async () => {},
    });
    const saved = parseRecordingManifest(await readFile(join(result.recordingPath!, 'recording.json'), 'utf8'));
    const regenerated = generateRecordingAutomation({ recording: saved.recording!,
      selectors: new Map(saved.recordedSelectors), stopReason: 'requested' }, saved.generationOptions!);
    expect(regenerated.recording.code).toBe(result.code);
    expect(result.code).toContain('.toHaveText("Saved")');
    expect(result.code).toContain("test.scenario('saved-form')('recorded test'");
    expect(result.readiness.readiness).toBe('generated');
  });

  it('does not publish a test based on an incomplete confirmation object', async () => {
    const connection = capture();
    const assertions = join(cwd, 'assertions.json');
    await writeFile(assertions, JSON.stringify([{ confirmed: true }]));
    const result = await recordCommand({ cwd, mode: 'test', scenario: 'saved-form', assertions }, {
      resolveVmUrl, openCapture: async () => connection, waitForStop: async () => {},
    });
    expect(result.readiness.readiness).toBe('draft');
    expect(result.blockers).toContain('missing confirmed assertion');
    await expect(readFile(join(cwd, '.fliwright/tests/recorded-test.test.ts'), 'utf8')).rejects.toThrow();
  });
});
