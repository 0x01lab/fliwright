import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { RunSession } from '../../src/RunSession.js';
import { TimelineRecorder } from '../../src/timeline/TimelineRecorder.js';
import { TimelineArtifactStore } from '../../src/timeline/TimelineArtifactStore.js';
import { NativeRuntime } from '../../src/native/NativeRuntime.js';
import type { NativeSessionAdapter, NativeSnapshot } from '../../src/native/types.js';
import { EndpointLeaseManager } from '../../src/EndpointLease.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function setup(mode: 'full' | 'standard' | 'off' = 'standard') {
  const root = await mkdtemp(join(tmpdir(), 'native-evidence-')); roots.push(root);
  const artifactStore = new TimelineArtifactStore({ attemptDir: root, runId: 'r' });
  const recorder = new TimelineRecorder({ runId: 'r', testName: 'evidence', mode: 'test' });
  const flutter = vi.fn(async () => ({ status: 'captured' as const, artifactPaths: ['flutter.png'] }));
  const session = new RunSession({ runId: 'r', testId: 't', testName: 'evidence', recorder, recordingMode: mode, captureEvidence: flutter });
  const identity = { platform: 'android' as const, deviceId: 'chosen', appId: 'example.app', backend: 'probe', generation: 'g1' };
  const snapshot: NativeSnapshot = { id: 's1', identity, capturedAt: new Date().toISOString(),
    screen: { width: 100, height: 200, scale: 1, orientation: 'portrait' },
    nodes: [{ id: 'n', appId: identity.appId, text: 'Confirm', enabled: true, visible: true, hittable: true,
      frame: { x: 1, y: 1, width: 20, height: 20 } }] };
  const adapter: NativeSessionAdapter = { identity,
    capabilities: vi.fn(async () => Object.fromEntries(['native.query', 'native.click', 'screen.capture']
      .map(key => [key, { support: 'supported', ready: true, backend: 'probe' }]))),
    snapshot: vi.fn(async () => snapshot), execute: vi.fn(async () => ({})),
    screenshot: vi.fn(async () => Buffer.from('png')), dispose: vi.fn(async () => {}),
  };
  const runtime = new NativeRuntime(adapter, { runSession: session });
  runtime.configureEvidence({ artifactStore, timeoutMs: 100 });
  return { root, adapter, runtime, session, recorder, flutter };
}

it('captures full/start and standard/finish through the native adapter without recursive operations', async () => {
  for (const mode of ['full', 'standard'] as const) {
    const { root, runtime, session, recorder, adapter, flutter } = await setup(mode);
    await runtime.native.getByText('Confirm').click();
    const result = session.snapshot();
    expect(result.operations).toHaveLength(1);
    expect(flutter).not.toHaveBeenCalled();
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(result.evidence.map(item => [item.kind, item.reason, item.surface])).toEqual(mode === 'full'
      ? [['screenshot', 'start', 'native'], ['snapshot', 'start', 'native'], ['screenshot', 'finish', 'native']]
      : [['screenshot', 'finish', 'native']]);
    const artifacts = recorder.toJSON().nodes.flatMap(node => node.artifacts ?? []);
    expect(artifacts.every(item => item.metadata?.surface === 'native')).toBe(true);
    if (mode === 'full') {
      const tree = JSON.parse(await readFile(join(root, artifacts.find(item => item.kind === 'snapshot')!.path), 'utf8'));
      expect(tree).toMatchObject({ surface: 'native', schemaVersion: 1, query: { field: 'text', value: 'Confirm' },
        snapshot: { identity: { generation: 'g1' } } });
      expect(adapter.snapshot).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ value: 'Confirm' }));
    }
    await runtime.dispose();
  }
});

it('keeps the original action error and records partial native evidence when capture fails', async () => {
  const { runtime, session, adapter } = await setup();
  const original = new Error('ambiguous business target');
  vi.mocked(adapter.snapshot).mockRejectedValue(original);
  vi.mocked(adapter.screenshot).mockRejectedValue(new Error('screen transport lost'));
  await expect(runtime.native.getByText('Confirm').click()).rejects.toBe(original);
  expect(session.snapshot()).toMatchObject({ evidenceStatus: 'partial', operations: [{ outcome: 'failed', error: { message: original.message } }] });
  expect(session.snapshot().evidence).toHaveLength(2);
  expect(session.snapshot().evidence.every(item => item.surface === 'native')).toBe(true);
  await runtime.dispose();
});

it('records failure evidence for a native assertion and routes later runner checkpoints to that surface', async () => {
  const { runtime, adapter, session, flutter } = await setup();
  vi.mocked(adapter.snapshot).mockRejectedValue(new Error('native tree offline'));
  await expect(runtime.native.getByText('Confirm').expect().not.toBeVisible()).rejects.toThrow('native tree offline');
  await session.checkpoint({ kind: 'screenshot', reason: 'failure' });
  expect(flutter).not.toHaveBeenCalled();
  expect(session.snapshot().evidence).toHaveLength(3);
  await runtime.dispose();
});

it('bounds and aborts hung evidence, keeps its independent budget, and never repeats the action', async () => {
  const { runtime, adapter, session } = await setup();
  let signal: AbortSignal | undefined;
  vi.mocked(adapter.screenshot).mockImplementation(async context => { signal = context.signal; return new Promise(() => {}); });
  await runtime.native.getByText('Confirm').click({ timeout: 30 });
  expect(signal?.aborted).toBe(true);
  expect(session.snapshot()).toMatchObject({ evidenceStatus: 'partial', evidence: [{ result: { status: 'timeout' } }] });
  expect(adapter.execute).toHaveBeenCalledTimes(1);
  await expect(runtime.native.getByText('Confirm').click()).rejects.toMatchObject({ code: 'precondition_failed' });
  await runtime.dispose();
});

it('masks native password nodes and fill secrets while preserving an explicit surface schema', async () => {
  const { runtime, adapter, session, root } = await setup();
  const snapshot = await adapter.snapshot({ requestId: 'setup', deadline: Date.now() + 100, signal: new AbortController().signal });
  vi.mocked(adapter.snapshot).mockResolvedValue({ ...snapshot, nodes: [{ ...snapshot.nodes[0], password: true, text: 'private', value: 'private', label: 'private' }] });
  const result = await session.checkpoint({ kind: 'snapshot', reason: 'explicit', surface: 'native' });
  const saved = await readFile(join(root, result.artifactPaths![0]), 'utf8');
  expect(saved).not.toContain('private');
  expect(saved).toContain('<masked>');
  await runtime.dispose();
});

it('keeps Flutter routing distinct even when its evidence provider is attached after native actions', async () => {
  const { runtime, session, flutter } = await setup();
  await runtime.native.getByText('Confirm').click();
  const source = vi.fn(async () => ({ status: 'captured' as const, artifactPaths: ['new-flutter.png'] }));
  session.registerEvidenceProvider('flutter', source);
  await session.perform({ kind: 'action', title: 'Flutter button' }, async () => {});
  expect(source).toHaveBeenCalledOnce();
  expect(flutter).not.toHaveBeenCalled();
  await runtime.dispose();
});

it('does not capture automatic evidence with recording off', async () => {
  const { runtime, adapter, session } = await setup('off');
  await runtime.native.getByText('Confirm').click();
  expect(adapter.screenshot).not.toHaveBeenCalled();
  expect(session.snapshot().evidence).toEqual([]);
  await runtime.dispose();
});

it('retains the shared endpoint queue through native evidence before a concurrent Flutter action', async () => {
  const { runtime, adapter, session, root } = await setup();
  session.configureEndpointLease(new EndpointLeaseManager({ rootDir: join(root, 'locks') }), 'ws://native-shared/ws');
  let started!: () => void, finish!: () => void;
  const capturing = new Promise<void>(resolve => { started = resolve; });
  const release = new Promise<void>(resolve => { finish = resolve; });
  const events: string[] = [];
  vi.mocked(adapter.execute).mockImplementation(async () => { events.push('native-action'); });
  vi.mocked(adapter.screenshot).mockImplementation(async () => { events.push('native-evidence'); started(); await release; return Buffer.from('png'); });
  const native = runtime.native.getByText('Confirm').click();
  await capturing;
  const flutter = session.perform({ kind: 'action', title: 'Flutter continue' }, async () => { events.push('flutter-action'); });
  expect(events).toEqual(['native-action', 'native-evidence']);
  finish();
  await Promise.all([native, flutter]);
  expect(events).toEqual(['native-action', 'native-evidence', 'flutter-action']);
  await runtime.dispose();
});
